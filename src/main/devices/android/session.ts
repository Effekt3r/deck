import type { DeviceSession } from '../session'
import { controlMessages } from './input'
import { resetVideoMessage } from './protocol'
import type { ScrcpySession } from './scrcpy'

/** scrcpy's session as a stream's: input becomes scrcpy's control messages, a key frame its reset
 *  video. */
export function androidSession(scrcpy: ScrcpySession): DeviceSession {
  return {
    input: (input) => {
      for (const message of controlMessages(input)) scrcpy.send(message)
    },
    keyframe: () => scrcpy.send(resetVideoMessage()),
    stop: () => scrcpy.stop(),
  }
}
