#!/usr/bin/env python3
"""Shared TODO parser for next-task / todo-check."""
from __future__ import annotations
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TODO = ROOT / "TODO.md"

# Matches both legacy "- [x] ID | title | ..." and table rows.
ROW_RE = re.compile(
    r"^- \[(?P<box>[ xX])\]\s*(?P<body>.+)$",
    re.M,
)


def parse_items():
    text = TODO.read_text(encoding="utf-8")
    items = []
    for m in ROW_RE.finditer(text):
        body = m.group("body").strip()
        box = m.group("box")
        parts = [p.strip() for p in body.split("|")]
        # ID is first token of first part (may have trailing annotations)
        id_field = parts[0] if parts else body
        # extract leading ID (word chars, dashes, arrows)
        idm = re.match(r"([A-Za-z0-9_→\-]+)", id_field)
        iid = idm.group(1) if idm else id_field[:20]
        title = id_field[idm.end() :].strip(" -–—(") if idm else id_field
        if title.startswith("("):
            # title after annotation
            tm = re.search(r"\)\s*(.+)$", id_field)
            title = tm.group(1).strip() if tm else title
        depends = parts[2] if len(parts) > 2 else ""
        # normalize depends tokens
        deps = []
        if depends and depends not in ("", "—", "-", "n/a"):
            for tok in re.split(r"[,\s]+", depends):
                tok = tok.strip()
                if tok and tok not in ("—", "-", "n/a", "none"):
                    deps.append(tok)
        rest = parts[3:]
        # legacy: rest[0]=acceptance, rest[1]=stage
        acceptance = rest[0] if rest else ""
        evidence = ""
        em = re.search(r"(obs_[a-z0-9_]+)", body)
        if em:
            evidence = em.group(1)
        # state
        if box in ("x", "X"):
            state = "checked"
        elif re.search(r"\bowner[- ]?blocked\b|O-PRIVY|owner gap|owner accept", body, re.I):
            state = "owner-blocked"
        elif re.search(r"\bblocked\b", body, re.I):
            state = "blocked"
        else:
            state = "todo"
        items.append(
            {
                "id": iid,
                "title": title or id_field,
                "state": state,
                "depends": deps,
                "acceptance": acceptance,
                "evidence": evidence,
                "raw": body,
            }
        )
    return items


def is_unblocked(item, by_id):
    for d in item["depends"]:
        # strip parenthetical
        d2 = re.split(r"[\s(]", d)[0]
        dep = by_id.get(d2)
        if dep is None:
            # unknown dep: treat as satisfied if it looks like a stage label
            if d2.lower() in ("g0", "g1", "g2", "g3", "g4", "g5", "d1", "d2", "d3", "r1", "r2", "u0"):
                continue
            # if depends on something not in list, don't block forever
            continue
        if dep["state"] != "checked":
            return False
    return True


def cmd_next():
    items = parse_items()
    by_id = {i["id"]: i for i in items}
    for i in items:
        if i["state"] != "checked" and is_unblocked(i, by_id):
            print(i["id"])
            print(f"claim: {i['title']}")
            print(f"depends: {','.join(i['depends']) or '(none)'}")
            print(f"acceptance: {i['acceptance']}")
            print(f"evidence: {i['evidence'] or '(none)'}")
            print(f"code_refs: {i['raw'][:200]}")
            return
    print("NONE")


def cmd_counts():
    items = parse_items()
    by_id = {i["id"]: i for i in items}
    checked = sum(1 for i in items if i["state"] == "checked")
    unblocked = sum(
        1
        for i in items
        if i["state"] == "todo" and is_unblocked(i, by_id)
    )
    blocked = sum(
        1
        for i in items
        if i["state"] == "blocked" or (i["state"] == "todo" and not is_unblocked(i, by_id))
    )
    owner = sum(1 for i in items if i["state"] == "owner-blocked")
    print(f"items {len(items)}")
    print(f"checked {checked}")
    print(f"unchecked-unblocked {unblocked}")
    print(f"unchecked-blocked {blocked}")
    print(f"owner-blocked {owner}")
    # exclusive sum check
    s = checked + unblocked + blocked + owner
    print(f"sum {s} (must equal items {len(items)})")
    if s != len(items):
        # force into blocked bucket
        print(f"adjust-blocked {blocked + (len(items) - s)}")


def cmd_verify_refs():
    items = parse_items()
    missing = []
    for i in items:
        for m in re.finditer(r"([A-Za-z0-9_./-]+\.(?:ts|tsx|mjs|js|md|sh))", i["raw"]):
            rel = m.group(1)
            if not (ROOT / rel).exists() and not (ROOT / "scripts" / rel).exists():
                # allow globs / examples
                if any(ch in rel for ch in "*"):
                    continue
                missing.append((i["id"], rel))
    print(f"missing_refs {len(missing)}")
    for iid, rel in missing[:20]:
        print(f"  {iid}: {rel}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "next"
    if cmd == "next":
        cmd_next()
    elif cmd == "counts":
        cmd_counts()
    elif cmd == "verify-refs":
        cmd_verify_refs()
    else:
        print("usage: todo_lib.py next|counts|verify-refs", file=sys.stderr)
        sys.exit(2)
