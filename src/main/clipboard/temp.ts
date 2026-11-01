import { createHash, randomUUID } from 'node:crypto'
import { readdirSync, rmdirSync, unlinkSync } from 'node:fs'
import { mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** What save() writes (and a write in progress). clear() removes only these. */
const OURS = /^clipboard-[0-9a-f]{16}\.png(\.[0-9a-f-]{36}\.tmp)?$/

/** Windows can hold a just-written file for a moment (Defender, the indexer): retry briefly. */
async function renameRetrying(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(from, to)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (attempt >= 4 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw err
      await new Promise((r) => setTimeout(r, 50 * (attempt + 1)))
    }
  }
}

/** Clipboard images pasted into a terminal, as files Claude Code can read. They stay until Deck
 *  quits (Claude may read one only when the prompt is sent); the next start clears what a crash left. */
export class TempImages {
  constructor(readonly dir: string) {}

  /** The PNG's file, named by its content. An existing file is the same image and stays as it is;
   *  a new one is written under its own temp name (so two saves of the same new image can't
   *  collide on one) and renamed, so a reader never sees half a file. */
  async save(png: Uint8Array): Promise<string> {
    const file = join(this.dir, `clipboard-${createHash('sha1').update(png).digest('hex').slice(0, 16)}.png`)
    if (await stat(file).then((s) => s.isFile() && s.size === png.length, () => false)) return file
    await mkdir(this.dir, { recursive: true, mode: 0o700 })
    const tmp = `${file}.${randomUUID()}.tmp`
    await writeFile(tmp, png, { mode: 0o600 })
    try {
      await renameRetrying(tmp, file)
    } catch (err) {
      await unlink(tmp).catch(() => {})
      throw err
    }
    return file
  }

  /** Removes the images save() wrote, then the folder if that empties it. Never throws: it runs at
   *  startup, before the window opens, and at quit; whatever stays, the next start tries again. */
  clear(): void {
    let names: string[]
    try {
      names = readdirSync(this.dir)
    } catch {
      return // no folder (or unreadable)
    }
    for (const name of names) {
      if (!OURS.test(name)) continue
      try {
        unlinkSync(join(this.dir, name))
      } catch {
        // held by another process (Windows) or not ours to delete
      }
    }
    try {
      rmdirSync(this.dir)
    } catch {
      // not empty, or held
    }
  }
}
