import { createHash } from 'node:crypto'
import { readdirSync, rmdirSync, unlinkSync } from 'node:fs'
import { mkdir, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** What save() writes (and a write in progress). clear() removes only these. */
const OURS = /^clipboard-[0-9a-f]{16}\.png(\.tmp)?$/

/** Clipboard images pasted into a terminal, as files Claude Code can read. They stay until Deck
 *  quits (Claude may read one only when the prompt is sent); the next start clears what a crash left. */
export class TempImages {
  constructor(readonly dir: string) {}

  /** The PNG's file, named by its content. An existing file is the same image and stays as it is;
   *  a new one is written beside it and renamed, so a reader never sees half a file. */
  async save(png: Uint8Array): Promise<string> {
    const file = join(this.dir, `clipboard-${createHash('sha1').update(png).digest('hex').slice(0, 16)}.png`)
    if (await stat(file).then((s) => s.size === png.length, () => false)) return file
    await mkdir(this.dir, { recursive: true, mode: 0o700 })
    await writeFile(`${file}.tmp`, png, { mode: 0o600 })
    await rename(`${file}.tmp`, file)
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
