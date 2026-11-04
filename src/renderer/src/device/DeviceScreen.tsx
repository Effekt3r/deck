import { type KeyboardEvent, type PointerEvent as ReactPointerEvent, type Ref, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type WheelEvent } from 'react'
import type { DeviceInput, DeviceStreamEvent } from '@shared/types'
import { avcCodec, joined } from './codec'
import { type Box, fitSize, toFrame } from './fit'
import { deviceKey } from './keys'

export interface ScreenHandle {
  /** The screen now, as a PNG at the stream's size; null while there's no live picture. */
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
/** Decoder failures in a row, with no picture in between, before the screen stops and says so. */
const MAX_FAILURES = 3
/** Key frames asked for because decoding fell behind: one a second at most, since each one restarts
 *  the device's encoder. */
const KEYFRAME_GAP_MS = 1000

/** The window's pixel ratio, which changes when the window moves to a display with another scale
 *  (or zooms). */
function usePixelRatio(): number {
  const [ratio, setRatio] = useState(() => window.devicePixelRatio || 1)
  useEffect(() => {
    const update = () => setRatio(window.devicePixelRatio || 1)
    update() // it may have changed between the render and now
    // The query matches only the ratio it was made for: a change ends the match, and the new ratio
    // makes a new query.
    const query = window.matchMedia(`(resolution: ${ratio}dppx)`)
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
  /** Why decoding stopped (MAX_FAILURES in a row); null while it works. */
  const [broken, setBroken] = useState<string | null>(null)
  const interactive = live && !message && broken === null
  /** The frame size touches are made for: scrcpy ignores a touch made for another size. */
  const sizeRef = useRef<Box | null>(null)
  const decoder = useRef<VideoDecoder | null>(null)
  const codec = useRef('')
  const config = useRef<Uint8Array | null>(null)
  const waitKey = useRef(true)
  /** Decoder failures since the last picture; after the first, decoders decode in software. */
  const failures = useRef(0)
  const software = useRef(false)
  const lastKeyframe = useRef(-Infinity)
  /** The latest picture, kept for redraws and screenshots; each one before it is closed. */
  const frame = useRef<VideoFrame | null>(null)
  const timestamp = useRef(0)
  /** The pointer touching the screen (one at a time: scrcpy gets one finger), and its last point on
   *  the frame, to lift it there. */
  const pointer = useRef<number | null>(null)
  const lastTouch = useRef<{ x: number; y: number } | null>(null)
  /** The picture is live: a screenshot of a stale one (reconnecting, failed) would mislead Claude. */
  const streaming = useRef(false)
  streaming.current = live && stream.state === 'live' && broken === null

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const picture = frame.current
    if (!canvas || !picture || canvas.width === 0) return
    // The screen turned: the canvas takes the new shape before the new picture comes, and the old
    // one would be stretched into it.
    if ((picture.displayWidth > picture.displayHeight) !== (canvas.width > canvas.height)) return
    canvas.getContext('2d')?.drawImage(picture, 0, 0, canvas.width, canvas.height)
  }, [])

  const closeDecoder = useCallback(() => {
    const d = decoder.current
    decoder.current = null
    codec.current = ''
    waitKey.current = true
    if (d && d.state !== 'closed') d.close()
  }, [])

  /** Lifts the finger at its last point, once for each of `sizes`, and ignores the pointer until
   *  it's released. The frame changed size under it (the screen turned: scrcpy drops a touch made
   *  for another size than its own, and may switch before or after it says so), or the screen went
   *  away mid-touch (a tab switch, the panel folded). */
  const lift = useCallback((sizes: Box[]) => {
    const point = lastTouch.current
    if (pointer.current === null) return
    pointer.current = null
    if (!point) return
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
    // Each view starts afresh: a decoder that gave up gets another try.
    failures.current = 0
    setBroken(null)
    const keyframe = () => {
      lastKeyframe.current = performance.now()
      window.deck.devices.keyframe(deviceId)
    }
    /** A decoder failed (its error, or a frame it refused). A new one starts at the next key frame,
     *  in software from now on, since most such failures are the GPU decoder's; after MAX_FAILURES
     *  with no picture in between, the screen says so rather than restart the device's encoder over
     *  and over. */
    const failed = (err: unknown) => {
      console.error(`${deviceId}: decoding failed`, err)
      closeDecoder()
      software.current = true
      if (++failures.current >= MAX_FAILURES) return setBroken(err instanceof Error ? err.message : String(err))
      keyframe() // a new session follows: config, then a key frame
    }
    const configure = (next: string) => {
      closeDecoder()
      const d = new VideoDecoder({
        output: (picture) => {
          failures.current = 0
          frame.current?.close()
          frame.current = picture
          draw()
        },
        error: (err) => {
          if (decoder.current === d) failed(err)
        },
      })
      decoder.current = d
      codec.current = next
      d.configure({ codec: next, optimizeForLatency: true, ...(software.current ? { hardwareAcceleration: 'prefer-software' as const } : {}) })
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
        waitKey.current = true
        if (failures.current >= MAX_FAILURES) return // stopped: Try again starts over
        const next = avcCodec(event.data)
        if (!next || (next === codec.current && decoder.current)) return
        try {
          configure(next)
        } catch (err) {
          failed(err)
        }
        return
      }
      const d = decoder.current
      if (!d || d.state !== 'configured' || (waitKey.current && !event.key)) return
      if (d.decodeQueueSize > MAX_QUEUE) {
        // Behind: skip to a key frame, asking for one unless one was asked for just now.
        waitKey.current = true
        if (performance.now() - lastKeyframe.current >= KEYFRAME_GAP_MS) keyframe()
        return
      }
      try {
        d.decode(new EncodedVideoChunk({
          type: event.key ? 'key' : 'delta',
          timestamp: (timestamp.current += FRAME_US),
          data: event.key && config.current ? joined(config.current, event.data) : event.data,
        }))
        if (event.key) waitKey.current = false
      } catch (err) {
        failed(err)
      }
    })
    // Listening before viewing: main answers a view at once with the size and state it knows.
    const stopViewing = window.deck.devices.view(deviceId)
    return () => {
      // A finger still down when the screen goes is lifted first.
      if (sizeRef.current) lift([sizeRef.current])
      stopViewing()
      off()
      closeDecoder() // the last picture stays until the stream comes back
    }
  }, [deviceId, live, draw, closeDecoder, lift])

  // Pastes: the Edit menu's paste (Cmd+V on macOS) and the browser's own Ctrl+V elsewhere fire at the
  // element holding the page's text selection when there is one (Claude's reply, or after Cmd+A),
  // else at the focused one. So the document listens, and a paste is the device's while the screen
  // has the keyboard.
  useEffect(() => {
    if (!interactive) return
    const onPaste = (e: ClipboardEvent) => {
      if (document.activeElement !== canvasRef.current) return
      const text = e.clipboardData?.getData('text/plain')
      if (!text) return
      e.preventDefault()
      window.deck.devices.input(deviceId, { type: 'paste', text })
    }
    document.addEventListener('paste', onPaste, true)
    return () => document.removeEventListener('paste', onPaste, true)
  }, [interactive, deviceId])

  useEffect(() => () => {
    frame.current?.close()
    frame.current = null
  }, [])

  useImperativeHandle(handle, () => ({
    async screenshot() {
      const picture = frame.current
      if (!picture || !streaming.current) return null
      const canvas = new OffscreenCanvas(picture.displayWidth, picture.displayHeight)
      canvas.getContext('2d')?.drawImage(picture, 0, 0)
      const blob = await canvas.convertToBlob({ type: 'image/png' })
      return new Uint8Array(await blob.arrayBuffer())
    },
  }), [])

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
    if (!interactive || e.button !== 0 || pointer.current !== null) return
    // A text selection elsewhere in Deck would take the next paste (the paste listener above).
    window.getSelection()?.removeAllRanges()
    e.currentTarget.focus()
    e.currentTarget.setPointerCapture(e.pointerId)
    pointer.current = e.pointerId
    touch('down', e)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerId === pointer.current) touch('move', e)
  }
  const onPointerEnd = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerId !== pointer.current) return
    // Hidden mid-touch (display: none), the pointer maps to nowhere: lift it where it was.
    if (!at(e)) return lift(sizeRef.current ? [sizeRef.current] : [])
    pointer.current = null
    touch('up', e)
  }
  const onWheel = (e: WheelEvent<HTMLCanvasElement>) => {
    const point = at(e)
    // A trackpad pinch arrives as a wheel with Ctrl held: it isn't a scroll.
    if (!interactive || !point || e.ctrlKey) return
    // About one step per wheel notch: 100 px, 3 lines or a page. Android scrolls right for a
    // positive dx, as the wheel's deltaX does, but up for a positive dy, against its deltaY.
    const unit = e.deltaMode === 1 ? 3 : e.deltaMode === 2 ? 1 : 100
    const step = (delta: number) => Math.max(-16, Math.min(16, delta / unit))
    send({ type: 'scroll', ...point, dx: step(e.deltaX), dy: step(-e.deltaY) })
  }
  const onKeyDown = (e: KeyboardEvent<HTMLCanvasElement>) => {
    if (!interactive) return
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
  const tryAgain = () => {
    failures.current = 0
    setBroken(null)
    window.deck.devices.keyframe(deviceId)
  }

  // Main's stream failed (it retries, then gives up), or decoding did: each has its own Try again.
  const failure = stream.state === 'error'
    ? { detail: stream.message, retry: () => window.deck.devices.retry(deviceId) }
    : broken !== null
      ? { detail: broken, retry: tryAgain }
      : null
  const dim = message !== null || (live && (stream.state !== 'live' || broken !== null))
  return (
    <div className="dp-area" ref={areaRef}>
      {drawn && (
        // Not interactive (gone, not allowed, not streaming), a click leaves the keyboard where it was.
        <canvas ref={canvasRef} className={dim ? 'dp-screen dim' : 'dp-screen'} tabIndex={interactive ? 0 : undefined}
          aria-label={`${name}'s screen`} style={{ width: drawn.width, height: drawn.height }}
          onMouseDown={interactive ? undefined : (e) => e.preventDefault()}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd} onLostPointerCapture={onPointerEnd} onWheel={onWheel}
          onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()} />
      )}
      {message ? (
        <div className="dp-overlay" role="status"><strong>{message}</strong></div>
      ) : live && failure ? (
        <div className="dp-overlay error" role="alert">
          <strong>Couldn't show {name}</strong>
          {failure.detail && <span className="dp-overlay-detail">{failure.detail}</span>}
          <button className="button" onClick={failure.retry}>Try again</button>
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
