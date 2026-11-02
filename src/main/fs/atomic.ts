import { chmod, rename, rm, writeFile } from 'node:fs/promises'

/** Two writes of one file in flight at once still get their own temp files. */
let seq = 0

/** Windows: a virus scanner or indexer briefly holding the target makes rename fail with
 *  EPERM/EBUSY; a few short retries get past it. */
export async function renameRetrying(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(from, to)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (attempt >= 4 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw err
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)))
    }
  }
}

/** `text` written beside `file` and renamed over it, so a reader never sees half a file. `mode`
 *  (permission bits) is set on the new file before it takes the old one's place. */
export async function writeFileAtomic(file: string, text: string, mode?: number): Promise<void> {
  const tmp = `${file}.${process.pid}.${++seq}.tmp`
  try {
    await writeFile(tmp, text, 'utf8')
    if (mode !== undefined) await chmod(tmp, mode)
    await renameRetrying(tmp, file)
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {})
    throw err
  }
}
