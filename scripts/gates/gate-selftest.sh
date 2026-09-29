#!/usr/bin/env bash
# G0 self-tests: mutated input must FAIL the corresponding check.
export PATH="/home/eya/.bun/bin:/usr/bin:/bin:$PATH"
set -uo pipefail
ROOT=/home/eya/milo/milo-main
cd "$ROOT"
fail=0
note() { echo "$1"; }

# mutate contract hash
cp packages/contract/src/order.compact /tmp/oc.bak
echo "// mutant" >> packages/contract/src/order.compact
if bash scripts/gates/gate.sh prototype >/tmp/gate-mut-contract.out 2>&1; then
  note "SELF-FAIL contract mutation did not fail gate"
  fail=1
else
  note "SELF-OK contract mutation failed gate as required"
fi
mv /tmp/oc.bak packages/contract/src/order.compact

# mutate unit: break a test assertion temporarily via a throwaway test file
cat > packages/domain/tests/_gate_selftest.test.ts <<'EOF'
import { describe, expect, test } from "bun:test";
describe("gate selftest mutant", () => {
  test("must fail", () => { expect(1).toBe(2); });
});
EOF
if bash scripts/gates/gate.sh prototype >/tmp/gate-mut-unit.out 2>&1; then
  note "SELF-FAIL unit mutation did not fail gate"
  fail=1
else
  note "SELF-OK unit mutation failed gate as required"
fi
rm -f packages/domain/tests/_gate_selftest.test.ts

# secret scan mutant
echo 'const k = "sk_test_abcdefghijklmnopqrstuvwxyz0123456789";' > packages/backend/src/_gate_secret.ts
if bash scripts/gates/gate.sh prototype >/tmp/gate-mut-sec.out 2>&1; then
  note "SELF-FAIL secret mutation did not fail gate"
  fail=1
else
  note "SELF-OK secret mutation failed gate as required"
fi
rm -f packages/backend/src/_gate_secret.ts

# restore clean gate
bash scripts/gates/gate.sh prototype >/tmp/gate-clean.out 2>&1
if grep -q 'STAGE_AT_HEAD=prototype' /tmp/gate-clean.out; then
  note "SELF-OK clean tree still prototype"
else
  note "SELF-FAIL clean tree not prototype"
  fail=1
fi

echo "SELFTEST_EXIT=$fail"
exit $fail
