import { type ClipboardEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type Ref, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type WheelEvent } from 'react'
import type { DeviceInput, DeviceStreamEvent } from '@shared/types'
import { avcCodec, joined } from './codec'
import { type Box, fitSize, toFrame } from './fit'
import { deviceKey } from './keys'

export interface ScreenHandle {
  /** The screen now, as a PNG at the stream's size; null before the first picture. */
  screenshot(): Promise<Uint8Array | null>
}

interface DeviceScreenProps {
  deviceId: string
  name: string
  /** Stream now: the tab is in front, the panel unfolded, the window visible, the device ready. */
  live: boolean
  /** Why the device can't be shown (gone, not allowed, offline), over the dimmed last picture. */
  message: string | null
  handle?: Ref<ScreenHandle>
}

type StreamState = Extract<DeviceStreamEvent, { type: 'state' }>

/** More frames than this waiting to be decoded: skip to the next key frame. */
const MAX_QUEUE = 10
/** The decoder wants increasing timestamps, not real ones. */
const FRAME_US = 16_667

/** The window's pixel ratio, which changes when the window moves to a display with another scale
 *  (or zooms). */
function usePixelRatio(): number {
  const [ratio, setRatio] = useState(() => window.devicePixelRatio || 1)
  useEffect(() => {
    // The query matches only the ratio it was made for: a change ends the match, and the new ratio
    // makes a new query.
    const query = window.matchMedia(`(resolution: ${ratio}dppx)`)
    const update = () => setRatio(window.devicePixelRatio || 1)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [ratio])
  return ratio
}

/** One device's screen: its stream decoded with WebCodecs onto a canvas that fits the space, and
 *  the pointer and keyboard sent back as touches, scrolls, keys and text. */
export function DeviceScreen({ deviceId, name, live, message, handle }: DeviceScreenProps) {
  const platform = window.deck.platform
  const ratio = usePixelRatio()
  const areaRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [area, setArea] = useState<Box>({ width: 0, height: 0 })
  const [size, setSize] = useState<Box | null>(null)
  const [stream, setStream] = useState<StreamState>({ type: 'state', state: 'connecting' })
  /** The frame size touches are made for: scrcpy ignores a touch made for another size. */
  const sizeRef = useRef<Box | null>(null)
  const decoder = useRef<VideoDecoder | null>(null)
  const codec = useRef('')
  const config = useRef<Uint8Array | null>(null)
  const waitKey = useRef(true)
  /** The latest picture, kept for redraws and screenshots; each one before it is closed. */
  const frame = useRef<VideoFrame | null>(null)
  const timestamp = useRef(0)
  const touching = useRef(false)
  /** The last touch's point on the frame, to lift it there. */
  const lastTouch = useRef<{ x: number; y: number } | null>(null)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const picture = frame.current
    if (!canvas || !picture || canvas.width === 0) return
    canvas.getContext('2d')?.drawImage(picture, 0, 0, canvas.width, canvas.height)
  }, [])

  const closeDecoder = useCallback(() => {
    const d = decoder.current
    decoder.current = null
    codec.current = ''
    waitKey.current = true
    if (d && d.state !== 'closed') d.close()
  }, [])

  /** The frame changed size (the screen turned) under a touch: lift it at its last point, once for
   *  each size. scrcpy drops a touch made for another size than its own, and may switch before or
   *  after it says so. The pointer is then ignored until it's released. */
  const lift = useCallback((sizes: Box[]) => {
    const point = lastTouch.current
    if (!touching.current || !point) return
    touching.current = false
    for (const { width, height } of sizes) {
      const x = Math.min(point.x, width - 1)
      const y = Math.min(point.y, height - 1)
      window.deck.devices.input(deviceId, { type: 'touch', action: 'up', x, y, width, height })
    }
  }, [deviceId])

  useLayoutEffect(() => {
    const el = areaRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setArea((a) => (a.width === width && a.height === height ? a : { width, height }))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const drawn = size ? fitSize(area, size) : null
  // The canvas holds the drawn size at the window's pixel ratio, so the picture stays sharp.
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !drawn) return
    canvas.width = Math.round(drawn.width * ratio)
    canvas.height = Math.round(drawn.height * ratio)
    draw()
  }, [drawn?.width, drawn?.height, ratio, draw])

  // Viewing: main streams the device while any tab views it, and sends its news.
  useEffect(() => {
    if (!live) return
    const keyframe = () => window.deck.devices.keyframe(deviceId)
    const configure = (next: string) => {
      closeDecoder()
      const d = new VideoDecoder({
        output: (picture) => {
          frame.current?.close()
          frame.current = picture
          draw()
        },
        error: (err) => {
          console.error(`${deviceId}: the decoder failed`, err)
          if (decoder.current !== d) return
          closeDecoder()
          keyframe() // a new session follows: config, then a key frame
        },
      })
      d.configure({ codec: next, optimizeForLatency: true })
      decoder.current = d
      codec.current = next
    }
    const off = window.deck.devices.onStream((id, event) => {
      if (id !== deviceId) return
      if (event.type === 'state') return setStream(event)
      if (event.type === 'size') {
        const next = { width: event.width, height: event.height }
        const before = sizeRef.current
        sizeRef.current = next
        if (before && (before.width !== next.width || before.height !== next.height)) lift([before, next])
        setSize((s) => (s && s.width === next.width && s.height === next.height ? s : next))
        return
      }
      if (event.config) {
        config.current = event.data
        const next = avcCodec(event.data)
        if (next && (next !== codec.current || !decoder.current)) configure(next)
        waitKey.current = true
        return
      }
      const d = decoder.current
      if (!d || d.state !== 'configured' || (waitKey.current && !event.key)) return
      if (d.decodeQueueSize > MAX_QUEUE) {
        waitKey.current = true
        return keyframe()
      }
      try {
        d.decode(new EncodedVideoChunk({
          type: event.key ? 'key' : 'delta',
          timestamp: (timestamp.current += FRAME_US),
          data: event.key && config.current ? joined(config.current, event.data) : event.data,
        }))
        if (event.key) waitKey.current = false
      } catch (err) {
        console.error(`${deviceId}: a frame couldn't be decoded`, err)
        closeDecoder()
        keyframe()
      }
    })
    // Listening before viewing: main answers a view at once with the size and state it knows.
    const stopViewing = window.deck.devices.view(deviceId)
    return () => {
      stopViewing()
      off()
      closeDecoder() // the last picture stays until the stream comes back
    }
  }, [deviceId, live, draw, closeDecoder, lift])

  useEffect(() => () => {
    frame.current?.close()
    frame.current = null
  }, [])

  useImperativeHandle(handle, () => ({
    async screenshot() {
      const picture = frame.current
      if (!picture) return null
      const canvas = new OffscreenCanvas(picture.displayWidth, picture.displayHeight)
      canvas.getContext('2d')?.drawImage(picture, 0, 0)
      const blob = await canvas.convertToBlob({ type: 'image/png' })
      return new Uint8Array(await blob.arrayBuffer())
    },
  }), [])

  const interactive = live && !message
  const send = (input: DeviceInput) => window.deck.devices.input(deviceId, input)
  /** Where the pointer is, in the frame's pixels, with the frame's size. */
  const at = (e: { clientX: number; clientY: number; currentTarget: Element }) => {
    const frameSize = sizeRef.current
    const r = e.currentTarget.getBoundingClientRect()
    if (!frameSize || r.width === 0 || r.height === 0) return null
    return { ...toFrame(e.clientX - r.left, e.clientY - r.top, { width: r.width, height: r.height }, frameSize), ...frameSize }
  }
  const touch = (action: 'down' | 'move' | 'up', e: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = at(e)
    if (!point) return
    lastTouch.current = { x: point.x, y: point.y }
    send({ type: 'touch', action, ...point })
  }
  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!interactive || e.button !== 0) return
    e.currentTarget.focus()
    e.currentTarget.setPointerCapture(e.pointerId)
    touching.current = true
    touch('down', e)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (touching.current) touch('move', e)
  }
  const onPointerEnd = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!touching.current) return
    touching.current = false
    touch('up', e)
  }
  const onWheel = (e: WheelEvent<HTMLCanvasElement>) => {
    const point = at(e)
    if (!interactive || !point) return
    // About one step per wheel notch: 100 px, 3 lines or a page. Android scrolls right for a
    // positive dx, as the wheel's deltaX does, but up for a positive dy, against its deltaY.
    const unit = e.deltaMode === 1 ? 3 : e.deltaMode === 2 ? 1 : 100
    const step = (delta: number) => Math.max(-16, Math.min(16, delta / unit))
    send({ type: 'scroll', ...point, dx: step(e.deltaX), dy: step(-e.deltaY) })
  }
  const onKeyDown = (e: KeyboardEvent<HTMLCanvasElement>) => {
    if (!interactive) return
    // Off macOS there's no Edit menu to paste with: Ctrl+V and Ctrl+Shift+V paste here.
    if (platform !== 'darwin' && e.ctrlKey && !e.altKey && !e.metaKey && e.code === 'KeyV') {
      e.preventDefault()
      window.deck.clipboard.paste({ claude: false }).then((result) => {
        if (result && 'text' in result && result.text) send({ type: 'paste', text: result.text })
      }, () => {})
      return
    }
    // Built by hand: a KeyboardEvent says whether AltGr is held only through getModifierState.
    const native = e.nativeEvent
    const key = deviceKey({
      key: native.key, shiftKey: native.shiftKey, ctrlKey: native.ctrlKey, metaKey: native.metaKey, altKey: native.altKey,
      altGraph: native.getModifierState('AltGraph'), isComposing: native.isComposing,
    }, platform)
    if (!key) return
    e.preventDefault()
    send('keycode' in key ? { type: 'key', ...key } : { type: 'text', text: key.text })
  }
  // macOS: Cmd+V is the Edit menu's paste, which fires here while the screen has the keyboard.
  const onPaste = (e: ClipboardEvent<HTMLCanvasElement>) => {
    const text = e.clipboardData.getData('text/plain')
    if (!interactive || !text) return
    e.preventDefault()
    send({ type: 'paste', text })
  }

  const dim = message !== null || (live && stream.state !== 'live')
  return (
    <div className="dp-area" ref={areaRef}>
      {drawn && (
        <canvas ref={canvasRef} className={dim ? 'dp-screen dim' : 'dp-screen'} tabIndex={interactive ? 0 : -1}
          aria-label={`${name}'s screen`} style={{ width: drawn.width, height: drawn.height }}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd} onLostPointerCapture={onPointerEnd} onWheel={onWheel}
          onKeyDown={onKeyDown} onPaste={onPaste} onContextMenu={(e) => e.preventDefault()} />
      )}
      {message ? (
        <div className="dp-overlay" role="status"><strong>{message}</strong></div>
      ) : live && stream.state === 'error' ? (
        <div className="dp-overlay error" role="alert">
          <strong>Couldn't show {name}</strong>
          {stream.message && <span className="dp-overlay-detail">{stream.message}</span>}
          <button className="button" onClick={() => window.deck.devices.retry(deviceId)}>Try again</button>
        </div>
      ) : live && stream.state !== 'live' ? (
        <div className="dp-overlay" role="status">
          <span className="cp-spinner" aria-hidden="true" />
          {stream.state === 'reconnecting' ? 'Reconnecting…' : `Connecting to ${name}…`}
        </div>
      ) : null}
    </div>
  )
}
