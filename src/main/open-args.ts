/** The folder in `--open <folder>` or `--open=<folder>` (the Windows "Open in
 *  Deck" menu passes it), or null. Whether it exists is checked by the caller. */
export function folderFromArgv(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--open') return argv[i + 1] || null
    if (arg.startsWith('--open=')) return arg.slice('--open='.length) || null
  }
  return null
}
