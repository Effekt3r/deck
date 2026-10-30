#!/usr/bin/env python3
"""claude_activity_pane: live view of what Claude Code is doing in a folder.

Follows the newest Claude Code session for PROJECT (including its worktrees)
by tailing the session log under ~/.claude/projects, and shows:
  * status: working / running a tool / waiting on you / idle, model, context size
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
                            green, magenta, paint, red, set_user_var, sgr, term_size, yellow, blue)

CLAUDE_DIR = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(os.path.expanduser("~"), ".claude")
PROJECTS = os.path.join(CLAUDE_DIR, "projects")
MAX_EVENTS = 600
AGENT_TOOLS = ("Task", "Agent")
ASK_TOOLS = ("AskUserQuestion", "ExitPlanMode")  # pending = Claude is waiting on you
WORKTREES = "--claude-worktrees-"                 # <repo>/.claude/worktrees/<name>, encoded
NOT_PROMPTS = ("<local-command-caveat>", "<local-command-stdout>", "<local-command-stderr>",
               "<system-reminder>", "<bash-stdout>", "<bash-stderr>")
MODES = {"bypassPermissions": "bypass", "acceptEdits": "accept edits", "plan": "plan mode", "auto": "auto mode"}


def italic(t): return sgr("3", t)


def encode(path):
    return re.sub(r"[^A-Za-z0-9]", "-", path)


def sessions_for(project):
    """All session logs for this folder and its worktrees, newest first.
    Claude names the folder after process.cwd(), which has the on-disk case
    (/Volumes/wyobi/X logs to -Volumes-Wyobi-X), so match case-insensitively."""
    keys = {encode(p).lower() for p in (os.path.realpath(project), os.path.abspath(project))}
    found = []
    try:
        dirs = os.listdir(PROJECTS)
    except OSError:
        return []
    for d in dirs:
        low = d.lower()
        if any(low == k or low.startswith(k + WORKTREES) for k in keys):
            for f in glob.glob(os.path.join(PROJECTS, d, "*.jsonl")):
                try:
                    found.append((os.path.getmtime(f), f))
                except OSError:
                    pass
    found.sort(reverse=True)
    return [f for _, f in found]


def quiet_for(path):
    try:
        return time.time() - os.path.getmtime(path)
    except OSError:
        return 9999.0


def short_path(p, project):
    if not isinstance(p, str):
        return str(p)
    for base in (os.path.realpath(project), project):
        base = base.rstrip("/\\")
        if p.lower().startswith(base.lower() + "/") or p.lower().startswith(base.lower() + "\\"):
            return p[len(base) + 1:]
    return p.replace(os.path.expanduser("~"), "~", 1)


def tag(text, name):
    m = re.search(rf"<{name}>(.*?)</{name}>", text, re.S)
    return m.group(1).strip() if m else ""


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
    if name in AGENT_TOOLS:
        return f'{inp.get("subagent_type") or "agent"}: {inp.get("description", "")}'
    if name in ("WebFetch",):
        return inp.get("url", "")
    if name in ("WebSearch",):
        return inp.get("query", "")
    if name == "TodoWrite":
        return f'{len(inp.get("todos") or [])} items'
    if name == "AskUserQuestion":
        qs = [q.get("question", "") for q in inp.get("questions") or [] if isinstance(q, dict)]
        return first_line(qs[0]) if qs else ""
    for k in ("description", "subject", "summary", "skill", "prompt", "query", "path", "file_path",
              "url", "command", "reason", "task_id", "plan"):
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
        self.pending = {}         # tool_use_id -> (name, summary), until its result arrives
        self.agents = {}          # tool_use_id -> dict(type, desc, id, done, err)
        self.background = set()   # ids of background shell tasks still running
        self.todos = []           # list of (status, text)
        self.tasks = {}           # TaskCreate/TaskUpdate tracking: id -> [status, text]
        self.model = ""
        self.ctx = 0
        self.title = ""           # ai-title; a custom title (/rename) wins
        self.custom_title = ""
        self.branch = ""
        self.mode = ""            # permission mode
        self.pr = ""
        self.in_turn = False      # a prompt is being worked on
        self.error = ""           # last API error (rate limit, overload, …)
        self.exited = False       # Claude quit (until the session is resumed)

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
        if t == "custom-title" and e.get("customTitle"):
            self.custom_title = e["customTitle"]
        elif t == "ai-title" and (e.get("aiTitle") or e.get("title")):
            self.title = e.get("aiTitle") or e.get("title")
        elif t == "summary" and e.get("summary"):  # Claude Code before 2.1
            self.title = e["summary"]
        elif t == "permission-mode":
            self.mode = e.get("permissionMode") or ""
        elif t == "pr-link" and e.get("prNumber"):
            self.pr = f'PR #{e["prNumber"]}'
        elif t == "cost-state":  # written as Claude exits; its background work dies with it
            self.exited = True
            self.end_turn()
            self.background.clear()
            for a in self.agents.values():
                a["done"] = True
        if t not in ("user", "assistant", "system", "attachment"):
            return
        self.exited = False
        if e.get("gitBranch"):
            self.branch = e["gitBranch"]
        if e.get("isSidechain"):
            return  # sub-agent traffic is shown via its own log
        if t == "system":
            self.system(e)
        elif t == "attachment":
            # Input that arrived while Claude was busy and was taken in mid-turn:
            # prompts you typed, or notifications that a background task ended.
            a = e.get("attachment") or {}
            if a.get("type") == "queued_command" and isinstance(a.get("prompt"), str):
                if a.get("commandMode") == "task-notification":
                    self.notification(a["prompt"])
                elif (a.get("origin") or {}).get("kind", "human") == "human":
                    self.prompt(a["prompt"])
        elif t == "user":
            self.user(e)
        else:
            self.assistant(e)

    def system(self, e):
        st = e.get("subtype")
        if st == "turn_duration":  # written when a turn ends
            self.end_turn()
        elif st == "compact_boundary":
            self.add("sys", "conversation compacted")
        elif st in ("informational", "model_refusal_fallback", "scheduled_task_fire") and e.get("content"):
            self.add("sys", first_line(str(e["content"])))

    def user(self, e):
        if e.get("isCompactSummary"):
            return  # the summary a compacted conversation restarts from
        content = (e.get("message") or {}).get("content")
        blocks = [{"type": "text", "text": content}] if isinstance(content, str) else content or []
        # origin.kind: human (absent in older logs), task-notification, peer, auto-continuation, …
        human = (e.get("origin") or {}).get("kind", "human") == "human" and not e.get("isMeta")
        texts, images = [], 0
        for b in blocks:
            if not isinstance(b, dict):
                continue
            if b.get("type") == "tool_result":
                self.result(b, e.get("toolUseResult"))
            elif b.get("type") == "text":
                text = b.get("text") or ""
                if "<task-notification>" in text[:40]:
                    self.notification(text)
                elif human:
                    texts.append(text)
            elif b.get("type") == "image" and human:
                images += 1
        for text in texts:
            self.user_text(text, legacy=e.get("origin") is None)
        if images and not texts:
            self.prompt("[image]")

    def user_text(self, text, legacy):
        text = text.strip()
        if not text or text.startswith(NOT_PROMPTS):
            return
        if text.startswith("<command-name>"):
            self.add("sys", tag(text, "command-name") or text[:60])
        elif text.startswith("<bash-input>"):
            self.add("user", "! " + tag(text, "bash-input"))
        elif text.startswith("[Request interrupted"):
            self.add("err", "✗ interrupted")
            self.end_turn()
        elif legacy and text.startswith("<") and ">" in text[:40] and not text.startswith("<pasted"):
            return  # older logs: hook output and reminders arrived as user text
        else:
            self.prompt(re.sub(r"</?pasted_content[^>]*>", "", text).strip())

    def prompt(self, text):
        if text:
            self.add("user", text)
            self.in_turn, self.error = True, ""

    def end_turn(self):
        self.in_turn = False
        self.pending.clear()  # nothing is still running once a turn is over

    def result(self, b, info):
        tid = b.get("tool_use_id")
        name, _ = self.pending.pop(tid, ("", ""))
        info = info if isinstance(info, dict) else {}
        agent = self.agents.get(tid)
        if agent:
            agent["id"] = info.get("agentId") or agent["id"]
            # Agents mostly start async: this result only says "launched" and a
            # <task-notification> reports the end.
            if info.get("status") != "async_launched":
                agent["done"], agent["err"] = True, bool(b.get("is_error"))
        if info.get("backgroundTaskId"):
            self.background.add(str(info["backgroundTaskId"]))
        if b.get("is_error"):
            txt = b.get("content")
            if isinstance(txt, list):
                txt = " ".join(x.get("text", "") for x in txt if isinstance(x, dict))
            self.add("err", f"✗ {name}: {first_line(str(txt), 300)}")

    def notification(self, text):
        """<task-notification>: a background agent or shell command finished."""
        task, status = tag(text, "task-id"), tag(text, "status")
        agent = self.agents.get(tag(text, "tool-use-id")) or \
            next((a for a in self.agents.values() if task and a["id"] == task), None)
        if agent:
            agent["done"], agent["err"] = True, status == "failed"
        self.background.discard(task)
        if tag(text, "summary"):
            self.add("err" if status == "failed" else "sys", first_line(tag(text, "summary")))

    def assistant(self, e):
        msg = e.get("message") or {}
        content = msg.get("content")
        if e.get("isApiErrorMessage"):  # synthetic reply (model "<synthetic>"): rate limit, overload…
            txt = " ".join(b.get("text", "") for b in content or [] if isinstance(b, dict))
            self.error = first_line(txt, 120) or str(e.get("error") or "API error")
            self.add("err", "⚠ " + self.error)
            self.end_turn()
            return
        self.in_turn, self.error = True, ""
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
            elif bt == "redacted_thinking":
                self.add("think", "")
            elif bt == "text" and b.get("text", "").strip():
                self.add("text", b["text"].strip())
            elif bt == "tool_use":
                name, inp = b.get("name", "?"), b.get("input") or {}
                summ = describe_tool(name, inp, self.project)
                self.pending[b.get("id")] = (name, summ)
                self.add("tool", (name, summ))
                if name in AGENT_TOOLS:
                    self.agents[b.get("id")] = {
                        "type": inp.get("subagent_type") or "agent",
                        "desc": inp.get("description") or first_line(inp.get("prompt", ""), 60),
                        "id": None, "done": False, "err": False,
                    }
                elif name == "SendMessage":  # continues an agent that had finished
                    for a in self.agents.values():
                        if a["id"] and a["id"] == inp.get("to"):
                            a["done"] = False
                elif name == "TaskStop":
                    task = str(inp.get("task_id") or "")
                    self.background.discard(task)
                    for a in self.agents.values():
                        if task and a["id"] == task:
                            a["done"] = True
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
        if msg.get("stop_reason") == "end_turn":
            self.end_turn()

    def todo_list(self):
        if self.todos:
            return self.todos
        return [tuple(v) for v in self.tasks.values()]


def last_step(path, project):
    """The latest tool call or reply in a sub-agent's log."""
    try:
        with open(path, "rb") as fh:
            fh.seek(max(0, os.path.getsize(path) - 20000))
            tail = fh.read().decode("utf-8", "replace").splitlines()
    except OSError:
        return ""
    for line in reversed(tail):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        for b in reversed(((e.get("message") or {}).get("content")) or []):
            if isinstance(b, dict) and b.get("type") == "tool_use":
                return f'{b.get("name")}: {describe_tool(b.get("name"), b.get("input"), project)}'
            if isinstance(b, dict) and b.get("type") == "text" and b.get("text", "").strip():
                return first_line(b["text"])
    return ""


def subagent_steps(sess):
    """What each running sub-agent is doing now, by Agent tool_use id. Its log
    is <session>/subagents/agent-<agentId>.jsonl, and agent-<agentId>.meta.json
    names the tool call that started it (toolUseId)."""
    running = {tid: a for tid, a in sess.agents.items() if not a["done"]}
    if not running:
        return {}
    base = os.path.join(os.path.splitext(sess.path)[0], "subagents")
    logs = {}
    for meta in glob.glob(os.path.join(base, "agent-*.meta.json")):
        try:
            with open(meta, encoding="utf-8") as fh:
                logs[json.load(fh).get("toolUseId")] = meta[:-len(".meta.json")] + ".jsonl"
        except (OSError, ValueError, AttributeError):
            pass
    out = {}
    for tid, a in running.items():
        log = logs.get(tid) or (a["id"] and os.path.join(base, f'agent-{a["id"]}.jsonl'))
        if log:
            out[tid] = last_step(log, sess.project)
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
            label = name[5:].replace("__", ":", 1) if name.startswith("mcp__") else name
            out.append(f"  {color('⏺ ' + label)} {dim(summ)}")
        elif kind == "err":
            out.append("  " + red(val))
        elif kind == "sys":
            out.append(dim(f"  ⌘ {val}"))
    return out or [dim("No prompts in this session yet.")]


def status(sess, idle_for):
    pending = list(sess.pending.values())
    if pending:
        name = pending[-1][0]
        if name in ASK_TOOLS:
            return yellow("◐ waiting on you") + dim(f" ({name})")
        # A permission prompt leaves no trace in the log: guess from the silence.
        if idle_for > 8 and name not in AGENT_TOOLS and sess.mode != "bypassPermissions":
            return yellow("◐ waiting on you?") + dim(f" ({name})")
        return yellow(f"⏺ {name}")
    if sess.in_turn:
        return dim(f"? quiet for {int(idle_for // 60)}m") if idle_for > 600 else magenta("✻ working")
    if sess.exited:
        return dim("⏹ exited")
    if sess.error:
        return red("⚠ " + sess.error)
    state = green("✓ idle")
    agents = sum(1 for a in sess.agents.values() if not a["done"])
    if agents:
        state += dim(f" · {agents} agent{'s' * (agents != 1)} running")
    if sess.background:
        n = len(sess.background)
        state += dim(f" · {n} background task{'s' * (n != 1)}")
    return state


def fmt_tokens(n):
    return f"{n / 1000:.0f}k" if n >= 1000 else str(n)


def build_frame(project, sess, width, height, offset, follow, show_thinking, steps):
    name = os.path.basename(os.path.realpath(project).rstrip("/\\"))
    hdr = []
    if not sess:
        hdr.append(bold("Claude") + "  " + dim(name))
        hdr.append(dim("─" * width))
        hdr.append(dim("No Claude Code session for this folder yet."))
        hdr.append(dim("Start `claude` in the pane on the left."))
        return hdr, 0
    hdr.append(bold("Claude") + "  " + dim(name) + "  " + status(sess, quiet_for(sess.path)))
    meta = []
    if sess.model:
        meta.append(sess.model.replace("claude-", ""))
    if sess.ctx:
        meta.append("ctx " + fmt_tokens(sess.ctx))
    if sess.branch:
        meta.append("⎇ " + sess.branch)
    if sess.mode in MODES:
        meta.append(MODES[sess.mode])
    if sess.pr:
        meta.append(sess.pr)
    if meta:
        hdr.append(dim("  " + " · ".join(meta)))
    if sess.custom_title or sess.title:
        hdr.append(dim("  " + (sess.custom_title or sess.title)))

    todos = sess.todo_list()
    if todos:
        done = sum(1 for s, _ in todos if s == "completed")
        hdr.append(bold(f"To-do {done}/{len(todos)}"))
        shown = [t for t in todos if t[0] != "completed"][:6] or todos[-3:]
        for st, txt in shown:
            mark = {"completed": green("✓"), "in_progress": yellow("▸")}.get(st, dim("○"))
            hdr.append(f" {mark} " + (bold(txt) if st == "in_progress" else txt))

    agents = list(sess.agents.items())
    if agents:
        running = [(tid, a) for tid, a in agents if not a["done"]]
        hdr.append(bold(f"Agents {len(running)} running · {len(agents) - len(running)} done"))
        for tid, a in (running or agents[-3:])[:5]:
            mark = yellow("◐") if not a["done"] else (red("✗") if a["err"] else green("✓"))
            hdr.append(f" {mark} {magenta(a['type'])} {a['desc']}")
            if not a["done"] and steps.get(tid):
                hdr.append(dim(f"    ↳ {steps[tid]}"))
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
    seen = {}  # path -> Session, so switching back doesn't re-read a long log

    def pick():
        nonlocal sess
        found = sessions_for(project)
        path = found[min(skip, len(found) - 1)] if found else None
        # Other tabs or worktrees may run Claude here too: stay on the session
        # being followed until it has been quiet for a while.
        if path and (not sess or sess.path != path) and \
                (not sess or skip or quiet_for(sess.path) > 15):
            sess = seen.get(path) or Session(path, project)
            seen[path] = sess
            for old in list(seen)[:-4]:
                if seen[old] is not sess:
                    del seen[old]
        if sess:
            sess.poll()

    if once:
        pick()
        lines, _ = build_frame(project, sess, width or 60, height or 50, 0, True, True,
                               subagent_steps(sess) if sess else {})
        print("\n".join(lines))
        return 0

    if IS_WIN:
        os.system("")
        enable_windows_vt_input()
    set_user_var("GIT_GRAPH_PANE", "1")  # never treated as a shell pane
    set_user_var("SIDE_PANE", "activity")  # lets wezterm.lua find it again after a reload
    set_user_var("SIDE_REPO", pos[0] if pos else project)
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
                        skip = 0; sess = None; last_scan = 0
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
                    steps = subagent_steps(sess) if sess else {}
                    lines, offset = build_frame(project, sess, w, h, offset, follow, show_thinking, steps)
                    paint(lines, h)
    except KeyboardInterrupt:
        return 0
    finally:
        sys.stdout.write("\x1b[?1000l\x1b[?1006l\x1b[?7h\x1b[?25h\x1b[?1049l")
        sys.stdout.flush()


if __name__ == "__main__":
    sys.exit(main() or 0)
