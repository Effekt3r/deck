import { createHash } from 'node:crypto'
import { rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Clipboard images pasted into a terminal, as files Claude Code can read. They stay until Deck
 *  quits (Claude may read one only when the prompt is sent); the next start clears what a crash left. */
export class TempImages {
  constructor(readonly dir: string) {}

  /** The PNG's file, named by its content (saving the same image again rewrites the same file). */
  async save(png: Uint8Array): Promise<string> {
    const file = join(this.dir, `clipboard-${createHash('sha1').update(png).digest('hex').slice(0, 16)}.png`)
    await mkdir(this.dir, { recursive: true })
    await writeFile(file, png)
    return file
  }

  clear(): void {
    rmSync(this.dir, { recursive: true, force: true })
  }
}
