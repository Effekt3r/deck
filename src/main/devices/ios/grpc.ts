import http2 from 'node:http2'
import net from 'node:net'
import { grpcFrame, grpcMessages } from './proto'

/** A client-streaming call kept open: each message goes as it's written. */
export interface GrpcStream {
  write(message: Buffer): void
  /** Ends the call; its answer isn't read. */
  close(): void
}

const headers = (path: string) => ({ ':method': 'POST', ':path': path, 'content-type': 'application/grpc', te: 'trailers' })

/** gRPC's status message is percent-encoded. */
function readable(message: string): string {
  try {
    return decodeURIComponent(message)
  } catch {
    return message
  }
}

/** gRPC to idb_companion over its Unix socket, on Node's own HTTP/2: Deck makes two kinds of call
 *  (describe and hid), which a gRPC library and its protobuf loader would add 12 MB for. */
export class GrpcClient {
  private readonly session: http2.ClientHttp2Session
  /** Why the connection failed, for the calls it takes down. */
  private failure: Error | null = null

  /** `onClose`: the connection closed (also after close()). */
  constructor(socket: string, onClose?: () => void) {
    this.session = http2.connect('http://localhost', { createConnection: () => net.connect(socket) })
    this.session.on('error', (err) => {
      this.failure = err
    })
    this.session.on('close', () => onClose?.())
  }

  /** One message there, one back: the answer's message, or the server's own words for a failure. */
  unary(path: string, message: Buffer, timeoutMs = 10_000): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      let req: http2.ClientHttp2Stream
      try {
        // request() throws at once on a connection that has closed or failed.
        req = this.session.request(headers(path))
      } catch (err) {
        return reject(this.failure ?? err)
      }
      const chunks: Buffer[] = []
      let status: string | undefined
      let detail = ''
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
      req.on('error', () => {}) // 'close' settles the call
      req.on('close', () => {
        clearTimeout(timer)
        if (timedOut) return reject(new Error(`idb didn't answer ${path} within ${Math.round(timeoutMs / 1000)} s.`))
        if (status === undefined && this.failure) return reject(this.failure)
        if (status !== '0') return reject(new Error(detail || `idb answered ${path} with gRPC status ${status ?? 'none'}.`))
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

  /** A client stream kept open (idb's hid): idb acts on each message as it comes. */
  stream(path: string): GrpcStream {
    let req: http2.ClientHttp2Stream
    try {
      req = this.session.request(headers(path))
    } catch {
      // A connection that has closed or failed: nothing goes, and the companion's end says why.
      return { write: () => {}, close: () => {} }
    }
    req.on('error', () => {}) // a call reset with the connection: the session's end says why
    req.resume() // the answer isn't read
    return {
      write: (message) => {
        if (!req.destroyed && !req.writableEnded) req.write(grpcFrame(message))
      },
      close: () => {
        if (!req.destroyed && !req.writableEnded) req.end()
      },
    }
  }

  close(): void {
    this.session.close()
  }
}
