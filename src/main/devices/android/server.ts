import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface ScrcpyServer {
  /** The file pushed to the device. */
  path: string
  /** Passed to it: the server won't run for another version. */
  version: string
}

/** scrcpy's server in Deck's resources (process.resourcesPath when packaged, the repo's resources/
 *  in a dev build), with its version from scrcpy-server.json beside it. */
export async function scrcpyServer(resources: string): Promise<ScrcpyServer> {
  const path = join(resources, 'scrcpy-server')
  try {
    const info = JSON.parse(await readFile(join(resources, 'scrcpy-server.json'), 'utf8')) as { version?: unknown }
    await access(path)
    if (typeof info.version !== 'string' || !/^\d+(\.\d+)*$/.test(info.version)) throw new Error('no version')
    return { path, version: info.version }
  } catch {
    throw new Error("scrcpy's server isn't in Deck's resources. In a dev build, run npm run fetch:scrcpy.")
  }
}
