#!/usr/bin/env python3
"""git-graph-pane: a live, read-only branch graph for a WezTerm side pane.

Shows the repo, the branch you're on, the branch it will merge into next,
and a Sourcetree-style graph of all branches. The commits that will land in
the merge target are highlighted. Redraws by itself whenever HEAD, any ref,
or the working tree changes (commits, merges, tags, fetches, checkouts).

Keys: q quit · r refresh · a all branches / focus · j/k or wheel scroll ·
      g top · G end-of-loaded · PgUp/PgDn

Merge target: auto-detected (dev/develop for feature branches, main/master
for dev). Override per branch with:
    git config branch.<name>.mergeTarget origin/dev

Usage: git_graph_pane.py [REPO] [--once --width N --height N]
"""
import os
import re
import sys
import time
import subprocess

IS_WIN = os.name == "nt"
POLL_SECONDS = 1.5
# Never take index.lock while Claude (or you) is committing in the other pane.
ENV = dict(os.environ, GIT_OPTIONAL_LOCKS="0", GIT_PAGER="cat", GIT_TERMINAL_PROMPT="0")

E = "\x1b["
RESET = E + "0m"


def sgr(code, text):
    return f"{E}{code}m{text}{RESET}"


def bold(t): return sgr("1", t)
def dim(t): return sgr("2", t)
def red(t): return sgr("31", t)
def green(t): return sgr("32", t)
def yellow(t): return sgr("33", t)
def blue(t): return sgr("34", t)
def magenta(t): return sgr("35", t)
def cyan(t): return sgr("36", t)


# ---------------------------------------------------------------- git helpers

def git(repo, *args):
    try:
        p = subprocess.run(
            ["git", "-C", repo, *args],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            env=ENV, timeout=15,
        )
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return p.stdout if p.returncode == 0 else ""


def ref_ok(repo, ref):
    return bool(git(repo, "rev-parse", "--verify", "-q", ref + "^{commit}").strip())


def count(repo, rng):
    out = git(repo, "rev-list", "--count", rng).strip()
    return int(out) if out.isdigit() else None


TRUNK_ORDER = ["dev", "develop", "development", "main", "master"]
RELEASE_ORDER = ["main", "master"]


def is_ancestor(repo, a, b):
    try:
        return subprocess.run(["git", "-C", repo, "merge-base", "--is-ancestor", a, b],
                              capture_output=True, env=ENV, timeout=15).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def resolve(repo, name):
    """The local branch, unless it is missing or only a stale copy of
    origin/<name> (PRs merge on the remote, so that is where commits land)."""
    local = name if ref_ok(repo, name) else None
    remote = "origin/" + name if ref_ok(repo, "origin/" + name) else None
    if local and remote and git(repo, "rev-parse", local) != git(repo, "rev-parse", remote) \
            and is_ancestor(repo, local, remote):
        return remote
    return local or remote


def merge_target(repo, branch):
    if not branch:
        return None
    override = git(repo, "config", "--get", f"branch.{branch}.mergeTarget").strip()
    if override and ref_ok(repo, override):
        return override
    if branch in ("main", "master"):
        return None
    order = RELEASE_ORDER if branch in ("dev", "develop", "development") else TRUNK_ORDER
    best = None
    for i, name in enumerate(order):
        if name == branch:
            continue
        ref = resolve(repo, name)
        if not ref:
            continue
        ahead = count(repo, f"{ref}..HEAD")
        if ahead is None:
            continue
        key = (ahead, i)  # closest parent wins; ties go to the earlier name
        if best is None or key < best[0]:
            best = (key, ref)
    return best[1] if best else None


def status_counts(repo):
    staged = modified = untracked = conflicts = 0
    for line in git(repo, "status", "--porcelain=v1").splitlines():
        if len(line) < 2:
            continue
        x, y = line[0], line[1]
        if line.startswith("??"):
            untracked += 1
        elif x == "U" or y == "U" or (x, y) in (("A", "A"), ("D", "D")):
            conflicts += 1
        else:
            if x not in " ?":
                staged += 1
            if y not in " ?":
                modified += 1
    return staged, modified, untracked, conflicts


def in_progress(repo):
    gd = git(repo, "rev-parse", "--absolute-git-dir").strip()
    if not gd:
        return None
    for name, label in (("MERGE_HEAD", "MERGING"), ("rebase-merge", "REBASING"),
                        ("rebase-apply", "REBASING"), ("CHERRY_PICK_HEAD", "CHERRY-PICKING"),
                        ("REVERT_HEAD", "REVERTING")):
        if os.path.exists(os.path.join(gd, name)):
            return label
    return None


def signature(repo):
    """Cheap fingerprint: changes whenever a ref, HEAD or the work tree changes."""
    return "\0".join((
        git(repo, "symbolic-ref", "-q", "HEAD"),
        git(repo, "rev-parse", "HEAD"),
        git(repo, "for-each-ref", "--format=%(objectname) %(refname)"),
        git(repo, "status", "--porcelain=v1"),
        str(in_progress(repo)),
    ))


# ------------------------------------------------------------------ rendering

ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")


def vis_len(s):
    return len(ANSI_RE.sub("", s))


def clip(s, width):
    """Cut a string with ANSI codes to `width` visible columns."""
    if vis_len(s) <= width:
        return s + RESET
    out, n, i = [], 0, 0
    while i < len(s) and n < width - 1:
        m = ANSI_RE.match(s, i)
        if m:
            out.append(m.group(0))
            i = m.end()
            continue
        out.append(s[i])
        n += 1
        i += 1
    return "".join(out) + RESET + dim("…")


def age(ts):
    try:
        secs = max(0, int(time.time()) - int(ts))
    except ValueError:
        return ""
    if secs < 3600:
        return f"{secs // 60}m"
    if secs < 86400:
        return f"{secs // 3600}h"
    if secs < 86400 * 45:
        return f"{secs // 86400}d"
    if secs < 86400 * 365:
        return f"{secs // (86400 * 30)}mo"
    return f"{secs // (86400 * 365)}y"


def fmt_decorations(deco):
    if not deco.strip():
        return ""
    parts = []
    for item in (d.strip() for d in deco.split(",")):
        if not item or item.endswith("/HEAD"):
            continue
        if item.startswith("HEAD -> "):
            parts.append(bold(cyan("◉ " + item[8:])))
        elif item == "HEAD":
            parts.append(bold(cyan("◉ HEAD")))
        elif item.startswith("tag: "):
            parts.append(yellow("⌁" + item[5:]))
        elif "/" in item and item.split("/", 1)[0] in ("origin", "upstream"):
            parts.append(red(item))
        else:
            parts.append(bold(green(item)))
    return " ".join(parts)


SEP = "\x1f"
LOG_FMT = SEP.join(["", "%H", "%h", "%D", "%s", "%ct", "%an"])


def build_frame(repo, width, height, offset, show_all):
    top = repo
    name = os.path.basename(top.rstrip("/\\")) or top
    branch = git(repo, "symbolic-ref", "--short", "-q", "HEAD").strip()
    head_short = git(repo, "rev-parse", "--short", "HEAD").strip()
    target = merge_target(repo, branch)
    me = git(repo, "config", "user.name").strip()

    hdr = []
    hdr.append(bold(name) + "  " + dim("all branches" if show_all else "focus"))
    if branch:
        line = bold(cyan("⎇ " + branch))
    else:
        line = bold(magenta("detached @ " + (head_short or "?")))
    op = in_progress(repo)
    if op:
        line += "  " + bold(red(op))
    hdr.append(line)

    to_merge = set()
    if target:
        ahead = count(repo, f"{target}..HEAD") or 0
        behind = count(repo, f"HEAD..{target}") or 0
        hdr.append(f"  ↳ merges into {bold(green(target))}")
        detail = f"    {bold(yellow(str(ahead)))} to merge"
        if behind:
            detail += f" · {red(str(behind))} behind"
        hdr.append(detail)
        if ahead:
            to_merge = set(git(repo, "rev-list", "--max-count=2000", f"{target}..HEAD").split())
    elif branch:
        hdr.append(dim("  ↳ release branch (no merge target)"))

    up = git(repo, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}").strip()
    if up:
        lr = git(repo, "rev-list", "--left-right", "--count", "HEAD...@{u}").split()
        a, b = (lr + ["0", "0"])[:2]
        if a == "0" and b == "0":
            hdr.append(f"  {red(up)} {dim('in sync')}")
        else:
            s = f"  {red(up)}"
            if a != "0":
                s += f" {green('↑' + a)}"
            if b != "0":
                s += f" {red('↓' + b)}"
            hdr.append(s)
    elif branch:
        hdr.append(dim("  not pushed (no upstream)"))

    st, mo, un, cf = status_counts(repo)
    if st == mo == un == cf == 0:
        hdr.append("  " + green("✓ clean"))
    else:
        bits = []
        if cf:
            bits.append(bold(red(f"✖ {cf} conflict")))
        if st:
            bits.append(green(f"● {st} staged"))
        if mo:
            bits.append(yellow(f"✚ {mo} changed"))
        if un:
            bits.append(dim(f"? {un} new"))
        hdr.append("  " + "  ".join(bits))
    if to_merge:
        hdr.append(dim("  ") + sgr("30;43", " hash ") + dim(" = goes to ") + dim(target))
    hdr.append(dim("─" * max(1, width)))

    body_rows = max(1, height - len(hdr))
    want = offset + body_rows + 40
    refs = ["--exclude=refs/stash", "--all"] if show_all else ["HEAD"] + ([target] if target else []) + ([up] if up else [])
    out = git(repo, "log", "--graph", "--color=always", "--date-order",
              f"--max-count={want}", f"--format={LOG_FMT}", *refs, "--")
    rows = []
    for raw in out.splitlines():
        if SEP not in raw:
            rows.append(raw)
            continue
        graph, full, short, deco, subj, ts, author = (raw.split(SEP) + [""] * 7)[:7]
        h = sgr("30;43", short) if full in to_merge else yellow(short)
        line = f"{graph}{h} {dim(age(ts).rjust(3))}"
        d = fmt_decorations(deco)
        if d:
            line += " " + d
        line += " " + (bold(subj) if full in to_merge else subj)
        if author and author != me:
            line += " " + dim("· " + author.split()[0])
        rows.append(line)
    if not rows:
        rows = [dim("  (no commits yet)")]

    max_off = max(0, len(rows) - body_rows)
    offset = min(offset, max_off)
    body = rows[offset:offset + body_rows]
    lines = [clip(l, width) for l in hdr + body]
    return lines, offset


# --------------------------------------------------------------------- input

class Keys:
    def __init__(self):
        self.fd = None
        self.old = None

    def __enter__(self):
        if IS_WIN:
            return self
        import termios
        import tty
        self.fd = sys.stdin.fileno()
        try:
            self.old = termios.tcgetattr(self.fd)
            tty.setcbreak(self.fd)
        except termios.error:
            self.old = None
        return self

    def __exit__(self, *a):
        if self.old is not None:
            import termios
            termios.tcsetattr(self.fd, termios.TCSADRAIN, self.old)

    def read(self, timeout):
        """Keys pressed within `timeout` seconds. Mouse clicks come back as
        ("click", col, row) tuples (1-based)."""
        if IS_WIN:
            import msvcrt
            end = time.time() + timeout
            buf, legacy = "", []
            while time.time() < end and not (buf or legacy):
                while msvcrt.kbhit():
                    ch = msvcrt.getwch()
                    if ch in ("\x00", "\xe0"):
                        code = msvcrt.getwch()
                        legacy.append({"H": "up", "P": "down", "I": "pgup", "Q": "pgdn"}.get(code, ""))
                    else:
                        buf += ch
                if not (buf or legacy):
                    time.sleep(0.03)
            return legacy + parse_input(buf)
        import select
        r, _, _ = select.select([self.fd], [], [], timeout)
        if not r:
            return []
        return parse_input(os.read(self.fd, 4096).decode("utf-8", "replace"))


INPUT_RE = re.compile(r"\x1b\[<(\d+);(\d+);(\d+)([Mm])|\x1b\[([AB56])~?|\x1b\[[0-9;]*[A-Za-z~]|\x1b|.", re.S)
KEYMAP = {"A": "up", "B": "down", "5": "pgup", "6": "pgdn"}


def parse_input(data):
    keys = []
    for m in INPUT_RE.finditer(data):
        if m.group(1) is not None:
            b, x, y, kind = int(m.group(1)), int(m.group(2)), int(m.group(3)), m.group(4)
            if b == 64:
                keys.append("wheelup")
            elif b == 65:
                keys.append("wheeldown")
            elif b == 0 and kind == "M":
                keys.append(("click", x, y))
        elif m.group(5) is not None:
            keys.append(KEYMAP[m.group(5)])
        elif m.group(0) == "\x1b":
            keys.append("esc")
        elif not m.group(0).startswith("\x1b"):
            keys.append(m.group(0))
    return keys


def enable_windows_vt_input():
    """Let WezTerm deliver mouse clicks as VT sequences on Windows."""
    if not IS_WIN:
        return
    try:
        import ctypes
        k32 = ctypes.windll.kernel32
        h = k32.GetStdHandle(-10)  # STD_INPUT_HANDLE
        mode = ctypes.c_uint32()
        if k32.GetConsoleMode(h, ctypes.byref(mode)):
            # +VIRTUAL_TERMINAL_INPUT +EXTENDED_FLAGS, -QUICK_EDIT
            k32.SetConsoleMode(h, (mode.value | 0x0200 | 0x0080) & ~0x0040)
    except Exception:
        pass


def term_size():
    try:
        s = os.get_terminal_size(sys.stdout.fileno())
        return max(20, s.columns or 80), max(5, s.lines or 40)
    except OSError:
        return 80, 40


def set_user_var(name, value):
    import base64
    b = base64.b64encode(value.encode()).decode()
    sys.stdout.write(f"\x1b]1337;SetUserVar={name}={b}\x07")


def paint(lines, height):
    """Draw a full frame. Rows are cleared before they're written: with
    autowrap off the cursor stays on the last column, so a trailing ESC[K
    would erase the last character of every full-width row."""
    rows = lines[:height]
    frame = "\x1b[H" + "\r\n".join("\x1b[2K" + l for l in rows)
    if len(rows) < height:
        frame += ("\r\n" if rows else "") + "\x1b[J"
    sys.stdout.write(frame)
    sys.stdout.flush()


# ---------------------------------------------------------------------- main

def main():
    args = sys.argv[1:]
    once = "--once" in args
    width = height = None
    pos = []
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--width":
            width = int(args[i + 1]); i += 2; continue
        if a == "--height":
            height = int(args[i + 1]); i += 2; continue
        if not a.startswith("--"):
            pos.append(a)
        i += 1
    start = pos[0] if pos else os.getcwd()
    repo = git(start, "rev-parse", "--show-toplevel").strip()

    if once:
        if not repo:
            print("not a git repository")
            return 1
        lines, _ = build_frame(repo, width or 80, height or 40, 0, True)
        print("\n".join(lines))
        return 0

    if IS_WIN:
        os.system("")  # enable VT processing on old consoles
        enable_windows_vt_input()

    # Mark this pane so WezTerm never treats it as a "shell" pane, and say
    # which side pane it is so wezterm.lua can find it again after a reload.
    set_user_var("GIT_GRAPH_PANE", "1")
    set_user_var("SIDE_PANE", "graph")
    set_user_var("SIDE_REPO", start)
    sys.stdout.write(f"\x1b]2;⎇ {os.path.basename(repo or start)}\x07")
    # alt screen, hide cursor, no wrap, SGR mouse wheel reporting
    sys.stdout.write("\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[?1000h\x1b[?1006h")
    sys.stdout.flush()

    offset, show_all = 0, True
    last_sig = last_size = None
    last_poll = 0.0
    try:
        with Keys() as keys:
            while True:
                redraw = False
                for k in keys.read(0.2):
                    if k in ("q", "Q", "\x03"):
                        return 0
                    elif k in ("r", "R"):
                        last_sig = None
                    elif k in ("a", "A"):
                        show_all = not show_all; offset = 0; redraw = True
                    elif k in ("j", "down", "wheeldown"):
                        offset += 3 if k == "wheeldown" else 1; redraw = True
                    elif k in ("k", "up", "wheelup"):
                        offset = max(0, offset - (3 if k == "wheelup" else 1)); redraw = True
                    elif k == "pgdn" or k == " ":
                        offset += term_size()[1] - 4; redraw = True
                    elif k == "pgup":
                        offset = max(0, offset - (term_size()[1] - 4)); redraw = True
                    elif k == "g":
                        offset = 0; redraw = True
                    elif k == "G":
                        offset = 10 ** 6; redraw = True

                now = time.time()
                size = term_size()
                if size != last_size:
                    last_size, redraw = size, True
                if now - last_poll >= POLL_SECONDS or last_sig is None:
                    last_poll = now
                    if not repo:
                        repo = git(start, "rev-parse", "--show-toplevel").strip()
                    sig = signature(repo) if repo else ""
                    if sig != last_sig:
                        last_sig, redraw = sig, True

                if redraw:
                    w, h = size
                    if repo:
                        lines, offset = build_frame(repo, w, h, offset, show_all)
                        branch = git(repo, "symbolic-ref", "--short", "-q", "HEAD").strip()
                        set_user_var("GIT_BRANCH", branch)
                    else:
                        lines = [dim(f"{start} is not a git repository"), dim("q to close")]
                    paint(lines, h)
    except KeyboardInterrupt:
        return 0
    finally:
        sys.stdout.write("\x1b[?1000l\x1b[?1006l\x1b[?7h\x1b[?25h\x1b[?1049l")
        sys.stdout.flush()


if __name__ == "__main__":
    sys.exit(main() or 0)
