import type { DeviceStreamEvent } from '@shared/types'

/** One packet of a stream: H.264, Annex B. */
export type StreamPacket = Omit<Extract<DeviceStreamEvent, { type: 'packet' }>, 'type'>

/** What a starting stream reports, whatever the device. */
export interface StreamEvents {
  /** A capture session started: the frames that follow have this size. */
  size(width: number, height: number): void
  packet(packet: StreamPacket): void
  /** The stream ended by itself: why. Not called after stop(). */
  end(why: string): void
}

/** A running stream: scrcpy's server on an Android device, idb on a simulator. None of its methods
 *  throws: a throw there would leave the caller's work half done (halt() among the streams) and
 *  reach only main's last-resort log. DeviceStreams guards them anyway. */
export interface DeviceSession {
  /** The renderer's input, unchecked: the session checks it and drops what it can't use. */
  input(input: unknown): void
  /** A key frame, for a viewer that joins or a decoder that fell behind. */
  keyframe(): void
  stop(): void
}
