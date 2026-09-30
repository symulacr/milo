#!/usr/bin/env bash
# G0 self-tests: each mutated input must FAIL the corresponding gate check.
export PATH="/home/eya/.bun/bin:/usr/bin:/bin:$PATH"
set -uo pipefail
ROOT=/home/eya/milo/milo-main
cd "$ROOT"
fail=0
note() { echo "$1"; }

mutate_and_expect_fail() {
  local label="$1" stage="$2" setup="$3" teardown="$4"
  eval "$setup"
  if bash scripts/gates/gate.sh "$stage" >/tmp/gate-mut-$label.out 2>&1; then
    note "SELF-FAIL $label: mutated $stage gate did not fail"
    fail=1
  else
    note "SELF-OK $label: mutated $stage gate failed as required"
  fi
  eval "$teardown"
}

# --- prototype mutations ---
mutate_and_expect_fail contract_hash prototype \
  'cp packages/contract/src/order.compact /tmp/oc.bak; echo "// mutant" >> packages/contract/src/order.compact' \
  'mv /tmp/oc.bak packages/contract/src/order.compact'

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
  'cp packages/contract/src/order.compact /tmp/oc2.bak; echo >> packages/contract/src/order.compact; echo >> packages/contract/src/order.compact' \
  'mv /tmp/oc2.bak packages/contract/src/order.compact'

# --- demo mutations ---
mutate_and_expect_fail demo_receipts demo \
  'cp RECEIPTS-LOCAL.md /tmp/rl.bak; sed -i "s/obs_d2a_local_happy_complete_1/MUTANT/" RECEIPTS-LOCAL.md' \
  'mv /tmp/rl.bak RECEIPTS-LOCAL.md'

mutate_and_expect_fail demo_livepay demo \
  'echo "We accept live payments today." >> apps/web/src/shells/PublicShell.tsx' \
  'git checkout -- apps/web/src/shells/PublicShell.tsx'

mutate_and_expect_fail demo_clickmap demo \
  'cp CLICK-MAP.md /tmp/cm.bak; echo "no routes" > CLICK-MAP.md' \
  'mv /tmp/cm.bak CLICK-MAP.md 2>/dev/null || git checkout -- CLICK-MAP.md'

# --- mvp mutations ---
mutate_and_expect_fail mvp_auth mvp \
  'cp packages/backend/test/auth-inventory.test.ts /tmp/ai.bak; echo "test(\"mut\", () => { expect(1).toBe(2); });" >> packages/backend/test/auth-inventory.test.ts' \
  'mv /tmp/ai.bak packages/backend/test/auth-inventory.test.ts'

mutate_and_expect_fail mvp_orders mvp \
  'cp convex/orders.ts /tmp/ord.bak; python3 -c "from pathlib import Path;p=Path(\"convex/orders.ts\");p.write_text(p.read_text().replace(\"export const recordObservation\",\"export const recordObservationDisabled\"))"' \
  'mv /tmp/ord.bak convex/orders.ts'

# --- production mutations ---
mutate_and_expect_fail prod_boundary production \
  'cp apps/web/src/demo-boundary.test.tsx /tmp/db.bak; echo "test(\"mut\", () => { expect(1).toBe(2); });" >> apps/web/src/demo-boundary.test.tsx' \
  'mv /tmp/db.bak apps/web/src/demo-boundary.test.tsx'

mutate_and_expect_fail prod_livegate production \
  'echo "export const PAYMENTS_LIVE = true;" >> packages/backend/src/release-flags.mjs' \
  'git checkout -- packages/backend/src/release-flags.mjs 2>/dev/null || true'

# clean prototype must still pass (stage recompute floor)
if bash scripts/gates/gate.sh prototype >/tmp/gate-clean.out 2>&1; then
  note "SELF-OK clean tree prototype"
else
  note "SELF-FAIL clean tree not prototype"
  fail=1
fi

echo "SELFTEST_EXIT=$fail"
exit $fail
