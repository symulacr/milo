#!/usr/bin/env bash
# G0: substance checks. Mutated inputs must FAIL (see gate-selftest.sh).
# Check sets: prototype 8 · demo 9 · mvp 14 · production 9.
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

# --- substance helpers (every one can fail) ---
unit_counts() {
  local out=/tmp/gate-unit-raw.out
  bun run test:unit >"$out" 2>&1 || true
  local p f e
  p=$(grep -oE '^ *[0-9]+ pass' "$out" | tail -1 | grep -oE '[0-9]+' || echo 0)
  f=$(grep -oE '^ *[0-9]+ fail' "$out" | tail -1 | grep -oE '[0-9]+' || echo 0)
  e=$(grep -oE '^ *[0-9]+ error' "$out" | tail -1 | grep -oE '[0-9]+' || echo 0)
  echo "unit pass=$p fail=$f error=$e"
  [ "$f" -eq 0 ] && [ "$e" -eq 0 ] && [ "$p" -gt 100 ]
}

contract_lines() {
  local n
  n=$(wc -l < packages/contract/src/order.compact | tr -d ' ')
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
  grep -q 'verifyStripeSignature\|HMAC' convex/http.ts
  grep -q 'capture\|void' convex/settlement.ts
  grep -q 'deliveryCommitment\|inspectBytes' packages/backend/src/delivery-policy.ts
  echo modules-ok
}

ledger_script() {
  [ -f ../audit/discovery/MASTER-LEDGER.md ] || return 1
  grep -q '| ID |' ../audit/discovery/MASTER-LEDGER.md
  rows=$(grep -c 'L-' ../audit/discovery/MASTER-LEDGER.md || echo 0)
  echo rows=$rows
  [ "$rows" -ge 20 ]
}

secret_scan() {
  if git ls-files | grep -qE '\.env\.local|\.env\.preprod'; then
    echo "tracked secret file"; return 1
  fi
  if grep -RInE 'sk_test_[A-Za-z0-9]{20,}|whsec_[A-Za-z0-9]{20,}' \
      --include='*.ts' --include='*.tsx' --include='*.mjs' --include='*.js' \
      . 2>/dev/null | grep -v node_modules | grep -v '/tests/' \
      | grep -vE '\.test\.(ts|tsx|js|mjs)' | head -1 | grep -q .; then
    echo "live key in source"; return 1
  fi
  echo secrets-ok
}

typecheck_clean() {
  bun run typecheck >/tmp/gate-tc.out 2>&1
  ! grep -qE 'error TS[0-9]+' /tmp/gate-tc.out
}

lint_no_errors() {
  # Biome: exit 0 or only warnings/infos; any "error TS" style or biome errors fail.
  local out=/tmp/gate-lint.out
  bun run lint >"$out" 2>&1 || true
  if grep -qE 'Found [1-9][0-9]* errors' "$out"; then
    grep -E 'Found [0-9]+ errors' "$out"; return 1
  fi
  # treat explicit "error:" script failures as fail only when errors were emitted
  if grep -q 'Some errors were emitted' "$out" && grep -qE 'Found [1-9][0-9]* error' "$out"; then
    return 1
  fi
  echo lint-ok
}

build_artifacts() {
  bun run build >/tmp/gate-build.out 2>&1
  ls dist/*.js >/dev/null 2>&1 || ls dist/index.html >/dev/null 2>&1
  # real size, not empty
  find dist -name '*.js' -size +1k | head -1 | grep -q .
}

demo_local_happy() {
  # D2a: reserve/accept/submitDelivery/approve all SucceedEntirely with hashes
  [ -f RECEIPTS-LOCAL.md ] || return 1
  grep -q 'obs_d2a_local_happy_complete_1' RECEIPTS-LOCAL.md
  grep -q 'SucceedEntirely' RECEIPTS-LOCAL.md
  # four circuits named with tx hashes (0x + 64 hex)
  for c in reserve accept submitDelivery approve; do
    grep -q "$c" RECEIPTS-LOCAL.md || return 1
  done
  n=$(grep -cE '0x[0-9a-f]{64}|[0-9a-f]{64}' RECEIPTS-LOCAL.md || echo 0)
  echo hashes=$n
  [ "$n" -ge 4 ]
}

demo_contract_14() {
  # generated artifacts declare 14 circuits
  [ -d packages/contract/generated ] || return 1
  # compile receipt or verifier set
  if [ -f packages/contract/generated/compile-receipt.json ]; then
    python3 -c 'import json,sys; r=json.load(open("packages/contract/generated/compile-receipt.json")); n=r.get("proofCircuits") or r.get("circuitNames") or r.get("circuits") or []; print("circuits", len(n)); sys.exit(0 if len(n)==14 else 1)'
  else
    # count circuit names in generated contract index
    n=$(rg -o 'provableCircuits|reserve|accept|submitDelivery|approve|cancelReserved|decline|disputeBuyer|disputeMerchant|escalateUnreviewed|expireBootstrap|expireDispute|expireReserved|expireUndelivered|resolve' \
      packages/contract/generated --glob '*.js' --glob '*.ts' -N 2>/dev/null | sort -u | wc -l)
    echo circuit-mentions=$n
    [ "$n" -ge 14 ]
  fi
}

demo_webhook_negatives() {
  bun test convex/http.test.ts packages/backend/test/auth-inventory.test.ts \
    >/tmp/gate-wh.out 2>&1 || true
  local p f
  p=$(grep -oE '^ *[0-9]+ pass' /tmp/gate-wh.out | tail -1 | grep -oE '[0-9]+' || echo 0)
  f=$(grep -oE '^ *[0-9]+ fail' /tmp/gate-wh.out | tail -1 | grep -oE '[0-9]+' || echo 0)
  echo "webhook/auth pass=$p fail=$f"
  [ "$f" -eq 0 ] && [ "$p" -ge 5 ]
}

demo_spends() {
  [ -f SPEND-LEDGER.md ] || return 1
  # at least one fee/tx row with a hash
  grep -qE 'txHash|tx hash|0x[0-9a-f]{16}' SPEND-LEDGER.md
  rows=$(grep -cE '^\|' SPEND-LEDGER.md || echo 0)
  echo spend-rows=$rows
  [ "$rows" -ge 5 ]
}

demo_clickmap() {
  [ -s CLICK-MAP.md ] || return 1
  # Real click map: multiple routes/states documented, not a stub.
  n=$(grep -cE '^#{1,4} |^\|.*\/|route|state|keyboard|375' CLICK-MAP.md || echo 0)
  echo clickmap-entries=$n
  [ "$n" -ge 8 ]
  grep -qiE '375|mobile|viewport|dark|light|keyboard' CLICK-MAP.md
  # stub detector
  if [ "$(wc -l < CLICK-MAP.md | tr -d ' ')" -lt 20 ]; then
    echo "clickmap too small"; return 1
  fi
}

demo_sdk_not_prod() {
  bun run build >/tmp/gate-b2.out 2>&1
  # connector strings must not appear in production JS
  if grep -R "walletSdkInitialApi\|__MILO_SDK_CONNECTOR__\|MidnightWalletSdkConnector" dist/ 2>/dev/null | head -1 | grep -q .; then
    echo "sdk connector leaked into dist"; return 1
  fi
  echo sdk-absent-in-prod
}

demo_copy_no_livepay() {
  # User-facing copy must not claim live payments.
  hits=$(rg -n 'live payments|accepts payment|we accept live|accept live payments'     apps/web/src/shells apps/web/src/routes apps/web/src/components     --glob '*.tsx' --glob '*.ts' 2>/dev/null     | grep -viE 'no live|not a production|not live|never|no live-pay|forbids|rejects'     | head -3 || true)
  if [ -n "$hits" ]; then
    echo "suspect live-pay claim"; echo "$hits"; return 1
  fi
  echo copy-clean
}

demo_evidence_ids() {
  # cited evidence IDs exist in receipts
  for id in obs_d2a_local_happy_complete_1 obs_m2_multi_instance_1; do
    grep -rq "$id" RECEIPTS-LOCAL.md RECEIPTS.md 2>/dev/null || { echo "missing $id"; return 1; }
  done
  echo evidence-ids-ok
}

demo_neg_controls() {
  # negative-control tests exist and pass (must-reject style names)
  rg -l 'rejects|must fail|negative|bad.sig|fail.closed' \
    --glob '*.test.ts' --glob '*.test.mjs' convex packages 2>/dev/null | head -5 | grep -q .
  bun test packages/backend/test/auth-inventory.test.ts convex/http.test.ts \
    >/tmp/gate-nc.out 2>&1 || true
  f=$(grep -oE '^ *[0-9]+ fail' /tmp/gate-nc.out | tail -1 | grep -oE '[0-9]+' || echo 0)
  echo neg-fail=$f
  [ "$f" -eq 0 ]
}

mvp_todo_m() {
  # every M4-M12 that is claimed done must still pass its acceptance command
  # M7 auth inventory completeness
  bun test packages/backend/test/auth-inventory.test.ts >/tmp/gate-m7.out 2>&1
  f=$(grep -oE '^ *[0-9]+ fail' /tmp/gate-m7.out | tail -1 | grep -oE '[0-9]+' || echo 0)
  echo m7-fail=$f
  [ "$f" -eq 0 ]
}

mvp_m4_stripe_window() {
  # M4: capture_before / usableUntil policy present and tested
  rg -n 'capture_before|captureBefore|usableUntil' packages/backend/src --glob '*.ts' | head -3 | grep -q .
  bun test packages/backend/test --timeout 20000 >/tmp/gate-m4.out 2>&1 || true
  f=$(grep -oE '^ *[0-9]+ fail' /tmp/gate-m4.out | tail -1 | grep -oE '[0-9]+' || echo 0)
  echo m4-fail=$f
  [ "$f" -eq 0 ]
}

mvp_m5_upload() {
  rg -n 'attachUpload|provenance|sha256' convex/files.ts | head -3 | grep -q .
  bun test convex/files.test.ts >/tmp/gate-m5.out 2>&1
  f=$(grep -oE '^ *[0-9]+ fail' /tmp/gate-m5.out | tail -1 | grep -oE '[0-9]+' || echo 0)
  echo m5-fail=$f
  [ "$f" -eq 0 ]
}

mvp_m6_recovery() {
  [ -s packages/domain/src/recovery-kit.ts ]
  rg -n 'recovery|RecoveryKit' apps/web/src packages/domain/src --glob '*.ts' --glob '*.tsx' | head -3 | grep -q .
  bun test packages/domain --timeout 20000 >/tmp/gate-m6.out 2>&1 || true
  f=$(grep -oE '^ *[0-9]+ fail' /tmp/gate-m6.out | tail -1 | grep -oE '[0-9]+' || echo 0)
  echo m6-fail=$f
  [ "$f" -eq 0 ]
}

mvp_m9_privacy() {
  bun test packages/backend/test/privacy-invariants.test.ts >/tmp/gate-m9.out 2>&1
  f=$(grep -oE '^ *[0-9]+ fail' /tmp/gate-m9.out | tail -1 | grep -oE '[0-9]+' || echo 0)
  echo m9-fail=$f
  [ "$f" -eq 0 ]
}

mvp_m11_indep() {
  # independent re-query evidence
  grep -q 'obs_m11_indep_verify_1\|independent' RECEIPTS-LOCAL.md
  [ -f scripts/m11-verify.mjs ] || [ -f scripts/m11-verify.ts ]
}

mvp_m12_docs() {
  [ -s DESIGN-PARTNER-GUIDE.md ] && [ -s RUNBOOKS.md ]
  grep -q 'SLO\|runbook\|partner' RUNBOOKS.md DESIGN-PARTNER-GUIDE.md
}

mvp_integration() {
  # integration suite exit 0 if present
  if grep -q '"test:integration"' package.json; then
    bun run test:integration >/tmp/gate-int.out 2>&1
  else
    echo no-integration-script
    # require at least integration tests to exist
    ls packages/integration/test >/dev/null 2>&1
  fi
}

mvp_coverage() {
  # M10: produce a non-trivial coverage artifact
  if [ ! -f coverage/lcov.info ]; then
    if grep -q 'test:coverage|coverage' package.json; then
      bun run test:coverage >/tmp/gate-cov.out 2>&1 || true
    fi
  fi
  if [ -f coverage/lcov.info ]; then
    lines=$(wc -l < coverage/lcov.info | tr -d ' ')
    echo lcov-lines=$lines
    [ "$lines" -gt 50 ]
  else
    bun test --coverage >/tmp/gate-cov2.out 2>&1 || true
    find . -name 'lcov.info' -not -path './node_modules/*' | head -1 | grep -q .
  fi
}

mvp_mut_neg() {
  # every critical module has a negative-control style test file
  for m in convex/http.ts convex/settlement.ts packages/backend/src/admission-policy.ts; do
    base=$(basename "$m" | sed 's/\.[^.]*$//')
    rg -l "$base" --glob '*.test.ts' --glob '*.test.mjs' . 2>/dev/null | head -1 | grep -q . || {
      echo "no test for $m"; return 1; }
  done
  echo neg-modules-ok
}

mvp_orders_obs() {
  # orders:recordObservation + observationIngest overlap tested
  [ -s convex/orders.ts ] && [ -s convex/observationIngest.ts ]
  if ! grep -qE 'export const recordObservation[[:space:]]*=' convex/orders.ts; then
    echo "orders.ts missing exported recordObservation"; return 1
  fi
  if ! grep -q 'applyChainObservation' convex/observationIngest.ts; then
    echo "observationIngest missing applyChainObservation"; return 1
  fi
  bun test convex/observationIngest.test.ts >/tmp/gate-oi.out 2>&1
  f=$(grep -oE '^ *[0-9]+ fail' /tmp/gate-oi.out | tail -1 | grep -oE '[0-9]+' || echo 0)
  echo oi-fail=$f
  [ "$f" -eq 0 ]
}

prod_pr2_auth() {
  bun test packages/backend/test/auth-inventory.test.ts >/tmp/gate-pr2.out 2>&1
  f=$(grep -oE '^ *[0-9]+ fail' /tmp/gate-pr2.out | tail -1 | grep -oE '[0-9]+' || echo 0)
  echo pr2-fail=$f
  [ "$f" -eq 0 ]
}

prod_pr5_livegate() {
  # live payments gated OFF
  rg -n 'live|PAYMENTS_LIVE|release-flags|live-gate' packages/backend/src/release-flags.mjs PAYMENTS-LIVE-GATE.md | head -5 | grep -q .
  # must not enable live
  ! rg -n 'PAYMENTS_LIVE\s*=\s*true|liveMode:\s*true' packages convex apps --glob '*.ts' --glob '*.mjs' 2>/dev/null | head -1 | grep -q .
}

prod_pr6_privacy() {
  bun test packages/backend/test/privacy-invariants.test.ts apps/web/src --timeout 20000 >/tmp/gate-pr6.out 2>&1 || true
  f=$(grep -oE '^ *[0-9]+ fail' /tmp/gate-pr6.out | tail -1 | grep -oE '[0-9]+' || echo 0)
  echo pr6-fail=$f
  [ "$f" -eq 0 ]
  rg -n 'privacy|Privacy' apps/web/src/routes apps/web/src/shells --glob '*.ts*' | head -2 | grep -q .
}

prod_pr7_axe() {
  # axe serious=0 evidence + script present
  [ -f scripts/pr7-axe.mjs ] || [ -f scripts/pr7-axe.ts ]
  grep -q 'obs_pr7_axe_1\|seriousTotal=0\|PR7_AXE_PASS' PR7-UX.md RECEIPTS.md 2>/dev/null \
    || grep -q '0 serious' PR7-UX.md
}

prod_pr8_ops() {
  [ -s RUNBOOKS.md ]
  grep -qE 'env|reproduc|SBOM|SLO|monitor' RUNBOOKS.md
}

prod_pr_docs_dual() {
  # dual-state acceptance wording intact
  rg -n 'execution 14/14|acceptance 0/6|acceptance stays 0' README.md PROGRESS_MANIFEST.md TODO.md | head -2 | grep -q .
}

prod_secrets_and_lint() {
  secret_scan && typecheck_clean
}

prod_build_dist() {
  build_artifacts
  # public entry has no privy/convex/midnight in forbidden way — reuse boundary test
  bun test apps/web/src/demo-boundary.test.tsx >/tmp/gate-db.out 2>&1
  f=$(grep -oE '^ *[0-9]+ fail' /tmp/gate-db.out | tail -1 | grep -oE '[0-9]+' || echo 0)
  echo boundary-fail=$f
  [ "$f" -eq 0 ]
}

prod_security() {
  security_modules
  bun test convex/http.test.ts convex/settlement.test.ts >/tmp/gate-sec.out 2>&1 || true
  f=$(grep -oE '^ *[0-9]+ fail' /tmp/gate-sec.out | tail -1 | grep -oE '[0-9]+' || echo 0)
  echo sec-fail=$f
  [ "$f" -eq 0 ]
}

prod_owner_queue() {
  # OWNER-QUEUE lists remaining owner items (substance: file non-empty with rows)
  [ -s OWNER-QUEUE.md ]
  rows=$(grep -c '^|' OWNER-QUEUE.md || echo 0)
  echo owner-rows=$rows
  [ "$rows" -ge 3 ]
}


# --- Phase 0.1 hard substance (E2E 3x, Preprod real fees, observer) ---
e2e01_three_passes() {
  # E2E-01 must have 3 consecutive passing runs in receipts, not a scaffold
  [ -f audit/discovery/E2E-01-three-pass.md ] || { echo "missing E2E-01-three-pass.md"; return 1; }
  grep -q 'consecutivePasses: 3\|3/3\|three consecutive' audit/discovery/E2E-01-three-pass.md
  # and a receipt that is not not-done
  if grep -q 'd3dMarkedDone: false\|"done": false\|status: not-done' audit/discovery/E2E-01-three-pass.md; then
    echo "E2E-01 still not-done"; return 1
  fi
  echo e2e01-three-pass-ok
}

preprod_real_fee_table() {
  # Preprod happy path with real fees: 4 circuit tx hashes + indexer read-back
  [ -f audit/discovery/D2c-preprod-fee-math-attempt.md ] || { echo "missing D2c attempt"; return 1; }
  if grep -q 'NOT LANDED\|could not balance dust\|DUST=0' audit/discovery/D2c-preprod-fee-math-attempt.md RECEIPTS.md 2>/dev/null; then
    echo "preprod happy path not landed"; return 1
  fi
  # require 4 Preprod-looking hashes in a D2c table
  n=$(grep -cE '0x[0-9a-f]{64}|[0-9a-f]{64}' audit/discovery/D2c-preprod-happy-path.md 2>/dev/null || echo 0)
  echo preprod-hashes=$n
  [ "$n" -ge 4 ]
}

observer_service_tests() {
  # U6 observer service must exist and have tests
  [ -f packages/integration/src/observer-service.mjs ] || [ -f packages/integration/src/observer.mjs ] \
    || { echo "no observer service module"; return 1; }
  ls packages/integration/test/*observer* >/dev/null 2>&1 || { echo "no observer tests"; return 1; }
  bun test packages/integration/test/*observer* >/tmp/gate-obs.out 2>&1
  f=$(grep -oE '^ *[0-9]+ fail' /tmp/gate-obs.out | tail -1 | grep -oE '[0-9]+' || echo 1)
  echo observer-fail=$f
  [ "$f" -eq 0 ]
}

demo_e2e_chain() {
  # demo stage requires a complete real-system deal: E2E-01 3x OR documented Preprod 4/4
  e2e01_three_passes || preprod_real_fee_table
}

mvp_browser_matrix() {
  # mvp requires browser journeys, not just chain-layer
  [ -f audit/discovery/M3-e2e-matrix.md ] || return 1
  grep -q 'UI cells.*PASS\|journeys PASS [1-9]' audit/discovery/M3-e2e-matrix.md || {
    echo "M3 UI cells not PASS"; return 1
  }
}

mvp_observer() {
  observer_service_tests
}

prod_release_substance() {
  preprod_real_fee_table && observer_service_tests
}

case "$STAGE" in
  prototype)
    check P1_ledger 'ledger_script'
    check P2_typecheck 'typecheck_clean'
    check P2_lint 'lint_no_errors'
    check P2_build 'build_artifacts'
    check P2_unit 'unit_counts'
    check P3_contract 'contract_lines && contract_hash'
    check P4_security 'security_modules'
    check P6_secrets 'secret_scan'
    ;;
  demo)
    check D1_local_happy 'demo_local_happy'
    check D2_contract_14 'demo_contract_14'
    check D3_webhook_neg 'demo_webhook_negatives'
    check D4_spends 'demo_spends'
    check D5_clickmap 'demo_clickmap'
    check D6_sdk_not_prod 'demo_sdk_not_prod'
    check D7_copy_no_livepay 'demo_copy_no_livepay'
    check D8_evidence_ids 'demo_evidence_ids'
    check D9_e2e_or_preprod 'demo_e2e_chain'
    ;;
  mvp)
    check M1_unit 'unit_counts'
    check M2_typecheck 'typecheck_clean'
    check M3_integration 'mvp_integration'
    check M4_stripe_window 'mvp_m4_stripe_window'
    check M5_upload 'mvp_m5_upload'
    check M6_recovery 'mvp_m6_recovery'
    check M7_auth 'mvp_todo_m'
    check M8_neg_modules 'mvp_mut_neg'
    check M9_privacy 'mvp_m9_privacy'
    check M10_coverage 'mvp_coverage'
    check M11_indep 'mvp_m11_indep'
    check M12_docs_orders 'mvp_m12_docs && mvp_orders_obs'
    check M13_browser 'mvp_browser_matrix'
    check M14_observer 'mvp_observer'
    ;;
  production)
    check PR1_build 'build_artifacts && prod_build_dist && prod_release_substance'
    check PR2_auth 'prod_pr2_auth'
    check PR3_security 'prod_security'
    check PR4_livegate 'prod_pr5_livegate'
    check PR5_privacy 'prod_pr6_privacy'
    check PR6_axe 'prod_pr7_axe'
    check PR7_ops 'prod_pr8_ops'
    check PR8_dualstate 'prod_pr_docs_dual'
    check PR9_secrets_owner 'prod_secrets_and_lint && prod_owner_queue'
    ;;
  *)
    echo "unknown stage: $STAGE" >&2
    exit 2
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
  # R1: only prototype may be tagged until R2 re-audits higher stages.
  # R1/M13: prototype always; mvp once M2/M3/R6/R8 evidence is in tree.
  # Phase 0: only prototype may be tagged until E2E/Preprod/observer exist.
  if [ "$STAGE" = "prototype" ]; then
    git tag -f "stage/${STAGE}-${HEAD:0:7}" 2>/dev/null || true
  else
    echo "TAG_SUPPRESSED stage=$STAGE (needs E2E 3x + Preprod real fees + observer)"
  fi
  exit 0
else
  echo "STAGE_AT_HEAD=NONE"
  exit 1
fi
