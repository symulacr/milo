#!/usr/bin/env bash
# judging-minimum.sh — print MET/NOT MET per J1–J6
set -u
cd "$(dirname "$0")/.."
echo "=== JUDGING MINIMUM $(git rev-parse --short HEAD) ==="

j1() {
  # repo public + topic — read-only gh; owner sets topic
  if command -v gh >/dev/null 2>&1; then
    out=$(gh api repos/symulacr/milo --jq '{v:.visibility,t:.topics}' 2>/dev/null) || out=""
    echo "J1 api=$out"
    echo "$out" | grep -q 'midnightntwrk' && echo "J1 MET" || echo "J1 NOT MET (owner must set topic midnightntwrk)"
  else
    echo "J1 NOT MET (gh unavailable; owner sets topic)"
  fi
}

j2() {
  if [ -f packages/contract/src/order.compact ]; then
    h=$(sha256sum packages/contract/src/order.compact | awk '{print $1}')
    echo "J2 source sha256=$h"
    if [ "$h" = "0bede3fbadbda00410db4888394f430fd327f89dd868714fb93f23da12096fe0" ]; then
      echo "J2 MET (canonical compile identity; 14 circuits in compile-receipt)"
    else
      echo "J2 NOT MET (source hash mismatch)"
    fi
  else
    echo "J2 NOT MET (missing order.compact)"
  fi
}

j3() {
  if [ -f scripts/verify-readme.sh ] && bash scripts/verify-readme.sh >/tmp/j3.out 2>&1; then
    echo "J3 MET (verify-readme pass)"
  else
    echo "J3 NOT MET (verify-readme fail)"
  fi
}

j4() {
  if [ -d docs/deck ] || ls pitch/deck/*.pdf >/dev/null 2>&1 || ls PITCH.md >/dev/null 2>&1; then
    echo "J4 PARTIAL (deck/PITCH present — confirm PDF slides ≤10)"
  else
    echo "J4 NOT MET"
  fi
}

j5() {
  echo "J5 NOT MET (demo video URL not in README)"
}

j6() {
  if [ -f SUBMISSION-UPDATE.md ]; then
    echo "J6 PARTIAL (SUBMISSION-UPDATE.md present; regenerate from evidence after push)"
  else
    echo "J6 NOT MET"
  fi
}

j1; j2; j3; j4; j5; j6
