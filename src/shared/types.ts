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
  | { type: 'toggle-claude' }
  | { type: 'toggle-device' }

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
  /** First page of `git log --exclude=refs/stash --all --date-order` (the exclude only applies to an `--all` after it). */
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
  /** Line counts couldn't be computed (e.g. a partial clone without the blobs locally). */
  countsUnavailable?: boolean
}

export type ClaudeState =
  | 'working' // a turn is open, no tool pending
  | 'tool' // a tool is running (detail: its name)
  | 'waiting' // AskUserQuestion / ExitPlanMode pending (detail: tool name)
  | 'maybe-waiting' // a tool pending and the log silent > 8 s outside bypass mode (a permission prompt?)
  | 'idle' // the turn ended
  | 'quiet' // a turn open but the log silent > 10 min (killed? stuck?)
  | 'exited' // Claude quit (cost-state)
  | 'error' // the last thing was an API error (detail: its text)

export interface ClaudeStatus {
  state: ClaudeState
  detail?: string
  /** Sub-agents still running. */
  agents: number
  /** Background shell tasks still running. */
  background: number
}

export interface ClaudeSessionSummary {
  id: string
  /** Absolute path of the .jsonl log. */
  path: string
  /** Custom title (/rename) > AI title > first prompt (first line, 80 chars) > ''. */
  title: string
  /** Log last written, ms since epoch. */
  modified: number
}

export interface ClaudeTodo {
  status: string // 'pending' | 'in_progress' | 'completed' | …
  text: string
}

export interface ClaudeAgent {
  toolUseId: string
  type: string
  description: string
  done: boolean
  failed: boolean
  /** Its latest tool call or reply, while running. */
  step?: string
}

export type ClaudeFeedItem =
  | { kind: 'prompt'; text: string }
  | { kind: 'thinking'; text: string } // '' when the log kept only the signature
  | { kind: 'reply'; text: string } // markdown
  | { kind: 'tool'; id: string; name: string; summary: string; state: 'running' | 'done' | 'error'; error?: string }
  | { kind: 'notice'; text: string; tone: 'info' | 'error' }

export interface ClaudeSnapshot {
  session: ClaudeSessionSummary & {
    /** e.g. 'claude-opus-5-5' ('' until the first reply). */
    model: string
    contextTokens: number
    branch: string
    /** Permission mode: 'default', 'bypassPermissions', 'plan', 'acceptEdits', 'auto' or ''. */
    mode: string
    /** e.g. 'PR #31', or null. */
    pr: string | null
  }
  status: ClaudeStatus
  todos: ClaudeTodo[]
  agents: ClaudeAgent[]
  /** Oldest first, at most 300 items; long texts are cut. */
  feed: ClaudeFeedItem[]
  /** 'newest' follows the folder's newest session; 'pinned' stays on the one picked. */
  following: 'newest' | 'pinned'
}

/** The session a tab's panel showed (its last snapshot), handed back when the tab subscribes again. */
export interface ClaudeResume {
  sessionId: string
  /** It was pinned (snapshot.following === 'pinned'). */
  pinned: boolean
}

/** The item the clipboard card offers: what Cmd/Ctrl+V would paste now. */
export type ClipboardPreview =
  | {
      id: string
      kind: 'image'
      /** In pixels. */
      width: number
      height: number
      /** A small PNG of it, as a data: URL. */
      thumbnail: string
    }
  | {
      id: string
      kind: 'files'
      /** The first three file names. */
      names: string[]
      /** How many more files there are. */
      more: number
      /** The first file's folder. */
      folder: string
      /** Small PNGs of the named files that are images, as data: URLs, one per name ('' for the
       *  others). Absent until the OS has made them: they come in a second update of the item. */
      thumbnails?: string[]
    }
  | {
      id: string
      kind: 'text'
      /** The first three lines, each cut at 120 characters. */
      lines: string[]
      lineCount: number
    }

/** Text for a terminal to paste, or why there is none. */
export type InsertResult = { text: string } | { error: string }

/** One of Claude's plan limits, as Claude Code's status line last reported it (`rate_limits`). */
export interface UsageWindow {
  /** 0–100. */
  usedPercentage: number
  /** When the window resets: ms since the epoch. */
  resetsAt: number
}

/** Deck and Claude Code's status line, which is how Deck gets the numbers. */
export type UsageLink =
  /** Deck's command is the status line in Claude Code's user settings. */
  | { state: 'connected' }
  /** No status line is set. */
  | { state: 'off' }
  /** Another status line is set: `command` is what it runs. */
  | { state: 'other'; command: string }
  /** Claude Code's settings can't be read, so Deck won't write them. */
  | { state: 'error'; message: string }

/** What the usage card shows. */
export interface UsageState {
  link: UsageLink
  /** Claude Code's user settings file, which Connect changes. */
  settingsFile: string
  fiveHour: UsageWindow | null
  sevenDay: UsageWindow | null
  /** When Claude Code last reported (ms since the epoch); null before its first report. */
  updatedAt: number | null
}

/** Connect's or Disconnect's outcome: the new state, or what went wrong. */
export type UsageChange = { state: UsageState } | { error: string }

/** An Android phone or emulator that adb sees. */
export interface DeviceInfo {
  /** The same across reconnects and connections: `android:<serial number>`,
   *  `emulator:<AVD name>` (an emulator's adb name changes with its port), or `simulator:<UDID>`. */
  id: string
  kind: 'android' | 'emulator' | 'simulator'
  /** The name set on the phone ("Franco's S25 FE"), else its maker and model; an emulator's AVD
   *  name; a simulator's name. */
  name: string
  /** Its system and connection: "Android 13 · USB", "Android 17 · USB + Wi-Fi",
   *  "Emulator · Android 15", "Simulator · iOS 27.0". */
  detail: string
  /** ready: it can be shown; unauthorized: USB debugging isn't allowed on it yet; offline: adb
   *  can't reach it; connecting: adb is still setting it up. */
  state: 'ready' | 'unauthorized' | 'offline' | 'connecting'
}

/** What a device runs: Android phones and emulators, or iOS simulators. */
export type DevicePlatform = 'android' | 'ios'

/** The devices Deck sees, or why it sees none. */
export interface DeviceList {
  devices: DeviceInfo[]
  /** Android: 'no-adb': adb wasn't found; { error }: adb failed; null: adb runs. */
  problem: 'no-adb' | { error: string } | null
  /** Simulators (macOS): 'no-idb': one is booted but idb-companion isn't installed; 'old-idb': the
   *  idb-companion found has no sim-video; { error }: its notifier failed; null otherwise. */
  ios: 'no-idb' | 'old-idb' | { error: string } | null
  /** The kinds still finding their first devices: a tab waits only for the ones it shows. */
  pending: DevicePlatform[]
}

/** A tab's project, for the device panel. */
export interface DeviceProject {
  /** Its repository's main work tree (worktrees share it), or the folder outside git. */
  root: string
  /** It's an Android app, so it takes Android phones and emulators. */
  android: boolean
  /** The devices picked in it, latest first (at most 8). */
  picks: string[]
}

/** News of a device's stream. */
export type DeviceStreamEvent =
  /** connecting: starting; live: frames are coming; reconnecting: it broke and is starting again;
   *  error: it couldn't be started (`message`), until Try again. */
  | { type: 'state'; state: 'connecting' | 'live' | 'reconnecting' | 'error'; message?: string }
  /** A capture session started (also after a rotation): the frames that follow have this size. */
  | { type: 'size'; width: number; height: number }
  /** H.264, Annex B. A config packet holds SPS and PPS, which the next key frame needs. */
  | { type: 'packet'; config: boolean; key: boolean; data: Uint8Array }

/** Input for a device. Positions are in the frame's pixels with the frame's size (the last 'size'):
 *  scrcpy ignores a touch made for another size. */
export type DeviceInput =
  | { type: 'touch'; action: 'down' | 'move' | 'up'; x: number; y: number; width: number; height: number }
  /** dx, dy: scroll steps, -16 … 16; a positive dx scrolls right, a positive dy up (like a wheel
   *  pushed away). */
  | { type: 'scroll'; x: number; y: number; width: number; height: number; dx: number; dy: number }
  /** An Android key code pressed and let go, with Android's meta state (shift 1, alt 2). */
  | { type: 'key'; keycode: number; meta: number }
  /** A simulator's named key (`HID_KEY` in @shared/hid) with `HID_MOD` bits. */
  | { type: 'hid'; usage: number; modifiers: number }
  /** A simulator's Home button. */
  | { type: 'button'; button: 'home' }
  | { type: 'text'; text: string }
  /** Puts `text` on the device's clipboard and pastes it. */
  | { type: 'paste'; text: string }

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
    /** Starts watching; resolves with the current state, or null when `repo` isn't a git repo.
     *  Rejects when git fails before a first snapshot exists (the subscription stays and updates follow). */
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
  claude: {
    /** Follows the newest session for `folder` (and its worktrees). null: none yet; updates follow when one starts.
     *  Only the active tab subscribes, and the folder's follow state is set from `resume`, the session this tab
     *  showed: pinned, it stays pinned; else it is followed until a newer session takes over (once it has been
     *  quiet for 15 s). No resume, or a session that isn't the folder's: the newest. */
    subscribe(folder: string, resume?: ClaudeResume | null): Promise<ClaudeSnapshot | null>
    unsubscribe(folder: string): void
    onUpdate(cb: (folder: string, snapshot: ClaudeSnapshot | null) => void): () => void
    /** The folder's sessions, newest first (for the picker). */
    sessions(folder: string): Promise<ClaudeSessionSummary[]>
    /** Follow one session (by id), or the newest again (null). */
    follow(folder: string, sessionId: string | null): Promise<void>
  }
  clipboard: {
    /** The item the card offers now, or null. */
    current(): Promise<ClipboardPreview | null>
    /** The card's item changed: a new copy, or null once it was used or dismissed, or the clipboard
     *  moved to something that gets no card. */
    onItem(cb: (item: ClipboardPreview | null) => void): () => void
    /** The text that inserts this item: the snapshot the card shows, even if the clipboard changed
     *  since. A successful add uses the item up; { error } when the item is gone, an image can't be
     *  saved, or a file name can't be pasted safely. */
    add(id: string): Promise<InsertResult>
    /** What Cmd/Ctrl+V inserts now: { text }, or { error } when the clipboard can't be read, an image
     *  can't be saved, or a file name can't be pasted safely; null: nothing (an empty clipboard, or
     *  an image in a shell tab). Pasting the card's item uses it up. */
    paste(opts: { claude: boolean }): Promise<InsertResult | null>
    /** Hide the card's item `id`. */
    dismiss(id: string): void
  }
  usage: {
    /** The usage card's state now. */
    get(): Promise<UsageState>
    /** A newer state: a report from Claude Code, a changed link, Connect or Disconnect. */
    onChange(cb: (state: UsageState) => void): () => void
    /** Makes Deck Claude Code's status line. `replace`: also when another status line is set
     *  (Disconnect puts that one back). */
    connect(replace: boolean): Promise<UsageChange>
    /** Puts back the status line Claude Code had before Connect, or none. */
    disconnect(): Promise<UsageChange>
  }
  devices: {
    /** Look for Android devices (adb) from now; the function stops this look. adb runs while any
     *  look is on, so only while some tab needs devices. */
    watch(): () => void
    /** The devices now, while something watches (call watch() first); null until Deck has its first
     *  list (adb starting, or devices still saying what they are) and whenever nothing watches. The
     *  list is pushed when it's there. */
    list(): Promise<DeviceList | null>
    onList(cb: (list: DeviceList) => void): () => void
    /** `folder`'s project: its root, whether it's an Android app, and the devices picked in it. */
    project(folder: string): Promise<DeviceProject>
    /** Puts `id` first among the project's devices. */
    pick(root: string, id: string): Promise<void>
    /** Streams device `id` from now; the function stops viewing. A stream nobody views stops 10 s
     *  later, so viewing it again before then picks it up. */
    view(id: string): () => void
    onStream(cb: (id: string, event: DeviceStreamEvent) => void): () => void
    /** A fresh key frame, for a decoder that fell behind or failed. */
    keyframe(id: string): void
    /** Starts a stream that ended in an error again. */
    retry(id: string): void
    input(id: string, input: DeviceInput): void
    /** Saves a screenshot (PNG) where Claude can read it: the text that adds it to Claude's prompt. */
    screenshot(png: Uint8Array): Promise<InsertResult>
  }
  app: {
    info(): Promise<AppInfo>
    openExternal(url: string): void
    copyText(text: string): void
    /** A dropped file's path; '' for a drop with no file behind it. */
    pathForFile(file: File): string
    /** A folder to open in a new shell tab: --open, macOS open-file, second launch. */
    onOpenFolder(cb: (path: string) => void): () => void
    onMenu(cb: (cmd: MenuCommand) => void): () => void
    /** Renderer is listening; main then delivers queued folders. */
    ready(): void
  }
}
