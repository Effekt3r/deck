#!/usr/bin/env python3
"""claude_activity_pane: live view of what Claude Code is doing in a folder.

Follows the newest Claude Code session for PROJECT (including its worktrees)
by tailing the session log under ~/.claude/projects, and shows:
  * status: working / running a tool / waiting / idle, model, context size
  * the to-do list Claude keeps
  * sub-agents it started, and what each one is doing now
  * a feed of prompts, thinking, replies and tool calls (newest at the bottom)

Read-only: it never talks to Claude, it only reads the log files.

Keys: q quit · wheel/j/k scroll · f or End follow · t toggle thinking ·
      n next (older) session · r rescan

Usage: claude_activity_pane.py PROJECT_DIR [--once --width N --height N]
"""
import glob
import json
import os
import re
import sys
import textwrap
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from git_graph_pane import (IS_WIN, Keys, RESET, bold, clip, cyan, dim, enable_windows_vt_input,  # noqa: E402
                            green, magenta, red, set_user_var, sgr, term_size, yellow, blue)

CLAUDE_DIR = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(os.path.expanduser("~"), ".claude")
PROJECTS = os.path.join(CLAUDE_DIR, "projects")
MAX_EVENTS = 600


def italic(t): return sgr("3", t)


def encode(path):
    return re.sub(r"[^A-Za-z0-9]", "-", path)


def sessions_for(project):
    """All session logs for this folder and its worktrees, newest first."""
    real = os.path.realpath(project)
    keys = {encode(real), encode(os.path.abspath(project))}
    found = []
    try:
        dirs = os.listdir(PROJECTS)
    except OSError:
        return []
    for d in dirs:
        if any(d == k or d.startswith(k + "-") for k in keys):
            for f in glob.glob(os.path.join(PROJECTS, d, "*.jsonl")):
                try:
                    found.append((os.path.getmtime(f), f))
                except OSError:
                    pass
    found.sort(reverse=True)
    return [f for _, f in found]


def short_path(p, project):
    if not isinstance(p, str):
        return str(p)
    for base in (os.path.realpath(project), project):
        if p.startswith(base.rstrip("/\\") + os.sep) or p.startswith(base.rstrip("/\\") + "/"):
            return p[len(base.rstrip("/\\")) + 1:]
    return p.replace(os.path.expanduser("~"), "~", 1)


def first_line(s, n=200):
    s = (s or "").strip().splitlines()
    return (s[0] if s else "")[:n]


def describe_tool(name, inp, project):
    """One-line summary of a tool call."""
    inp = inp if isinstance(inp, dict) else {}
    p = lambda k: short_path(inp.get(k, ""), project)  # noqa: E731
    if name == "Bash":
        return inp.get("description") or first_line(inp.get("command"))
    if name in ("Read", "Write", "Edit", "MultiEdit", "NotebookEdit"):
        return p("file_path") or p("notebook_path")
    if name in ("Grep", "Glob"):
        return f'{inp.get("pattern", "")}' + (f'  in {p("path")}' if inp.get("path") else "")
    if name in ("Task", "Agent"):
        return f'{inp.get("subagent_type") or "agent"}: {inp.get("description", "")}'
    if name in ("WebFetch",):
        return inp.get("url", "")
    if name in ("WebSearch",):
        return inp.get("query", "")
    if name == "TodoWrite":
        return f'{len(inp.get("todos") or [])} items'
    for k in ("description", "subject", "prompt", "query", "path", "file_path", "url", "command"):
        if inp.get(k):
            return first_line(str(inp[k]))
    return ""


class Session:
    """Incrementally parsed Claude Code session log."""

    def __init__(self, path, project):
        self.path, self.project = path, project
        self.pos = 0
        self.partial = ""
        self.events = []          # (kind, text) — kind: user/think/text/tool/err/sys
        self.pending = {}         # tool_use_id -> (name, summary)
        self.agents = {}          # tool_use_id -> dict(desc, type, done, err)
        self.todos = []           # list of (status, text)
        self.tasks = {}           # TaskCreate/TaskUpdate tracking: id -> [status, text]
        self.model = ""
        self.ctx = 0
        self.title = ""
        self.branch = ""
        self.last_kind = ""
        self.last_ts = 0.0

    def poll(self):
        try:
            size = os.path.getsize(self.path)
        except OSError:
            return False
        if size < self.pos:  # rewritten
            self.__init__(self.path, self.project)
        if size == self.pos:
            return False
        with open(self.path, "r", encoding="utf-8", errors="replace") as fh:
            fh.seek(self.pos)
            data = fh.read()
            self.pos = fh.tell()
        data = self.partial + data
        lines = data.split("\n")
        self.partial = lines.pop()
        for line in lines:
            if line.strip():
                try:
                    self.ingest(json.loads(line))
                except (ValueError, TypeError, AttributeError):
                    pass
        del self.events[:-MAX_EVENTS]
        return True

    def add(self, kind, text):
        self.events.append((kind, text))

    def ingest(self, e):
        t = e.get("type")
        if t == "summary" and e.get("summary"):
            self.title = e["summary"]
            return
        if t in ("custom-title", "ai-title") and (e.get("title") or e.get("customTitle")):
            self.title = e.get("title") or e.get("customTitle")
            return
        if e.get("gitBranch"):
            self.branch = e["gitBranch"]
        if t not in ("user", "assistant"):
            return
        if e.get("isSidechain"):
            return  # sub-agent traffic is shown via its own log
        msg = e.get("message") or {}
        content = msg.get("content")
        self.last_ts = time.time()
        if t == "user":
            if isinstance(content, str):
                self.user_text(content, e)
                return
            for b in content or []:
                if not isinstance(b, dict):
                    continue
                if b.get("type") == "text":
                    self.user_text(b.get("text", ""), e)
                elif b.get("type") == "tool_result":
                    tid = b.get("tool_use_id")
                    name, summ = self.pending.pop(tid, ("", ""))
                    if tid in self.agents:
                        self.agents[tid]["done"] = True
                        self.agents[tid]["err"] = bool(b.get("is_error"))
                    if b.get("is_error"):
                        txt = b.get("content")
                        if isinstance(txt, list):
                            txt = " ".join(x.get("text", "") for x in txt if isinstance(x, dict))
                        self.add("err", f"✗ {name}: {first_line(str(txt), 300)}")
                    self.last_kind = "result"
            return
        # assistant
        self.model = msg.get("model") or self.model
        u = msg.get("usage") or {}
        tot = sum(int(u.get(k) or 0) for k in ("input_tokens", "cache_read_input_tokens",
                                                "cache_creation_input_tokens"))
        if tot:
            self.ctx = tot
        for b in content or []:
            if not isinstance(b, dict):
                continue
            bt = b.get("type")
            if bt == "thinking":
                self.add("think", (b.get("thinking") or "").strip())
                self.last_kind = "think"
            elif bt == "redacted_thinking":
                self.add("think", "")
                self.last_kind = "think"
            elif bt == "text" and b.get("text", "").strip():
                self.add("text", b["text"].strip())
                self.last_kind = "text"
            elif bt == "tool_use":
                name, inp = b.get("name", "?"), b.get("input") or {}
                summ = describe_tool(name, inp, self.project)
                self.pending[b.get("id")] = (name, summ)
                self.add("tool", (name, summ))
                self.last_kind = "tool"
                if name in ("Task", "Agent"):
                    self.agents[b.get("id")] = {
                        "type": inp.get("subagent_type") or "agent",
                        "desc": inp.get("description") or first_line(inp.get("prompt", ""), 60),
                        "done": False, "err": False, "started": time.time(),
                    }
                elif name == "TodoWrite":
                    self.todos = [(td.get("status", ""), td.get("content") or td.get("activeForm", ""))
                                  for td in (inp.get("todos") or []) if isinstance(td, dict)]
                elif name == "TaskCreate":
                    tid = str(len(self.tasks) + 1)
                    self.tasks[tid] = ["pending", inp.get("subject") or inp.get("description") or ""]
                elif name == "TaskUpdate":
                    tid = str(inp.get("taskId") or inp.get("id") or "")
                    if tid in self.tasks and inp.get("status"):
                        self.tasks[tid][0] = inp["status"]

    def user_text(self, text, e):
        text = text.strip()
        if not text or e.get("isMeta"):
            return
        if text.startswith("<command-name>"):
            m = re.search(r"<command-name>(.*?)</command-name>", text)
            self.add("sys", m.group(1) if m else text[:60])
            return
        if text.startswith("<") and ">" in text[:40]:
            return  # local command output, reminders, hook text
        if text.startswith("[Request interrupted"):
            self.add("err", "✗ interrupted")
            return
        self.add("user", text)
        self.last_kind = "user"

    def todo_list(self):
        if self.todos:
            return self.todos
        return [tuple(v) for v in self.tasks.values()]


def subagent_status(session_path):
    """Latest action of each sub-agent log next to the session (newer Claude Code)."""
    base = os.path.splitext(session_path)[0]
    out = []
    for f in sorted(glob.glob(os.path.join(base, "subagents", "*.jsonl")), key=os.path.getmtime)[-6:]:
        try:
            age = time.time() - os.path.getmtime(f)
            with open(f, "rb") as fh:
                fh.seek(max(0, os.path.getsize(f) - 20000))
                tail = fh.read().decode("utf-8", "replace").splitlines()
        except OSError:
            continue
        last = ""
        for line in reversed(tail):
            try:
                e = json.loads(line)
            except ValueError:
                continue
            for b in reversed(((e.get("message") or {}).get("content")) or []):
                if isinstance(b, dict) and b.get("type") == "tool_use":
                    last = f'{b.get("name")}: {describe_tool(b.get("name"), b.get("input"), "")}'
                    break
                if isinstance(b, dict) and b.get("type") == "text" and b.get("text", "").strip():
                    last = first_line(b["text"])
                    break
            if last:
                break
        out.append((age, last))
    return out


# ------------------------------------------------------------------ rendering

def wrap(text, width, indent):
    lines = []
    for para in text.splitlines() or [""]:
        if not para.strip():
            continue
        lines.extend(textwrap.wrap(para, max(10, width - len(indent)), break_long_words=True,
                                   initial_indent="", subsequent_indent="") or [""])
    return [indent + l for l in lines]


TOOL_COLOR = {"Bash": yellow, "Edit": green, "Write": green, "MultiEdit": green,
              "Read": blue, "Grep": blue, "Glob": blue, "Task": magenta, "Agent": magenta}


def feed_lines(sess, width, show_thinking):
    out = []
    for kind, val in sess.events:
        if kind == "user":
            out.append("")
            out += [bold(cyan(l)) for l in wrap(val, width, "› ")[:6]]
        elif kind == "think":
            if not show_thinking:
                continue
            if not val:
                out.append(dim(italic("✻ thinking…")))
                continue
            w = wrap(val, width, "  ")
            w[0] = "✻" + w[0][1:]
            if len(w) > 8:
                w = w[:7] + [f"  … {len(w) - 7} more lines"]
            out += [dim(italic(l)) for l in w]
        elif kind == "text":
            w = wrap(val, width, "  ")
            w[0] = "●" + w[0][1:]
            if len(w) > 12:
                w = w[:11] + [dim(f"  … {len(w) - 11} more lines")]
            out += w
        elif kind == "tool":
            name, summ = val
            color = TOOL_COLOR.get(name, magenta)
            out.append(f"  {color('⏺ ' + name)} {dim(summ)}")
        elif kind == "err":
            out.append("  " + red(val))
        elif kind == "sys":
            out.append(dim(f"  ⌘ {val}"))
    return out


def fmt_tokens(n):
    return f"{n / 1000:.0f}k" if n >= 1000 else str(n)


def build_frame(project, sess, width, height, offset, follow, show_thinking, sub_logs):
    name = os.path.basename(os.path.realpath(project).rstrip("/\\"))
    hdr = []
    if not sess:
        hdr.append(bold("Claude") + "  " + dim(name))
        hdr.append(dim("─" * width))
        hdr.append(dim("No Claude Code session for this folder yet."))
        hdr.append(dim("Start `claude` in the pane on the left."))
        return hdr, 0
    try:
        idle_for = time.time() - os.path.getmtime(sess.path)
    except OSError:
        idle_for = 9999
    pending = list(sess.pending.values())
    if pending and idle_for > 8 and not any(n in ("Task", "Agent") for n, _ in pending):
        state = yellow("◐ waiting on you?") + dim(f" ({pending[-1][0]})")
    elif pending:
        state = yellow(f"⏺ {pending[-1][0]}")
    elif idle_for < 4 and sess.last_kind in ("user", "result", "think", "tool"):
        state = magenta("✻ working")
    elif idle_for < 4:
        state = magenta("✻ writing")
    else:
        state = green("✓ idle")
    hdr.append(bold("Claude") + "  " + dim(name) + "  " + state)
    meta = []
    if sess.model:
        meta.append(sess.model.replace("claude-", ""))
    if sess.ctx:
        meta.append("ctx " + fmt_tokens(sess.ctx))
    if sess.branch:
        meta.append("⎇ " + sess.branch)
    if meta:
        hdr.append(dim("  " + " · ".join(meta)))
    if sess.title:
        hdr.append(dim("  " + sess.title))

    todos = sess.todo_list()
    if todos:
        done = sum(1 for s, _ in todos if s == "completed")
        hdr.append(bold(f"To-do {done}/{len(todos)}"))
        shown = [t for t in todos if t[0] != "completed"][:6] or todos[-3:]
        for st, txt in shown:
            mark = {"completed": green("✓"), "in_progress": yellow("▸")}.get(st, dim("○"))
            hdr.append(f" {mark} " + (bold(txt) if st == "in_progress" else txt))

    agents = list(sess.agents.values())
    if agents:
        running = [a for a in agents if not a["done"]]
        hdr.append(bold(f"Agents {len(running)} running · {len(agents) - len(running)} done"))
        live = sorted(sub_logs, key=lambda x: x[0])
        for i, a in enumerate((running or agents[-3:])[:5]):
            mark = yellow("◐") if not a["done"] else (red("✗") if a["err"] else green("✓"))
            hdr.append(f" {mark} {magenta(a['type'])} {a['desc']}")
            if not a["done"] and i < len(live) and live[i][1]:
                hdr.append(dim(f"    ↳ {live[i][1]}"))
    hdr.append(dim("─" * width))
    hdr = [clip(l, width) for l in hdr]

    body_rows = max(1, height - len(hdr))
    rows = [clip(l, width) for l in feed_lines(sess, width, show_thinking)]
    max_off = max(0, len(rows) - body_rows)
    if follow:
        offset = max_off
    offset = max(0, min(offset, max_off))
    body = rows[offset:offset + body_rows]
    if not follow and offset < max_off:
        body[-1] = sgr("30;43", clip(f" ↓ paused — f to follow ({max_off - offset} new) ", width))
    return hdr + body, offset


# ---------------------------------------------------------------------- main

def main():
    args = sys.argv[1:]
    once = "--once" in args
    width = height = None
    pos = []
    i = 0
    while i < len(args):
        if args[i] == "--width":
            width = int(args[i + 1]); i += 2; continue
        if args[i] == "--height":
            height = int(args[i + 1]); i += 2; continue
        if not args[i].startswith("--"):
            pos.append(args[i])
        i += 1
    project = os.path.abspath(pos[0] if pos else os.getcwd())

    skip = 0  # 0 = newest session, n = n-th older
    sess = None

    def pick():
        nonlocal sess
        found = sessions_for(project)
        path = found[min(skip, len(found) - 1)] if found else None
        if path and (not sess or sess.path != path):
            sess = Session(path, project)
        if sess:
            sess.poll()

    if once:
        pick()
        lines, _ = build_frame(project, sess, width or 60, height or 50, 0, True, True,
                               subagent_status(sess.path) if sess else [])
        print("\n".join(lines))
        return 0

    if IS_WIN:
        os.system("")
        enable_windows_vt_input()
    set_user_var("GIT_GRAPH_PANE", "1")  # never treated as a shell pane
    sys.stdout.write(f"\x1b]2;✻ Claude · {os.path.basename(project)}\x07")
    sys.stdout.write("\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[?1000h\x1b[?1006h")
    sys.stdout.flush()

    offset, follow, show_thinking = 0, True, True
    last_size = None
    last_scan = 0.0
    last_sig = None
    try:
        with Keys() as keys:
            while True:
                redraw = False
                h = term_size()[1]
                for k in keys.read(0.25):
                    if k in ("q", "Q", "\x03"):
                        return 0
                    if k in ("k", "up", "wheelup", "pgup"):
                        follow = False
                        offset -= {"wheelup": 3, "pgup": h - 4}.get(k, 1); redraw = True
                    elif k in ("j", "down", "wheeldown", "pgdn", " "):
                        offset += {"wheeldown": 3, "pgdn": h - 4, " ": h - 4}.get(k, 1); redraw = True
                    elif k in ("f", "F", "G"):
                        follow = True; redraw = True
                    elif k in ("t", "T"):
                        show_thinking = not show_thinking; redraw = True
                    elif k in ("n", "N"):
                        skip = (skip + 1) % max(1, len(sessions_for(project))); sess = None; follow = True
                        last_scan = 0
                    elif k in ("r", "R"):
                        skip = 0; last_scan = 0
                now = time.time()
                if now - last_scan > 2:
                    last_scan = now
                    pick()
                    redraw = True if last_sig is None else redraw
                elif sess and sess.poll():
                    redraw = True
                size = term_size()
                if size != last_size:
                    last_size, redraw = size, True
                # status line ages even when nothing is written
                sig = (sess.path, sess.pos, int(now) // 2) if sess else None
                if sig != last_sig:
                    last_sig, redraw = sig, True
                if redraw:
                    w, h = size
                    subs = subagent_status(sess.path) if sess and sess.agents else []
                    lines, offset = build_frame(project, sess, w, h, offset, follow, show_thinking, subs)
                    frame = "\x1b[H" + "".join(l + "\x1b[K\r\n" for l in lines[:h - 1])
                    if len(lines) >= h:
                        frame += lines[h - 1] + "\x1b[K"
                    frame += "\x1b[J"
                    sys.stdout.write(frame)
                    sys.stdout.flush()
    except KeyboardInterrupt:
        return 0
    finally:
        sys.stdout.write("\x1b[?1000l\x1b[?1006l\x1b[?7h\x1b[?25h\x1b[?1049l")
        sys.stdout.flush()


if __name__ == "__main__":
    sys.exit(main() or 0)
