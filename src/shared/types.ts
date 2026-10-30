export type Platform = 'darwin' | 'win32' | 'linux'

/** projects.json in the app's userData folder. */
export interface ProjectsConfig {
  /** Typed into a new tab opened with "Claude", e.g. `claude --effort max …`. */
  command: string
  /** Folders always listed first, in this order (absolute or `~/…`). */
  pinned: string[]
  /** Folders whose sub-folders and git repos are listed. */
  scan: string[]
  /** How deep to look for git repos under each scan folder (1 = direct children). */
  depth: number
}

export interface ProjectItem {
  /** Absolute, normalised path. */
  path: string
  name: string
  /** Branch name; short sha when detached; '?' for an unreadable worktree pointer; null when not a git repo. */
  branch: string | null
  pinned: boolean
  /** ms since epoch: newest of .git/index, .git/HEAD, .git/FETCH_HEAD and the folder itself. */
  activity: number
}

export interface ProjectStatus {
  path: string
  /** Staged or modified paths. */
  changed: number
  untracked: number
  conflicts: number
}

export interface PtyCreateOptions {
  /** Folder the shell starts in; empty or missing folders fall back to the home folder. */
  cwd: string
  /** Typed into the shell (followed by Enter) once its first prompt appears. */
  command?: string
  cols: number
  rows: number
}

export interface PtyInfo {
  id: string
  /** Shell executable, e.g. /bin/zsh or pwsh.exe. */
  shell: string
  pid: number
}

export type MenuCommand =
  | { type: 'new-tab' }
  | { type: 'close-tab' }
  | { type: 'next-tab' }
  | { type: 'prev-tab' }
  | { type: 'select-tab'; index: number } // 1-based, 9 = last tab
  | { type: 'projects' }
  | { type: 'find' }
  | { type: 'toggle-git' }

export type ProjectAction = 'claude' | 'shell'

export interface AppInfo {
  home: string
  version: string
  /** Windows build (e.g. 26100); xterm only reflows ConPTY output when it knows it. */
  windowsBuild?: number
}

export interface GitRef {
  name: string
  /** head: HEAD itself when detached; branch: local; remote: origin/…; tag. */
  kind: 'head' | 'branch' | 'remote' | 'tag'
  /** This branch is the one checked out (HEAD -> name). */
  current?: boolean
}

export interface GitCommit {
  hash: string
  parents: string[]
  refs: GitRef[]
  subject: string
  /** Committer time, ms since epoch. */
  time: number
  author: string
}

export interface GitCounts {
  staged: number
  changed: number
  untracked: number
  conflicts: number
}

export interface GitSummary {
  /** Work-tree root as git reports it. */
  root: string
  /** null when HEAD is detached. */
  branch: string | null
  /** Short hash of HEAD ('' in a repo without commits). */
  head: string
  operation: 'merge' | 'rebase' | 'cherry-pick' | 'revert' | null
  upstream: { ref: string; ahead: number; behind: number } | null
  /** Where this branch merges next; null for main/master or when nothing fits. */
  target: { ref: string; ahead: number; behind: number; source: 'deck' | 'git-config' | 'auto' } | null
  counts: GitCounts
}

export interface GitSnapshot {
  summary: GitSummary
  /** First page of `git log --all --exclude=refs/stash --date-order`. */
  commits: GitCommit[]
  hasMore: boolean
  /** Commits in target..HEAD (at most 2000). */
  toMerge: string[]
}

export interface GitFileChange {
  /** A, M, D, R, C, T or U. */
  status: string
  path: string
  oldPath?: string
  /** null for binary files. */
  additions: number | null
  deletions: number | null
}

export interface GitCommitDetails {
  hash: string
  parents: string[]
  author: string
  email: string
  time: number
  /** Full message (subject + body). */
  message: string
  /** Against the first parent; a root commit against the empty tree. */
  files: GitFileChange[]
}

export interface DeckApi {
  platform: Platform
  pty: {
    create(opts: PtyCreateOptions): Promise<PtyInfo>
    write(id: string, data: string): void
    resize(id: string, cols: number, rows: number): void
    kill(id: string): void
    /** The terminal has processed `chars` characters of output (flow control). */
    ack(id: string, chars: number): void
    onData(cb: (id: string, data: string) => void): () => void
    onExit(cb: (id: string, exitCode: number) => void): () => void
    /** The pty's foreground process changed (e.g. 'zsh' → 'claude'). */
    onProcess(cb: (id: string, name: string) => void): () => void
  }
  projects: {
    list(): Promise<ProjectItem[]>
    status(paths: string[]): Promise<ProjectStatus[]>
    getConfig(): Promise<ProjectsConfig>
    setConfig(config: ProjectsConfig): Promise<ProjectsConfig>
    togglePin(path: string): Promise<ProjectsConfig>
    /** Native context menu. Pin, reveal and copy are handled in main; open choices come back. */
    contextMenu(path: string): Promise<ProjectAction | null>
  }
  git: {
    /** Starts watching; resolves with the current state, or null when `repo` isn't a git repo. */
    subscribe(repo: string): Promise<GitSnapshot | null>
    unsubscribe(repo: string): void
    /** A newer snapshot of a subscribed repo. */
    onUpdate(cb: (repo: string, snapshot: GitSnapshot) => void): () => void
    /** More history after the first `skip` commits. */
    logPage(repo: string, skip: number, limit: number): Promise<GitCommit[]>
    details(repo: string, hash: string): Promise<GitCommitDetails | null>
    /** Refs that can be chosen as merge target (local branches, then origin/…). */
    targets(repo: string): Promise<string[]>
    /** Override the merge target of `branch` (null: back to automatic). */
    setTarget(repo: string, branch: string, target: string | null): Promise<void>
  }
  app: {
    info(): Promise<AppInfo>
    openExternal(url: string): void
    copyText(text: string): void
    readText(): Promise<string>
    /** A folder to open in a new shell tab: --open, macOS open-file, second launch. */
    onOpenFolder(cb: (path: string) => void): () => void
    onMenu(cb: (cmd: MenuCommand) => void): () => void
    /** Renderer is listening; main then delivers queued folders. */
    ready(): void
  }
}
