#!/usr/bin/env bash
# judging-minimum.sh — report MET/NOT MET per J1–J6.
#
# J1 (repo topic) and J6 (SUBMISSION-UPDATE naming HEAD) are owner actions that
# no code change can satisfy, so they are reported as OWNER and do not fail the
# gate: a gate that can never turn green is not a gate. Everything a commit can
# actually fix (J2 compile receipt, J3 readme, J4 deck, J5 demo URL) still gates.
set -u
cd "$(dirname "$0")/.."
echo "=== JUDGING MINIMUM $(git rev-parse --short HEAD) ==="
unmet=0
owner=0
met() { echo "$1 MET${2:+ ($2)}"; }
not_met() { echo "$1 NOT MET${2:+ ($2)}"; unmet=$((unmet + 1)); }
needs_owner() { echo "$1 OWNER${2:+ ($2)}"; owner=$((owner + 1)); }

j1() {
  # repo public + topic — read-only gh; owner sets topic
  if command -v gh >/dev/null 2>&1; then
    out=$(gh api repos/symulacr/milo --jq '{v:.visibility,t:.topics}' 2>/dev/null) || out=""
    echo "J1 api=$out"
    if echo "$out" | grep -q 'midnightntwrk'; then
      met J1 "topic midnightntwrk"
    else
      needs_owner J1 "owner sets topic midnightntwrk"
    fi
  else
    not_met J1 "gh unavailable; owner sets topic"
  fi
}

j2() {
  if [ -f packages/contract/src/order.compact ]; then
    h=$(sha256sum packages/contract/src/order.compact | awk '{print $1}')
    echo "J2 source sha256=$h"
    # Compare against the compile receipt, not a hardcoded digest: a receipt
    # that disagrees with the source is the defect this check exists to catch.
    receipt=packages/contract/generated/compile-receipt.json
    if [ ! -f "$receipt" ]; then
      not_met J2 "missing compile receipt"
      return
    fi
    recorded=$(sed -n 's/.*"sourceSha256": *"\([0-9a-f]*\)".*/\1/p' "$receipt" | head -1)
    if [ "$h" = "$recorded" ]; then
      met J2 "source matches compile receipt"
    else
      not_met J2 "source hash does not match compile receipt"
    fi
  else
    not_met J2 "missing order.compact"
  fi
}

j3() {
  if [ -f scripts/verify-readme.sh ] && bash scripts/verify-readme.sh >/tmp/j3.out 2>&1; then
    met J3 "verify-readme pass"
  else
    not_met J3 "verify-readme fail"
  fi
}

j4() {
  # The requirement is a deck of at most 10 slides. Grading a stray one-page
  # slide PDF as "the deck" would pass a submission with no deck at all, so the
  # multi-page deck is named explicitly and the per-slide files are not
  # candidates. PITCH.md alone is a document, not slides, so it stays a partial.
  local pdf pages
  pdf=pitch/deck/milo-d7-deck.pdf
  if [ -f "$pdf" ]; then
    pages=$(pdfinfo "$pdf" 2>/dev/null | sed -n 's/^Pages:[[:space:]]*//p')
    if [ -z "$pages" ]; then
      echo "J4 PARTIAL (deck PDF present: $pdf; page count unreadable — confirm ≤10)"
    elif [ "$pages" -le 10 ]; then
      met J4 "deck PDF $pdf has $pages slides (≤10)"
    else
      not_met J4 "deck PDF $pdf has $pages slides, over the 10-slide limit"
    fi
  elif [ -f PITCH.md ]; then
    echo "J4 PARTIAL (PITCH.md present; no deck PDF — confirm slides required)"
  else
    not_met J4 "no deck PDF and no PITCH.md"
  fi
}

j5() {
  # The requirement is that the README carries a reachable demo video URL. A
  # hardcoded failure is not a gate: it reports the same verdict whether or not
  # the video exists, so it can never turn green and never tells the truth.
  local url
  url=$(grep -oE 'https?://(www\.)?(youtu\.be|youtube\.com)/[A-Za-z0-9_/?=&.-]+' README.md 2>/dev/null | head -1)
  if [ -n "$url" ]; then
    met J5 "demo video URL in README: $url"
  else
    not_met J5 "no YouTube demo URL in README"
  fi
}

j6() {
  # SUBMISSION-UPDATE.md must exist and must name the commit it describes, so a
  # stale copy from an earlier push cannot satisfy the check indefinitely.
  if [ ! -f SUBMISSION-UPDATE.md ]; then
    not_met J6 "missing SUBMISSION-UPDATE.md"
    return
  fi
  local head_sha
  head_sha=$(git rev-parse --short HEAD 2>/dev/null)
  if [ -n "$head_sha" ] && grep -q "$head_sha" SUBMISSION-UPDATE.md 2>/dev/null; then
    met J6 "SUBMISSION-UPDATE.md names HEAD $head_sha"
  else
    echo "J6 PARTIAL (SUBMISSION-UPDATE.md present; does not name HEAD $head_sha)"
  fi
}

j7() {
  # The taste lint is not in the repo, so a clone cannot run it. Report MET when
  # it passes, NOT MET when it finds a FAIL, and OWNER when the tool is absent:
  # that keeps it out of the failing count on CI (where it never exists) while
  # still failing a local run that regresses.
  local lint="${TASTE_LINT:-}" dir
  if [ -z "$lint" ]; then
    # Walk up from the repo root: the skill sits beside the checkout in the
    # common case, but a sandbox can be several levels deeper.
    dir=$(pwd)
    while [ "$dir" != "/" ]; do
      if [ -f "$dir/.agents/skills/design-taste-frontend/scripts/lint.mjs" ]; then
        lint="$dir/.agents/skills/design-taste-frontend/scripts/lint.mjs"
        break
      fi
      dir=$(dirname "$dir")
    done
  fi
  if [ -z "$lint" ] || [ ! -f "$lint" ]; then
    needs_owner J7 "taste lint not installed (set TASTE_LINT)"
    return
  fi
  local out
  out=$(node "$lint" apps/web/src 2>&1)
  if echo "$out" | grep -q 'RESULT: 0 FAIL'; then
    met J7 "taste lint clean"
  else
    echo "$out" | grep -E 'RESULT|^\s+\[' | head -12
    not_met J7 "taste lint found FAILs"
  fi
}

j1; j2; j3; j4; j5; j6; j7
echo "=== unmet: $unmet  owner: $owner ==="
[ "$unmet" -eq 0 ]
