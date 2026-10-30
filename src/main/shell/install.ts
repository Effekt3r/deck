import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
// Bundled as strings, so there is nothing extra to package. The zsh wrappers
// live without their leading dot here and are installed with it.
import zshenv from './scripts/zsh/zshenv?raw'
import zprofile from './scripts/zsh/zprofile?raw'
import zshrc from './scripts/zsh/zshrc?raw'
import zlogin from './scripts/zsh/zlogin?raw'
import deckZsh from './scripts/zsh/deck.zsh?raw'
import deckPs1 from './scripts/pwsh/deck.ps1?raw'

const FILES: Record<string, string> = {
  'zsh/.zshenv': zshenv,
  'zsh/.zprofile': zprofile,
  'zsh/.zshrc': zshrc,
  'zsh/.zlogin': zlogin,
  'zsh/deck.zsh': deckZsh,
  'pwsh/deck.ps1': deckPs1,
}

/** Writes the shell-integration scripts under `dir` (rewriting only files whose
 *  content changed) and returns `dir`, the integrationDir for shellLaunch(). */
export async function installShellIntegration(dir: string): Promise<string> {
  for (const [rel, content] of Object.entries(FILES)) {
    const file = join(dir, rel)
    await mkdir(dirname(file), { recursive: true })
    const current = await readFile(file, 'utf8').catch(() => null)
    if (current !== content) await writeFile(file, content)
  }
  return dir
}
