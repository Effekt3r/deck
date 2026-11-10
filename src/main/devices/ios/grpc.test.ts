import http2 from 'node:http2'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { GrpcClient } from './grpc'
import { grpcFrame, grpcMessages } from './proto'

describe.skipIf(process.platform === 'win32')('GrpcClient', () => {
  // A short folder: a Unix socket's path must stay under 104 bytes.
  const dir = mkdtempSync(join(tmpdir(), 'dk-'))
  const socket = join(dir, 's.sock')
  const received: { path: string; messages: Buffer[]; headers: http2.IncomingHttpHeaders }[] = []
  /** Messages of the open hid call, as they arrive. */
  const streamed: Buffer[] = []
  const server = http2.createServer()
  const serverSessions: http2.ServerHttp2Session[] = []

  beforeAll(async () => {
    server.on('session', (session) => serverSessions.push(session))
    // @types/node's Http2Server 'stream' event map types this as the base Http2Stream (it reuses
    // the client-side event map), which has no respond()/sendTrailers(): annotate the server type.
    server.on('stream', (stream: http2.ServerHttp2Stream, headers) => {
      const path = String(headers[':path'])
      const chunks: Buffer[] = []
      let pending = Buffer.alloc(0)
      stream.on('data', (chunk: Buffer) => {
        if (path !== '/test/hid') return void chunks.push(chunk)
        // Whole messages only: one may come in pieces.
        pending = Buffer.concat([pending, chunk])
        while (pending.length >= 5 && pending.length >= 5 + pending.readUInt32BE(1)) {
          const n = 5 + pending.readUInt32BE(1)
          streamed.push(...grpcMessages(pending.subarray(0, n)))
          pending = pending.subarray(n)
        }
      })
      stream.on('end', () => {
        received.push({ path, messages: path === '/test/hid' ? [] : grpcMessages(Buffer.concat(chunks)), headers })
        if (path === '/test/silent') return // never answers
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

  it('gives up on a call that gets no answer', async () => {
    const client = new GrpcClient(socket)
    await expect(client.unary('/test/silent', Buffer.alloc(0), 200)).rejects.toThrow("didn't answer")
    client.close()
  })

  it('delivers a stream’s messages while the call stays open', async () => {
    const client = new GrpcClient(socket)
    const call = client.stream('/test/hid')
    call.write(Buffer.from('down'))
    await vi.waitFor(() => expect(streamed.map(String)).toEqual(['down']))
    call.write(Buffer.from('up'))
    await vi.waitFor(() => expect(streamed.map(String)).toEqual(['down', 'up']))
    call.close()
    call.write(Buffer.from('late')) // ignored once closed
    await vi.waitFor(() => expect(received.some((r) => r.path === '/test/hid')).toBe(true))
    expect(streamed.map(String)).toEqual(['down', 'up'])
    client.close()
  })

  it('says when the connection closes under it', async () => {
    const closed = vi.fn()
    const client = new GrpcClient(socket, closed)
    await client.unary('/test/describe', Buffer.from('hi'))
    serverSessions.at(-1)!.destroy()
    await vi.waitFor(() => expect(closed).toHaveBeenCalled())
  })

  it('never throws on a closed connection: a call rejects, a stream does nothing', async () => {
    const client = new GrpcClient(socket)
    client.close()
    await expect(client.unary('/test/describe', Buffer.alloc(0))).rejects.toThrow()
    const call = client.stream('/test/hid')
    expect(() => call.write(Buffer.from('x'))).not.toThrow()
    call.close()
  })

  it('rejects calls when nothing listens on the socket', async () => {
    const client = new GrpcClient(join(dir, 'missing.sock'))
    await expect(client.unary('/test/describe', Buffer.alloc(0))).rejects.toThrow()
    client.close()
  })
})
