import http2 from 'node:http2'
import net from 'node:net'
import { grpcFrame, grpcMessages } from './proto'

/** A client-streaming call kept open: each message goes as it's written. */
export interface GrpcStream {
  write(message: Buffer): void
  /** Ends the call; its answer isn't read. */
  close(): void
}

/** idb never answered a call: the connection, or the call itself, ended before any grpc-status
 *  arrived. */
export class GrpcNoAnswer extends Error {}

const headers = (path: string) => ({ ':method': 'POST', ':path': path, 'content-type': 'application/grpc', te: 'trailers' })

/** gRPC's status message is percent-encoded. */
function readable(message: string): string {
  try {
    return decodeURIComponent(message)
  } catch {
    return message
  }
}

const noAnswer = (path: string, cause: string) => new GrpcNoAnswer(`The call to ${path} ended without an answer from idb (${cause}).`)

/** Why a stream ended, with nothing more specific known: the request's own error (preferring a
 *  wrapped cause, where Node puts the real reason for a reset or a dead connection), else a plain
 *  line — the same wording whichever runtime notices first (Node 22 throws from request() at
 *  once; Electron 45's Node 24 instead fails the returned stream a tick later). */
function endReason(path: string, err: Error | null | undefined): string {
  return (err?.cause as Error | undefined)?.message ?? err?.message ?? `idb ended ${path}.`
}

/** gRPC to idb_companion over its Unix socket, on Node's own HTTP/2: Deck makes two kinds of call
 *  (describe and hid), which a gRPC library and its protobuf loader would add 12 MB for. */
export class GrpcClient {
  private readonly session: http2.ClientHttp2Session
  /** Why the connection failed, for the calls it takes down. Can land after a call's own stream
   *  has already closed, so unary() and stream() also keep that stream's own 'error'. */
  private failure: Error | null = null

  /** `onClose`: the connection closed (also after close()). */
  constructor(socket: string, onClose?: () => void) {
    this.session = http2.connect('http://localhost', { createConnection: () => net.connect(socket) })
    this.session.on('error', (err) => {
      this.failure = err
    })
    this.session.on('close', () => this.guard(() => onClose?.()))
  }

  /** One message there, one back: the answer's message, or the server's own words for a failure. */
  unary(path: string, message: Buffer, timeoutMs = 10_000): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      let req: http2.ClientHttp2Stream
      try {
        // request() throws at once on a connection that has closed or failed (Node 22); Electron
        // 45's Node 24 instead returns a stream that fails on the next tick (the 'close' below).
        req = this.session.request(headers(path))
      } catch (err) {
        return reject(noAnswer(path, (this.failure ?? (err as Error)).message))
      }
      const chunks: Buffer[] = []
      let status: string | undefined
      let detail = ''
      let streamError: Error | undefined
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        req.close(http2.constants.NGHTTP2_CANCEL)
      }, timeoutMs)
      const read = (h: http2.IncomingHttpHeaders) => {
        if (h['grpc-status'] !== undefined) status = String(h['grpc-status'])
        if (h['grpc-message'] !== undefined) detail = readable(String(h['grpc-message']))
      }
      // A call that fails before any message answers "trailers-only": the status is in the headers.
      req.on('response', read)
      req.on('trailers', read)
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      // this.failure (the session's own 'error') can land after this same stream's 'close' below,
      // so keep the stream's own error too.
      req.on('error', (e) => {
        streamError ??= e
      })
      req.on('close', () => {
        clearTimeout(timer)
        if (timedOut) return reject(new Error(`idb didn't answer ${path} within ${timeoutMs / 1000} s.`))
        if (status === undefined) {
          const cause = this.failure?.message ?? (streamError?.cause as Error | undefined)?.message ?? streamError?.message ?? 'no reason given'
          return reject(noAnswer(path, cause))
        }
        if (status !== '0') return reject(new Error(detail || `idb answered ${path} with gRPC status ${status}.`))
        try {
          const [answer] = grpcMessages(Buffer.concat(chunks))
          if (!answer) throw new Error(`idb sent no answer to ${path}.`)
          resolve(answer)
        } catch (err) {
          reject(err)
        }
      })
      req.end(grpcFrame(message))
    })
  }

  /** A client stream kept open (idb's hid): idb acts on each message as it comes. If idb ends the
   *  call itself — a grpc-status, or the stream or connection failing — rather than close(),
   *  `onEnd` fires once with why. The connection itself stays open either way, so the caller may
   *  open a new stream on it (that works). */
  stream(path: string, onEnd?: (why: string) => void): GrpcStream {
    let req: http2.ClientHttp2Stream
    try {
      req = this.session.request(headers(path))
    } catch (err) {
      // Node 22 throws here at once; Electron 45's Node 24 instead fails the returned stream a
      // tick later (the 'close' below) — queue this one too, so a caller sees the same thing
      // either way.
      if (onEnd) {
        const why = endReason(path, this.failure ?? (err as Error))
        queueMicrotask(() => this.guard(() => onEnd(why)))
      }
      return { write: () => {}, close: () => {} }
    }
    let closedByCaller = false
    let status: string | undefined
    let detail = ''
    let streamError: Error | undefined
    const read = (h: http2.IncomingHttpHeaders) => {
      if (h['grpc-status'] !== undefined) status = String(h['grpc-status'])
      if (h['grpc-message'] !== undefined) detail = readable(String(h['grpc-message']))
      // idb ending the call doesn't end our own side (we may still have more to write): finish it
      // so the stream can close and tell the caller, below. Measured: a call idb ends from only
      // its side, ours left open, never reaches HTTP/2's fully-closed state, so 'close' never
      // fires on it at all.
      if (status !== undefined && !req.writableEnded && !req.destroyed) req.end()
    }
    req.on('response', read)
    req.on('trailers', read)
    req.on('error', (e) => {
      streamError ??= e
    }) // 'close' below settles the call
    req.on('close', () => {
      if (closedByCaller || !onEnd) return
      const why = detail
        ? detail
        : status !== undefined
          ? `idb ended ${path} (gRPC status ${status}).`
          : endReason(path, streamError)
      this.guard(() => onEnd(why))
    })
    req.resume() // the answer isn't read
    return {
      write: (message) => {
        if (!req.destroyed && !req.writableEnded) req.write(grpcFrame(message))
      },
      close: () => {
        closedByCaller = true
        if (!req.destroyed && !req.writableEnded) req.end()
      },
    }
  }

  /** Drops the connection and every call on it at once: a graceful close() never finished while a
   *  stream was open, or the server hung. */
  close(): void {
    this.session.destroy()
  }

  /** onClose and onEnd run in a session or stream event handler: a throw there is unhandled, and
   *  in main would show Electron's modal error dialog. Guarded, as DeviceStreams guards a
   *  session's own calls. */
  private guard(run: () => void): void {
    try {
      run()
    } catch (err) {
      console.error('devices: a gRPC callback failed', err)
    }
  }
}
