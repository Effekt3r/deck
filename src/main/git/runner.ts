import { execFile } from 'node:child_process'

export class GitError extends Error {
  constructor(message: string, readonly stderr: string, readonly code: number | null) {
    super(message)
    this.name = 'GitError'
  }
}

// `git rev-parse --local-env-vars`: set by a parent git (inside a hook, say), they would
// point every command at that repo instead of the one passed with -C.
const REPO_LOCAL_VARS = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT',
  'GIT_OBJECT_DIRECTORY', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_IMPLICIT_WORK_TREE', 'GIT_GRAFT_FILE',
  'GIT_INDEX_FILE', 'GIT_NO_REPLACE_OBJECTS', 'GIT_REPLACE_REF_BASE', 'GIT_PREFIX', 'GIT_SHALLOW_FILE',
  'GIT_COMMON_DIR',
]

/** The environment every git call gets. */
export function gitEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base }
  for (const name of REPO_LOCAL_VARS) delete env[name]
  // Never take index.lock while Claude commits in the terminal; never wait on a credential prompt.
  env.GIT_OPTIONAL_LOCKS = '0'
  env.GIT_TERMINAL_PROMPT = '0'
  // Partial clones: a diff would otherwise fetch missing blobs from the remote, writing into
  // .git and maybe raising a credential prompt (git 2.44+; older versions ignore it).
  env.GIT_NO_LAZY_FETCH = '1'
  env.GCM_INTERACTIVE = 'never' // Git Credential Manager must never open a sign-in window
  return env
}

/**
 * stdout of `git -C repo -c core.fsmonitor=false -c core.quotePath=false <args>`.
 * fsmonitor is off because a repo's config could otherwise start a daemon or run a command of its
 * choosing on every refresh. Throws GitError.
 */
export function git(repo: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<string> {
  // `git -C ''` would quietly run in the app's own working directory.
  if (!repo) return Promise.reject(new GitError('git: no repository given', '', null))
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      ['-C', repo, '-c', 'core.fsmonitor=false', '-c', 'core.quotePath=false', '-c', 'color.ui=false',
        '-c', 'i18n.logOutputEncoding=UTF-8', ...args],
      {
        env: gitEnv(),
        encoding: 'utf8',
        timeout: opts.timeoutMs ?? 15_000,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        if (!err) return resolve(stdout)
        const code = typeof err.code === 'number' ? err.code : null
        reject(new GitError(stderr.trim() || err.message, stderr, code))
      },
    )
    // Nothing we run reads stdin: EOF instead of a hang if something does. A git that exits
    // first makes this an EPIPE, which must not become an uncaught error.
    child.stdin?.on('error', () => {})
    child.stdin?.end()
  })
}

/** Like git() but resolves null instead of throwing. */
export function tryGit(repo: string, args: string[], opts?: { timeoutMs?: number }): Promise<string | null> {
  return git(repo, args, opts).catch(() => null)
}

/** Exit status 0? (for --is-ancestor, --verify). */
export function gitOk(repo: string, args: string[]): Promise<boolean> {
  return git(repo, args).then(() => true, () => false)
}
