import { quoteImagePath, quotePaths } from '@shared/quote'
import type { InsertResult, Platform } from '@shared/types'
import type { ClipboardContent } from './item'

/** quotePath refused a path: it has control characters, which no quoting makes safe to paste. */
export const UNSAFE = "A file name has control characters, so it can't be pasted safely."

/** The image files Claude Code attaches when its path is pasted on its own. */
const IMAGE_FILE = /\.(png|jpe?g|gif|webp)$/i

export interface InsertDeps {
  platform: Platform
  /** Writes an image where Claude can read it; resolves with its path (TempImages.save). */
  saveImage(png: Uint8Array): Promise<string>
}

/** The text that inserts `content` into a terminal:
 *  - files: their quoted paths (Claude reads them), with a trailing space (Terminal.app/iTerm2
 *    paste file paths the same way, so two drops or pastes in a row don't run together);
 *  - text: as it is, no trailing space;
 *  - an image, in a tab running Claude: the quoted path of a saved PNG (with the same trailing
 *    space), which Claude Code attaches as [Image #N]; in a shell tab: null, nothing, as before. */
export async function insertFor(content: ClipboardContent, claude: boolean, deps: InsertDeps): Promise<InsertResult | null> {
  switch (content.kind) {
    case 'files': {
      if (!content.paths.length) return null // nothing to paste
      // One image file, in Claude: quoted as Claude Code reads an image path (on Windows its
      // backslashes doubled), so it's attached as [Image #N] there too.
      const [only] = content.paths
      const text = claude && content.paths.length === 1 && IMAGE_FILE.test(only)
        ? quoteImagePath(only, deps.platform)
        : quotePaths(content.paths, deps.platform)
      return text === null ? { error: UNSAFE } : { text: text + ' ' }
    }
    case 'text':
      return { text: content.text }
    case 'image':
      if (!claude) return null
      try {
        const text = quoteImagePath(await deps.saveImage(content.png), deps.platform)
        return text === null ? { error: UNSAFE } : { text: text + ' ' }
      } catch (err) {
        return { error: `Couldn't save the image for Claude: ${err instanceof Error ? err.message : String(err)}` }
      }
  }
}
