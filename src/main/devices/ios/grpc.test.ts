import http2 from 'node:http2'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { GrpcClient, GrpcNoAnswer } from './grpc'
import { grpcFrame, grpcMessages } from './proto'

describe.skipIf(process.platform === 'win32')('GrpcClient', () => {
  // Set up in beforeAll, not here: a skipped suite still runs this describe() body to collect its
  // tests (just not the hooks or the tests themselves), so mkdtempSync here would leave an empty
  // folder behind on Windows.
  let dir: string
  let socket: string
  const received: { path: string; messages: Buffer[]; headers: http2.IncomingHttpHeaders }[] = []
  /** A hid-style call's messages, by path, as they arrive. */
  const streamedByPath = new Map<string, Buffer[]>()
  const server = http2.createServer()
  const serverSessions: http2.ServerHttp2Session[] = []

  beforeAll(async () => {
    // A short folder: a Unix socket's path must stay under 104 bytes.
    dir = mkdtempSync(join(tmpdir(), 'dk-'))
    socket = join(dir, 's.sock')
    server.on('session', (session) => serverSessions.push(session))
    // @types/node's Http2Server 'stream' event map types this as the base Http2Stream (from
    // Http2SessionEventMap, the map both client and server sessions share), which has no
    // respond()/sendTrailers(): annotate the server type.
    server.on('stream', (stream: http2.ServerHttp2Stream, headers) => {
      const path = String(headers[':path'])
      const chunks: Buffer[] = []
      let pending = Buffer.alloc(0)
      let endedEarly = false
      // /test/reset's own stream.close(code) below reports itself as an 'error' here too (Node
      // requires a listener, or it's an uncaught exception): expected, not a test failure.
      stream.on('error', () => {})
      stream.on('data', (chunk: Buffer) => {
        if (!path.startsWith('/test/hid')) return void chunks.push(chunk)
        // Whole messages only: one may come in pieces.
        pending = Buffer.concat([pending, chunk])
        while (pending.length >= 5 && pending.length >= 5 + pending.readUInt32BE(1)) {
          const n = 5 + pending.readUInt32BE(1)
          const list = streamedByPath.get(path) ?? []
          list.push(...grpcMessages(pending.subarray(0, n)))
          streamedByPath.set(path, list)
          pending = pending.subarray(n)
          if (path === '/test/hid-ends' && !endedEarly) {
            // idb ending the call itself (its handler "threw"), without waiting for the client to
            // finish sending: real trailers, not a reset, and the connection stays up.
            endedEarly = true
            stream.respond({ ':status': 200, 'content-type': 'application/grpc' }, { waitForTrailers: true })
            stream.on('wantTrailers', () => stream.sendTrailers({ 'grpc-status': '13', 'grpc-message': 'Bad%20event' }))
            stream.end()
          }
        }
      })
      stream.on('end', () => {
        received.push({ path, messages: path.startsWith('/test/hid') ? [] : grpcMessages(Buffer.concat(chunks)), headers })
        if (endedEarly) return // already answered from the 'data' handler above
        if (path === '/test/silent') return // never answers
        if (path === '/test/reset') return stream.close(http2.constants.NGHTTP2_INTERNAL_ERROR)
        if (path === '/test/fails') {
          stream.respond({ ':status': 200, 'content-type': 'application/grpc' }, { waitForTrailers: true })
          stream.on('wantTrailers', () => stream.sendTrailers({ 'grpc-status': '5', 'grpc-message': 'No%20such%20simulator' }))
          return stream.end()
        }
        if (path === '/test/trailers-only') {
          return stream.respond({ ':status': 200, 'content-type': 'application/grpc', 'grpc-status': '14', 'grpc-message': 'Unavailable' }, { endStream: true })
        }
        stream.respond({ ':status': 200, 'content-type': 'application/grpc' }, { waitForTrailers: true })
        stream.on('wantTrailers', () => stream.sendTrailers({ 'grpc-status': '0' }))
        stream.end(grpcFrame(Buffer.from('answer')))
      })
    })
    await new Promise<void>((resolve) => server.listen(socket, resolve))
  })
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  })

  it('makes a unary call: a gRPC POST with the framed message, answered by its one message', async () => {
    const client = new GrpcClient(socket)
    expect((await client.unary('/test/describe', Buffer.from('hi'))).toString()).toBe('answer')
    const call = received.find((r) => r.path === '/test/describe')!
    expect(call.headers['content-type']).toBe('application/grpc')
    expect(call.headers.te).toBe('trailers')
    expect(call.messages.map(String)).toEqual(['hi'])
    client.close()
  })

  it("rejects with the server's own words, from trailers or a trailers-only answer", async () => {
    const client = new GrpcClient(socket)
    await expect(client.unary('/test/fails', Buffer.alloc(0))).rejects.toThrow('No such simulator')
    await expect(client.unary('/test/trailers-only', Buffer.alloc(0))).rejects.toThrow('Unavailable')
    client.close()
  })

  it('rejects with GrpcNoAnswer when the server resets the stream mid-call, with no grpc-status at all', async () => {
    const client = new GrpcClient(socket)
    await expect(client.unary('/test/reset', Buffer.alloc(0))).rejects.toThrow(GrpcNoAnswer)
    client.close()
  })

  it('gives up on a call that gets no answer', async () => {
    const client = new GrpcClient(socket)
    await expect(client.unary('/test/silent', Buffer.alloc(0), 200)).rejects.toThrow("idb didn't answer /test/silent within 0.2 s.")
    client.close()
  })

  it('delivers a stream’s messages while the call stays open', async () => {
    const client = new GrpcClient(socket)
    const call = client.stream('/test/hid')
    call.write(Buffer.from('down'))
    await vi.waitFor(() => expect(streamedByPath.get('/test/hid')?.map(String)).toEqual(['down']))
    call.write(Buffer.from('up'))
    await vi.waitFor(() => expect(streamedByPath.get('/test/hid')?.map(String)).toEqual(['down', 'up']))
    call.close()
    call.write(Buffer.from('late')) // ignored once closed
    await vi.waitFor(() => expect(received.some((r) => r.path === '/test/hid')).toBe(true))
    expect(streamedByPath.get('/test/hid')?.map(String)).toEqual(['down', 'up'])
    client.close()
  })

  it('tells the caller once when idb ends a stream itself; a later write is harmless, a new stream still delivers', async () => {
    const client = new GrpcClient(socket)
    const onEnd = vi.fn()
    const call = client.stream('/test/hid-ends', onEnd)
    call.write(Buffer.from('down'))
    await vi.waitFor(() => expect(onEnd).toHaveBeenCalledWith('Bad event'))
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(() => call.write(Buffer.from('late'))).not.toThrow()

    // The connection itself is still up: a new stream on the same client still delivers.
    const call2 = client.stream('/test/hid-2')
    call2.write(Buffer.from('still works'))
    await vi.waitFor(() => expect(streamedByPath.get('/test/hid-2')?.map(String)).toEqual(['still works']))
    call2.close()
    client.close()
  })

  it('calls onClose exactly once when the server destroys the session', async () => {
    const closed = vi.fn()
    const client = new GrpcClient(socket, closed)
    // Whichever new server session just appeared for this client: not serverSessions.at(-1),
    // since earlier tests' sessions may still be around (or still closing) when this one runs.
    const before = serverSessions.length
    await client.unary('/test/describe', Buffer.from('hi'))
    serverSessions[before].destroy()
    await vi.waitFor(() => expect(closed).toHaveBeenCalledTimes(1))
    client.close()
  })

  it('never throws on a closed connection: a call rejects with GrpcNoAnswer, a stream does nothing but still tells onEnd', async () => {
    const client = new GrpcClient(socket)
    client.close()
    await expect(client.unary('/test/describe', Buffer.alloc(0))).rejects.toThrow(GrpcNoAnswer)
    const onEnd = vi.fn()
    const call = client.stream('/test/hid', onEnd)
    expect(() => call.write(Buffer.from('x'))).not.toThrow()
    call.close()
    await vi.waitFor(() => expect(onEnd).toHaveBeenCalled())
  })

  it('rejects calls when nothing listens on the socket', async () => {
    const client = new GrpcClient(join(dir, 'missing.sock'))
    await expect(client.unary('/test/describe', Buffer.alloc(0))).rejects.toThrow(/ended without an answer from idb \(.*(ENOENT|connect)/)
    client.close()
  })
})
