#!/usr/bin/env bash
export PATH="/home/eya/.bun/bin:/usr/bin:/bin:$PATH"
# gate.sh <prototype|demo|mvp|production>
# Writes gates/<stage>-<timestamp>.json. Prints highest ALL-PASS stage.
set -euo pipefail
STAGE="${1:-prototype}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
HEAD=$(git rev-parse HEAD)
TS=$(date +%Y%m%d-%H%M%S)
OUT="gates/${STAGE}-${TS}.json"
mkdir -p gates
pass=0; fail=0
results=()

check() {
  local id="$1" cmd="$2"
  local ok=0
  if eval "$cmd" >/tmp/gate-$id.out 2>&1; then ok=1; fi
  if [ "$ok" -eq 1 ]; then
    results+=("{\"id\":\"$id\",\"status\":\"PASS\"}")
    pass=$((pass+1))
  else
    results+=("{\"id\":\"$id\",\"status\":\"FAIL\"}")
    fail=$((fail+1))
    echo "FAIL $id" >&2
    tail -5 /tmp/gate-$id.out >&2 || true
  fi
}

case "$STAGE" in
  prototype)
    check P1_docs 'test -f ../audit/discovery/MASTER-LEDGER.md && test -f STAGE-MAP.md && test -f DRIFT-CHECK.md'
    check P2_typecheck 'bun run typecheck'
    check P2_lint 'bun run lint'
    check P2_build 'bun run build'
    check P2_unit 'bun run test:unit'
    check P3_contract 'test -f packages/contract/src/order.compact && test "$(wc -l < packages/contract/src/order.compact)" -eq 247'
    check P4_security 'test -f convex/http.ts && test -f convex/settlement.ts && test -f convex/files.ts && test -f convex/observationIngest.ts && test -f packages/backend/src/release-flags.mjs && test -f packages/domain/src/recovery-kit.ts'
    check P6_secrets '! git ls-files | grep -E "\\.env\\.local|\\.env\\.preprod"'
    ;;
  demo|*)
    check D_placeholder 'test -f RECEIPTS.md'
    ;;
esac

{
  echo "{"
  echo "  \"stage\": \"$STAGE\","
  echo "  \"head\": \"$HEAD\","
  echo "  \"timestamp\": \"$TS\","
  echo "  \"pass\": $pass,"
  echo "  \"fail\": $fail,"
  echo "  \"results\": ["
  printf '%s\n' "${results[@]}" | paste -sd, -
  echo "  ]"
  echo "}"
} > "$OUT"
echo "wrote $OUT pass=$pass fail=$fail"
if [ "$fail" -eq 0 ]; then
  echo "STAGE_AT_HEAD=$STAGE"
  git tag -f "stage/${STAGE}-${HEAD:0:7}" 2>/dev/null || true
else
  echo "STAGE_AT_HEAD=NONE"
fi
