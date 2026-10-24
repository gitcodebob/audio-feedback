#!/usr/bin/env python3
"""Deterministic helpers for the foreman-start skill.

Every subcommand prints a few short lines meant for an agent to read, and exits 0 unless it was
called wrongly. A failed side effect (a ticket move, a workspace rename) is reported in one line
and never stops the cycle.

  find-todo  [PATH]                          pick the TODO file, say whether a cycle runs in it
  state      show|set|start|unmark|done  TODO ...
  name       [DONE TOTAL] [--ws ID]          name the own workspace `Foreman (DONE/TOTAL)`, or read it
  ticket     detect | move KEY start|done [--todo TODO]
  check      TODO                            one scan of every running workspace
  verify-pr  N [--todo TODO]                 is PR #N really merged, and what did it change
  capacity                                   cores, memory, /tmp, running agents, a parallel limit

The run's count lives only in the foreman's own session and in its workspace name; nothing here
stores it.

Needs python3, git, gh and the paseo CLI. jira (jira-cli) or acli are optional.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

BLOCK_RE = re.compile(r"<!--\s*foreman\b(.*?)-->", re.S)
ITEM_RE = re.compile(r"^([-*] \[)([ xX])(\]\s+)(.*)$")  # top level only; sub-items are notes
RUNNING_RE = re.compile(r"\s*← running:.*$")
KEY_RE = re.compile(r"\b[A-Z][A-Z0-9]+-\d+\b")
OWN_KEY_RE = re.compile(r"^\W*([A-Z][A-Z0-9]+-\d+)\b|/browse/([A-Z][A-Z0-9]+-\d+)\b")
JIRA_ENV = Path.home() / ".config/jira-cli/env"


def out(*lines):
    for line in lines:
        print(line)


def run(cmd, timeout=60, shell=False):
    """Run a command; return (exit code, stdout, stderr). A missing binary is exit 127."""
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, shell=shell,
                           executable="/bin/bash" if shell else None)
        return p.returncode, p.stdout.strip(), p.stderr.strip()
    except FileNotFoundError:
        return 127, "", f"{cmd[0]}: not found"
    except subprocess.TimeoutExpired:
        return 124, "", "timed out"


def item_key(text):
    """The item's own ticket key: one that leads its text, or a Jira /browse/ link. Other keys in
    the text (follow-ups, notes, `UTF-8`) are not the item's."""
    m = OWN_KEY_RE.search(text)
    return (m.group(1) or m.group(2)) if m else None


def one_line(text, limit=300):
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


# ---------------------------------------------------------------------------- TODO file

class Todo:
    def __init__(self, path):
        self.path = Path(path).resolve()
        if not self.path.is_file():
            sys.exit(f"error: no such TODO file: {path}")
        with open(self.path, newline="") as f:
            raw = f.read()
        self.nl = "\r\n" if "\r\n" in raw else "\n"
        self.text = raw.replace("\r\n", "\n")

    # -- foreman block
    def block(self):
        m = BLOCK_RE.search(self.text)
        return m.group(1) if m else None

    def field(self, key):
        """Value of a `key: value` segment in the block (segments split on ' · ')."""
        block = self.block() or ""
        m = re.search(rf"(?m)(?:^|·)\s*{re.escape(key)}\s*[:=]\s*([^·\n]*)", block)
        return m.group(1).strip() if m else None

    def set_line(self, key, value):
        """Set the whole `key: value` line in the block, adding it before `-->` if missing."""
        m = BLOCK_RE.search(self.text)
        if not m:
            sys.exit("error: the TODO file has no <!-- foreman … --> block yet; write the plan first")
        body = m.group(1)
        line = f"{key}: {value}"
        pat = re.compile(rf"(?m)^{re.escape(key)}\s*:.*$")
        if pat.search(body):
            body = pat.sub(lambda _: line, body, count=1)
        else:
            body = body.rstrip("\n") + "\n" + line + "\n"
        self.text = self.text[: m.start(1)] + body + self.text[m.end(1):]

    def tracker(self):
        """(tool, {start: state, done: state}) from the block's tracker line."""
        m = re.search(r"(?m)^tracker\s*:(.*)$", self.block() or "")
        line = m.group(1) if m else ""
        tool = (line.split() or [None])[0]
        states = {k: v.strip() for k, v in re.findall(r"\b(start|done)\s*=\s*([^·\n]+)", line)}
        return tool, states

    def own_workspace(self):
        v = self.field("own workspace") or ""
        m = re.search(r"wks_\w+", v)
        return m.group(0) if m else (v.split()[0] if v else None)

    # -- checklist
    def items(self):
        """[(line index, checked, text without markers, running marker or '')]"""
        res = []
        for i, line in enumerate(self.text.split("\n")):
            m = ITEM_RE.match(line)
            if m:
                rest = m.group(4)
                r = RUNNING_RE.search(rest)
                res.append((i, m.group(2) != " ", RUNNING_RE.sub("", rest), r.group(0).strip() if r else ""))
        return res

    def find_item(self, query, open_only=True):
        all_items = self.items()
        cands = [it for it in all_items if not (open_only and it[1])]
        # A ticket key matches only the item's own key: DG-7 doesn't hit DG-78, and DG-78 doesn't
        # hit an item that merely mentions DG-78.
        is_key = bool(KEY_RE.fullmatch(query.upper()))
        hit = (lambda it: item_key(it[2]) == query.upper()) if is_key else (lambda it: query.lower() in it[2].lower())
        hits = [it for it in cands if hit(it)]
        if not hits and open_only:
            ticked = [it for it in all_items if it[1] and hit(it)]
            if len(ticked) == 1:
                sys.exit(f"error: {query!r} is already ticked (line {ticked[0][0] + 1}): "
                         f"{one_line(ticked[0][2], 100)}; nothing to do")
        if len(hits) != 1:
            what = "no" if not hits else f"{len(hits)}"
            lst = "".join(f"\n  line {it[0] + 1}: {one_line(it[2], 100)}" for it in (hits or cands))
            sys.exit(f"error: {what} {'open ' if open_only else ''}items match {query!r}:{lst}")
        return hits[0]

    def replace_line(self, idx, new):
        lines = self.text.split("\n")
        lines[idx] = new
        self.text = "\n".join(lines)

    def line(self, idx):
        return self.text.split("\n")[idx]

    def save(self):
        fd, tmp = tempfile.mkstemp(dir=self.path.parent, prefix=".foreman-")
        with os.fdopen(fd, "w", newline="") as f:
            f.write(self.text.replace("\n", self.nl))
        os.chmod(tmp, self.path.stat().st_mode & 0o7777)
        os.replace(tmp, self.path)


# ---------------------------------------------------------------------------- name

NAME_RE = re.compile(r"^Foreman \((\d+)/(\d+)\)$")


def own_workspace(ws=None):
    """(id, current name) of the given workspace, or of the one whose cwd is this directory."""
    workspaces, err = paseo_json(["workspace", "ls"])
    if workspaces is None:
        return ws, None, err
    here = {str(Path.cwd().resolve())}
    code, top, _ = run(["git", "rev-parse", "--show-toplevel"])
    if code == 0:
        here.add(str(Path(top).resolve()))
    for w in workspaces:
        if (ws and w.get("workspaceId") == ws) or (not ws and str(Path(w.get("cwd", "")).resolve()) in here):
            return w.get("workspaceId"), w.get("name"), None
    return ws, None, "no workspace with this directory as cwd" if not ws else f"{ws} not listed"


def cmd_name(a):
    if a.done is None:
        ws, name, err = own_workspace(a.ws)
        if not name:
            return out(f"name: unknown ({err})")
        m = NAME_RE.match(name)
        return out(f"name: {name!r} ({ws})"
                   + (f" → done {m.group(1)} of {m.group(2)}" if m else " → no run count in it"))
    if a.total is None or a.done < 0 or a.total < a.done:
        sys.exit("usage: foreman.py name DONE TOTAL (0 <= DONE <= TOTAL)")
    title = f"Foreman ({a.done}/{a.total})"
    if os.environ.get("FOREMAN_NO_RENAME"):
        return out(f"name: skipped by FOREMAN_NO_RENAME, would be {title!r}")
    ws, _, err = (a.ws, None, None) if a.ws else own_workspace()
    if not ws:
        return out(f"name FAILED ({err}); use rename_workspace with title {title!r}")
    code, _, err = run(["paseo", "workspace", "rename", ws, title])
    out(f"name: {ws} → {title!r}" if code == 0 else
        f"name FAILED ({one_line(err, 120) or f'exit {code}'}); use rename_workspace with title {title!r}")


# ---------------------------------------------------------------------------- find-todo

def cmd_find_todo(a):
    if a.path:
        cands = [Path(a.path)]
    else:
        code, top, _ = run(["git", "rev-parse", "--show-toplevel"])
        root = Path(top) if code == 0 else Path.cwd()
        cands = []
        for d in (root / ".scratch", root):
            found = sorted((p for p in d.glob("TODO*.md")
                            if re.search(r"(?m)^[-*] \[ \]", p.read_text(errors="ignore"))),
                           key=lambda p: p.stat().st_mtime, reverse=True)
            if found:
                cands = found
                break
        if not cands:
            return out("todo: none (no TODO*.md with an open item in .scratch/ or the repo root); ask the user")
    t = Todo(cands[0])
    items = t.items()
    open_n = sum(1 for it in items if not it[1])
    running = [it for it in items if it[3]]
    out(f"todo: {t.path}",
        f"items: {open_n} open ({len(running)} running) · {len(items) - open_n} done")
    if t.block() is None:
        out("cycle: none yet → plan lanes, write the block")
    else:
        out("cycle: a block exists → resume; check every listed workspace first")
        out(f"own workspace in the block: {t.own_workspace() or '?'} → is that you? If not, `state set` it")
    for other in cands[1:4]:
        out(f"also: {other}")


# ---------------------------------------------------------------------------- state

def cmd_state(a):
    t = Todo(a.todo)
    if a.action == "show":
        items = t.items()
        if a.json:
            print(json.dumps({
                "todo": str(t.path), "block": t.block(), "own_workspace": t.own_workspace(),
                "items": [{"line": i + 1, "done": d, "text": x, "running": r} for i, d, x, r in items],
            }, indent=1, ensure_ascii=False))
            return
        out(f"todo: {t.path}", f"own workspace: {t.own_workspace() or '?'}")
        for i, d, x, r in items:
            out(f"  {'x' if d else ('>' if r else ' ')} line {i + 1}: {one_line(x, 90)}" + (f"  {r}" if r else ""))
        return

    if a.action == "set":
        t.set_line(a.key, a.value)
        t.save()
        return out(f"set {a.key}: {a.value}")

    if a.action == "start":
        i, _, text, _ = t.find_item(a.item)
        base = RUNNING_RE.sub("", t.line(i))
        t.replace_line(i, f"{base} ← running: {a.ws} / agent {a.agent} / {a.profile}")
        t.save()
        out(f"running: line {i + 1}: {one_line(text, 80)}")
        return move_item_ticket(t, text, "start", a.no_ticket)

    if a.action == "unmark":
        i, _, text, r = t.find_item(a.item)
        if r:
            t.replace_line(i, RUNNING_RE.sub("", t.line(i)))
            t.save()
        return out(f"unmarked: line {i + 1}: {one_line(text, 80)}" if r else "nothing to unmark")

    if a.action == "done":
        i, _, text, _ = t.find_item(a.item)
        m = ITEM_RE.match(RUNNING_RE.sub("", t.line(i)))
        rest = m.group(4).rstrip()
        if a.pr and not re.search(rf"PR #{a.pr}\b", rest):
            rest += f" — PR #{a.pr}"
        t.replace_line(i, f"{m.group(1)}x{m.group(3)}{rest}")
        t.save()
        out(f"ticked: line {i + 1}: {one_line(rest, 80)} → count it and run `name <done> <total>`")
        return move_item_ticket(t, text, "done", a.no_ticket)


def move_item_ticket(t, text, which, skip):
    key = item_key(text)
    if skip or not key or t.tracker()[0] in (None, "none"):
        return
    ticket_move(key, which, t)


# ---------------------------------------------------------------------------- ticket

def jira_sh(args):
    """Run jira with the env-file token loaded when the shell did not load it."""
    load = f'[ -n "${{JIRA_API_TOKEN:-}}" ] || {{ [ -f {JIRA_ENV} ] && . {JIRA_ENV}; }}; '
    return run(load + "jira " + " ".join(_q(x) for x in args), shell=True, timeout=60)


def _q(s):
    return "'" + str(s).replace("'", "'\\''") + "'"


def detect_tracker():
    if shutil.which("jira"):
        code, me, _ = jira_sh(["me"])
        if code == 0 and me:
            return "jira-cli", me
    if shutil.which("acli"):
        code, so, se = run(["acli", "jira", "auth", "status"])
        if code == 0:
            return "acli", one_line(so or se, 80)
    return "none", ""


def cmd_ticket(a):
    if a.action == "detect":
        tracker, who = detect_tracker()
        return out(f"tracker: {tracker}" + (f" ({who})" if who else "")
                   + ("" if tracker != "none" else " → say so once and carry on; don't install or log in"))
    if not a.key or a.which not in ("start", "done"):
        sys.exit("usage: foreman.py ticket move KEY start|done [--todo TODO]")
    ticket_move(a.key, a.which, Todo(a.todo) if a.todo else None)


def ticket_move(key, which, todo=None):
    tracker = None
    state = {"start": "In Progress", "done": "Done"}[which]
    if todo is not None:
        tracker, states = todo.tracker()
        state = states.get(which) or state
    if tracker not in ("jira-cli", "acli", "none"):
        tracker, _ = detect_tracker()
    if tracker == "none":
        return out(f"ticket {key}: no tracker, not moved")

    if tracker == "jira-cli":
        code, raw, _ = jira_sh(["issue", "view", key, "--raw"])
        if code == 0:
            try:
                cur = json.loads(raw)["fields"]["status"]["name"]
                if cur.lower() == state.lower():
                    return out(f"ticket {key}: already {cur!r}")
            except (ValueError, KeyError, TypeError):
                pass
        code, so, se = jira_sh(["issue", "move", key, state])
    else:
        code, so, se = run(["acli", "jira", "workitem", "transition", "--key", key, "--status", state, "--yes"])
    if code == 0:
        return out(f"ticket {key}: moved to {state!r} ({tracker})")
    out(f"ticket {key}: move to {state!r} FAILED ({tracker}): {one_line(se or so, 240)}",
        "  → the error lists the valid states: take the plain equivalent, set it in the block "
        "(tracker line, start= / done=) and retry, or ask the user once. Don't hold up the cycle.")


# ---------------------------------------------------------------------------- check

def paseo_json(args):
    code, so, se = run(["paseo", *args, "--json"], timeout=30)
    if code != 0:
        return None, one_line(se or so, 160)
    try:
        return json.loads(so), None
    except ValueError:
        return None, "unreadable JSON"


def last_text(agent):
    code, so, _ = run(["paseo", "logs", agent, "--filter", "text", "--tail", "1"], timeout=30)
    return one_line(so, 400) if code == 0 else ""


def cmd_check(a):
    t = Todo(a.todo)
    running = []
    for i, _, text, r in t.items():
        if r:
            ws = re.search(r"wks_\w+", r)
            ag = re.search(r"agent\s+([0-9a-f-]{6,})", r)
            running.append((i, text, ws.group(0) if ws else None, ag.group(1) if ag else None))
    if not running:
        return out("running: none → start the next item, or finish the cycle (§8) when all are ticked")

    workspaces, err = paseo_json(["workspace", "ls"])
    if workspaces is None:
        return out(f"paseo unreachable ({err}): is the daemon down? check its log, then resume (§6)")
    live_ws = {w.get("workspaceId") for w in workspaces}

    lines, idle_no_pr, actionable = [], 0, False

    for i, text, ws, ag in running:
        label = KEY_RE.search(text).group(0) if KEY_RE.search(text) else one_line(text, 40)
        if not ag:
            lines.append(f"? {label}: no agent id in the marker on line {i + 1}")
            actionable = True
            continue
        info, err = paseo_json(["inspect", ag])
        if info is None:
            lines.append(f"? {label}: agent {ag[:8]} not found ({err})")
            actionable = True
            continue
        status = (info.get("Status") or "?").lower()
        perms = info.get("PendingPermissions") or []
        upd = info.get("UpdatedAt") or ""
        ws_note = "" if ws in live_ws else " · WORKSPACE GONE (archived or lost?)"
        actionable |= bool(ws_note)
        if perms:
            actionable = True
            for p in perms:
                lines.append(f"! {label}: PERMISSION pending · {one_line(json.dumps(p, ensure_ascii=False), 300)}"
                             " → inspect the target, then respond_to_permission")
        if status == "running":
            lines.append(f"{'!' if ws_note else ' '} {label}: running (last update {upd[11:16]}Z){ws_note}")
            continue
        actionable = True
        msg = last_text(ag)
        prs = re.findall(r"(?:PR\s*#|/pull/)(\d+)", msg)
        verdict = ""
        if prs:
            code, so, _ = run(["gh", "pr", "view", prs[0], "--json", "state"], timeout=30)
            state = json.loads(so).get("state") if code == 0 and so else "?"
            verdict = f" · PR #{prs[0]} {state}"
            if state == "MERGED":
                verdict += " → looks done: `verify-pr`, archive, `state done` (§6)"
        else:
            idle_no_pr += 1
        lines.append(f"* {label}: {status}{ws_note}{verdict}"
                     f" · last: {msg or '(no text)'}")


    if idle_no_pr == len(running) and len(running) > 1:
        lines.append("! ALL workers idle without a PR: likely a daemon restart (check its log for an OOM), "
                     "resume each with what was running (§6)")
    elif idle_no_pr:
        lines.append("  idle without a PR: waiting on a background step, or stopped → nudge as a continuation (§6)")
    if not actionable:
        lines.insert(0, f"NO CHANGE: all {len(running)} workers running, no permission pending")
    out(*lines)


# ---------------------------------------------------------------------------- verify-pr

def cmd_verify_pr(a):
    fields = "number,title,state,mergedAt,mergeCommit,baseRefName,headRefName,url,files,additions,deletions"
    code, so, se = run(["gh", "pr", "view", str(a.pr), "--json", fields], timeout=60)
    if code != 0:
        return out(f"PR #{a.pr}: cannot read it ({one_line(se, 200)})")
    pr = json.loads(so)
    if pr["state"] != "MERGED":
        return out(f"NOT MERGED: PR #{a.pr} is {pr['state']} · {pr['title']} · {pr['url']}",
                   "→ don't tick the item; leave its ticket where it is")
    base = pr["baseRefName"]
    want = Todo(a.todo).field("default branch") if a.todo else None
    want = want.split()[0] if want else None
    sha = (pr.get("mergeCommit") or {}).get("oid", "")
    run(["git", "fetch", "-q", "origin", base], timeout=120)
    on_base, _, _ = run(["git", "merge-base", "--is-ancestor", sha, f"origin/{base}"]) if sha else (1, "", "")
    out(f"MERGED: PR #{a.pr} {pr['title']} · {pr['mergedAt']} · into {base} @ {sha[:9]}"
        f" ({'on' if on_base == 0 else 'NOT on'} origin/{base})"
        + (f" · WARNING: default branch is {want}" if want and want != base else ""),
        f"diff: {len(pr['files'])} files, +{pr['additions']} −{pr['deletions']}")
    for f in sorted(pr["files"], key=lambda f: -(f["additions"] + f["deletions"]))[: a.limit]:
        out(f"  {f['path']}  +{f['additions']} −{f['deletions']}")
    if len(pr["files"]) > a.limit:
        out(f"  … {len(pr['files']) - a.limit} more")
    out(f"key hunks: gh pr diff {a.pr}  (or git show {sha[:9]} -- <file>)")


# ---------------------------------------------------------------------------- capacity

def meminfo():
    info = {}
    try:
        for line in Path("/proc/meminfo").read_text().splitlines():
            k, v = line.split(":", 1)
            info[k] = int(v.split()[0]) / 1024 / 1024  # GiB
    except OSError:
        pass
    return info


def cmd_capacity(a):
    cores = os.cpu_count() or 1
    mem = meminfo()
    total, avail = mem.get("MemTotal", 0), mem.get("MemAvailable", 0)
    swap_used = mem.get("SwapTotal", 0) - mem.get("SwapFree", 0)
    load = os.getloadavg()[0] if hasattr(os, "getloadavg") else 0
    code, fstype, _ = run(["findmnt", "-n", "-o", "FSTYPE", "/tmp"])
    tmp_tmpfs = code == 0 and fstype == "tmpfs"
    du = shutil.disk_usage("/tmp")
    agents, _ = paseo_json(["ls", "-g"])
    busy = sum(1 for x in agents or [] if x.get("status") == "running")

    # One worker with a dev server, tests and a browser needs about a core and 1.5 GiB.
    fit = max(1, min(cores, int(total / 1.5)))
    out(f"cores: {cores} · load(1m): {load:.1f} · running agents: {busy if agents is not None else '?'}",
        f"memory: {total:.1f} GiB total, {avail:.1f} GiB available · swap used: {swap_used:.1f} GiB",
        f"/tmp: {'tmpfs (counts as RAM)' if tmp_tmpfs else fstype or '?'} · "
        f"{du.used / 2**30:.1f} of {du.total / 2**30:.1f} GiB used")
    warn = []
    if avail < 1.0:
        warn.append("less than 1 GiB available")
    if swap_used > total / 2:
        warn.append("heavy swap use")
    if load > cores * 1.5:
        warn.append("load well above the core count")
    if tmp_tmpfs and du.used > du.total / 2:
        warn.append("/tmp is over half full and lives in RAM")
    if warn:
        out("warning: " + "; ".join(warn) + " → clean stale caches, keep the limit low")
    suggest = 1 if warn else min(2, fit)
    out(f"parallel: suggest {suggest}" + (f" (the machine fits {fit}; raise only when the user asks)" if fit > 2 else ""))
    if a.caches or warn:
        code, so, _ = run("du -sxm /tmp/* /tmp/.[!.]* 2>/dev/null | sort -rn | head -5", shell=True, timeout=20)
        if so:
            out("largest in /tmp (MiB):", *("  " + l for l in so.splitlines()))


# ---------------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(prog="foreman.py", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("find-todo", help="pick the TODO file")
    p.add_argument("path", nargs="?")
    p.set_defaults(fn=cmd_find_todo)

    p = sub.add_parser("state", help="read or change the foreman block and the checklist")
    ss = p.add_subparsers(dest="action", required=True)
    s = ss.add_parser("show"); s.add_argument("todo"); s.add_argument("--json", action="store_true")
    s = ss.add_parser("set", help="set one `key: value` line in the block")
    s.add_argument("todo"); s.add_argument("key"); s.add_argument("value")
    s = ss.add_parser("start", help="mark an item running, move its ticket")
    s.add_argument("todo"); s.add_argument("item"); s.add_argument("--ws", required=True)
    s.add_argument("--agent", required=True); s.add_argument("--profile", default="own settings")
    s.add_argument("--no-ticket", action="store_true")
    s = ss.add_parser("unmark", help="drop an item's running marker (failed merge, restart)")
    s.add_argument("todo"); s.add_argument("item")
    s = ss.add_parser("done", help="tick an item, move its ticket")
    s.add_argument("todo"); s.add_argument("item"); s.add_argument("--pr")
    s.add_argument("--no-ticket", action="store_true")
    p.set_defaults(fn=cmd_state)

    p = sub.add_parser("name", help="name the own workspace `Foreman (DONE/TOTAL)`, or read the name")
    p.add_argument("done", nargs="?", type=int); p.add_argument("total", nargs="?", type=int)
    p.add_argument("--ws", help="workspace id; default: the one whose cwd is this directory")
    p.set_defaults(fn=cmd_name)

    p = sub.add_parser("ticket", help="detect the tracker, or move a ticket")
    p.add_argument("action", choices=["detect", "move"])
    p.add_argument("key", nargs="?"); p.add_argument("which", nargs="?"); p.add_argument("--todo")
    p.set_defaults(fn=cmd_ticket)

    p = sub.add_parser("check", help="scan every running workspace")
    p.add_argument("todo")
    p.set_defaults(fn=cmd_check)

    p = sub.add_parser("verify-pr", help="is the PR merged, and what did it change")
    p.add_argument("pr"); p.add_argument("--todo"); p.add_argument("--limit", type=int, default=12)
    p.set_defaults(fn=cmd_verify_pr)

    p = sub.add_parser("capacity", help="machine headroom and a parallel limit")
    p.add_argument("--caches", action="store_true", help="also list the largest entries in /tmp")
    p.set_defaults(fn=cmd_capacity)

    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
