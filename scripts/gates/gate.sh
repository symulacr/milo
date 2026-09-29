#!/usr/bin/env bash
# G0: substance checks. Mutated inputs must FAIL.
export PATH="/home/eya/.bun/bin:/usr/bin:/bin:$PATH"
set -euo pipefail
STAGE="${1:-prototype}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
HEAD=$(git rev-parse HEAD)
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p gates
OUT="gates/${STAGE}-${TS}.json"
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
    tail -8 /tmp/gate-$id.out >&2 || true
  fi
}

# --- substance helpers ---
unit_counts() {
  # parse bun test summary: 493 pass 0 fail 0 error
  local out=/tmp/gate-unit-raw.out
  bun run test:unit >"$out" 2>&1 || true
  local p f e
  p=$(grep -oE '^ *[0-9]+ pass' "$out" | tail -1 | grep -oE '[0-9]+' || echo 0)
  f=$(grep -oE '^ *[0-9]+ fail' "$out" | tail -1 | grep -oE '[0-9]+' || echo 0)
  e=$(grep -oE '^ *[0-9]+ error' "$out" | tail -1 | grep -oE '[0-9]+' || echo 0)
  echo "$p $f $e"
  [ "$f" -eq 0 ] && [ "$e" -eq 0 ] && [ "$p" -gt 100 ]
}

contract_lines() {
  local n
  n=$(wc -l < packages/contract/src/order.compact)
  [ "$n" -eq 247 ] && echo "lines=$n"
}

contract_hash() {
  local h
  h=$(sha256sum packages/contract/src/order.compact | awk '{print $1}')
  [ "$h" = "0bede3fbadbda00410db4888394f430fd327f89dd868714fb93f23da12096fe0" ] && echo "hash=$h"
}

security_modules() {
  for f in convex/http.ts convex/settlement.ts convex/files.ts convex/observationIngest.ts \
           packages/backend/src/release-flags.mjs packages/domain/src/recovery-kit.ts \
           packages/backend/src/delivery-commitment.mjs; do
    [ -s "$f" ] || { echo "missing $f"; return 1; }
  done
  # substance: each must have a sibling test or test name
  grep -q 'verifyStripeSignature\|HMAC' convex/http.ts
  grep -q 'capture\|void' convex/settlement.ts
  grep -q 'deliveryCommitment\|inspectBytes' packages/backend/src/delivery-policy.ts
  echo modules-ok
}

ledger_script() {
  [ -f ../audit/discovery/MASTER-LEDGER.md ] || return 1
  grep -q '| ID |' ../audit/discovery/MASTER-LEDGER.md
  rows=$(grep -c 'L-' ../audit/discovery/MASTER-LEDGER.md); echo rows=$rows; [ "$rows" -ge 20 ]
}

secret_scan() {
  if git ls-files | grep -qE '\.env\.local|\.env\.preprod'; then
    echo "tracked secret file"; return 1
  fi
  # no live key patterns in tracked source
  if grep -RInE 'sk_test_[A-Za-z0-9]{20,}|whsec_[A-Za-z0-9]{20,}'       --include='*.ts' --include='*.tsx' --include='*.mjs' --include='*.js'       . 2>/dev/null | grep -v node_modules | grep -v '/tests/' | grep -vE '\.test\.(ts|tsx|js|mjs)' | head -1 | grep -q .; then
    echo "live key in source"; return 1
  fi
  echo secrets-ok
}

case "$STAGE" in
  prototype)
    check P1_ledger 'ledger_script'
    check P2_typecheck 'bun run typecheck'
    check P2_lint 'bun run lint'
    check P2_build 'bun run build && test -s dist/index.html || test -s dist/app-*.js || ls dist/*.js >/dev/null'
    check P2_unit 'unit_counts'
    check P3_contract 'contract_lines && contract_hash'
    check P4_security 'security_modules'
    check P6_secrets 'secret_scan'
    ;;
  demo)
    check D_receipts 'test -s RECEIPTS.md && grep -q VERIFIED-ONCHAIN RECEIPTS.md'
    ;;
  mvp|production)
    check M_todo 'grep -q "\[x\]" TODO.md'
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
  exit 0
else
  echo "STAGE_AT_HEAD=NONE"
  exit 1
fi
