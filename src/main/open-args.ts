/** The folder in `--open <folder>` or `--open=<folder>` (the Windows "Open in
 *  Deck" menu passes it), or null. Whether it exists is checked by the caller. */
export function folderFromArgv(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--open') return clean(argv[i + 1])
    if (arg.startsWith('--open=')) return clean(arg.slice('--open='.length))
  }
  return null
}

/** Explorer passes a drive root as `"C:\"`, and Windows reads `\"` as an escaped
 *  quote, so it arrives as `C:"`. Quotes can't occur in Windows paths. */
function clean(folder: string | undefined): string | null {
  if (!folder) return null
  return /^[A-Za-z]:[^"]*"$/.test(folder) ? `${folder.slice(0, -1)}\\` : folder
}
