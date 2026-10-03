#!/usr/bin/env bash
# G0 self-tests: each mutated input must FAIL the corresponding gate check.
if [ -d "${HOME:-}/.bun/bin" ]; then PATH="${HOME}/.bun/bin:$PATH"; fi
export PATH
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 1
TMP="${TMPDIR:-/tmp}"
fail=0
note() { echo "$1"; }

mutate_and_expect_fail() {
  local label="$1" stage="$2" setup="$3" teardown="$4"
  eval "$setup"
  if bash scripts/gates/gate.sh "$stage" >"$TMP/gate-mut-$label.out" 2>&1; then
    note "SELF-FAIL $label: mutated $stage gate did not fail"
    fail=1
  else
    note "SELF-OK $label: mutated $stage gate failed as required"
  fi
  eval "$teardown"
}

# --- prototype mutations ---
mutate_and_expect_fail contract_hash prototype \
  'cp packages/contract/src/order.compact $TMP/oc.bak; echo "// mutant" >> packages/contract/src/order.compact' \
  'mv $TMP/oc.bak packages/contract/src/order.compact'

mutate_and_expect_fail unit_break prototype \
  'cat > packages/domain/tests/_gate_selftest.test.ts <<EOF
import { describe, expect, test } from "bun:test";
describe("gate selftest mutant", () => { test("must fail", () => { expect(1).toBe(2); }); });
EOF' \
  'rm -f packages/domain/tests/_gate_selftest.test.ts'

mutate_and_expect_fail secret_scan prototype \
  'echo "const k = \"sk_test_abcdefghijklmnopqrstuvwxyz0123456789\";" > packages/backend/src/_gate_secret.ts' \
  'rm -f packages/backend/src/_gate_secret.ts'

mutate_and_expect_fail contract_lines prototype \
  'cp packages/contract/src/order.compact $TMP/oc2.bak; echo >> packages/contract/src/order.compact; echo >> packages/contract/src/order.compact' \
  'mv $TMP/oc2.bak packages/contract/src/order.compact'

# --- demo mutations ---
mutate_and_expect_fail demo_receipts demo \
  'cp RECEIPTS-LOCAL.md $TMP/rl.bak; sed -i "s/obs_d2a_local_happy_complete_1/MUTANT/" RECEIPTS-LOCAL.md' \
  'mv $TMP/rl.bak RECEIPTS-LOCAL.md'

mutate_and_expect_fail demo_livepay demo \
  'echo "We accept live payments today." >> apps/web/src/shells/PublicShell.tsx' \
  'git checkout -- apps/web/src/shells/PublicShell.tsx'

mutate_and_expect_fail demo_clickmap demo \
  'cp CLICK-MAP.md $TMP/cm.bak; echo "no routes" > CLICK-MAP.md' \
  'mv $TMP/cm.bak CLICK-MAP.md 2>/dev/null || git checkout -- CLICK-MAP.md'

# --- mvp mutations ---
mutate_and_expect_fail mvp_auth mvp \
  'cp packages/backend/test/auth-inventory.test.ts $TMP/ai.bak; echo "test(\"mut\", () => { expect(1).toBe(2); });" >> packages/backend/test/auth-inventory.test.ts' \
  'mv $TMP/ai.bak packages/backend/test/auth-inventory.test.ts'

mutate_and_expect_fail mvp_orders mvp \
  'cp convex/orders.ts $TMP/ord.bak; python3 -c "from pathlib import Path;p=Path(\"convex/orders.ts\");p.write_text(p.read_text().replace(\"export const recordObservation\",\"export const recordObservationDisabled\"))"' \
  'mv $TMP/ord.bak convex/orders.ts'

# --- production mutations ---
mutate_and_expect_fail prod_boundary production \
  'cp apps/web/src/demo-boundary.test.tsx $TMP/db.bak; echo "test(\"mut\", () => { expect(1).toBe(2); });" >> apps/web/src/demo-boundary.test.tsx' \
  'mv $TMP/db.bak apps/web/src/demo-boundary.test.tsx'

mutate_and_expect_fail prod_livegate production \
  'echo "export const PAYMENTS_LIVE = true;" >> packages/backend/src/release-flags.mjs' \
  'git checkout -- packages/backend/src/release-flags.mjs 2>/dev/null || true'

# clean prototype must still pass (stage recompute floor)
if bash scripts/gates/gate.sh prototype >"$TMP/gate-clean.out" 2>&1; then
  note "SELF-OK clean tree prototype"
else
  note "SELF-FAIL clean tree not prototype"
  fail=1
fi

echo "SELFTEST_EXIT=$fail"
exit $fail
