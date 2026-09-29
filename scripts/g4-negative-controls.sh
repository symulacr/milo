#!/usr/bin/env bash
# G4: negative controls + independent verifier signatures for 7 security modules.
# Each mapped test must PASS on real code and FAIL on a deliberate mutation
# applied in a git worktree OUTSIDE the workspace, then that worktree is removed
# by exact path. No test suppressions.
export PATH="/home/eya/.bun/bin:/usr/bin:/bin:$PATH"
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
WT_BASE="/home/eya/g4-mut-worktrees"
LOG_DIR="${G4_LOG_DIR:-/home/eya/milo/audit/discovery/_g4_logs}"
mkdir -p "$LOG_DIR" "$WT_BASE"

HEAD=$(git rev-parse HEAD)
echo "G4_HEAD=$HEAD"
echo "G4_ROOT=$ROOT"
echo "G4_WT_BASE=$WT_BASE"
echo "G4_LOG_DIR=$LOG_DIR"

# Independent verifier signatures (sha256 of module bytes; verifier is this
# script's sha256sum pass, not the test runner).
echo ""
echo "=== E-SIG-01 independent verifier signatures ==="
SIG_FILE="$LOG_DIR/module-signatures.txt"
: > "$SIG_FILE"
signed=0
modules=(
  "convex/http.ts"
  "convex/settlement.ts"
  "convex/files.ts"
  "convex/observationIngest.ts"
  "packages/backend/src/release-flags.mjs"
  "packages/domain/src/recovery-kit.ts"
  "packages/backend/src/delivery-commitment.mjs"
)
for m in "${modules[@]}"; do
  if [ ! -s "$m" ]; then
    echo "MISSING $m"
    continue
  fi
  h=$(sha256sum "$m" | awk '{print $1}')
  sz=$(wc -c < "$m")
  echo "$m | sha256=$h | bytes=$sz"
  echo "$m $h $sz" >> "$SIG_FILE"
  signed=$((signed+1))
done
echo "modules-signed $signed of 7"
echo "sig_file=$SIG_FILE"

# --- mutation helpers ---
apply_mutation() {
  local slug="$1" wt="$2"
  python3 - "$slug" "$wt" <<'PY'
import sys, re
from pathlib import Path
slug, wt = sys.argv[1], sys.argv[2]
root = Path(wt)

def sub(path: Path, old: str, new: str, label: str):
    t = path.read_text()
    if old not in t:
        print(f"MUTATION_MISS {label} {path}")
        sys.exit(2)
    path.write_text(t.replace(old, new, 1))
    print(f"MUTATION_OK {label}")

if slug == "http":
    p = root / "convex/http.ts"
    t = p.read_text()
    t2, n = re.subn(
        r"export function bodyTooLarge\([^)]*\)[^{]*\{",
        "export function bodyTooLarge(_body: unknown, _cap?: number): boolean {\n  return false;\n  //",
        t, count=1)
    if n != 1:
        print("MUTATION_MISS http"); sys.exit(2)
    p.write_text(t2); print("MUTATION_OK http bodyTooLarge->false")
elif slug == "settlement":
    sub(root / "convex/settlement.ts",
        'if (action === "capture") return phase === "APPROVED";\n  if (action === "void") return phase === "CANCELLED";\n  return false;',
        'return true; // G4 mutation: authorize every action/phase',
        "settlementAuthorized->true")
elif slug == "files":
    sub(root / "convex/files.ts",
        '''  if (
    membership.role !== "merchant" ||
    membership.accountId !== order.merchantId ||
    membership.accountId !== grant.uploaderId
  )
    throw new Error("upload grant is unavailable");''',
        '  // G4 mutation: membership gate removed',
        "files membership-gate removed")
elif slug == "observationIngest":
    sub(root / "convex/observationIngest.ts",
        "    if (a[key] !== b[key]) return false;",
        "    if (a[key] !== b[key]) return true; // G4 mutation",
        "observationIngest sameDeploymentRecord invert")
elif slug == "release-flags":
    sub(root / "packages/backend/src/release-flags.mjs",
        """export const RELEASE_FLAG_DEFAULTS = Object.freeze({
  immutableOrderAdmission: false,
  r1Complete: false,
});""",
        """export const RELEASE_FLAG_DEFAULTS = Object.freeze({
  immutableOrderAdmission: true,
  r1Complete: true,
}); // G4 mutation""",
        "release-flags defaults->true")
elif slug == "recovery-kit":
    sub(root / "packages/domain/src/recovery-kit.ts",
        """  return {
    ...copy(kit),
    pending: null,
    usable: false,
    requiresReconciliation: true,
  };""",
        """  return {
    ...copy(kit),
    pending: null,
    usable: false,
    requiresReconciliation: false, // G4 mutation
  };""",
        "recovery-kit abandonOperation reconciliation->false")
elif slug == "delivery-commitment":
    sub(root / "packages/backend/src/delivery-commitment.mjs",
        '.join("");',
        '.slice().reverse().join(""); // G4 mutation: order-insensitive',
        "delivery-commitment reverse-join")
else:
    print("UNKNOWN_SLUG", slug); sys.exit(2)
PY
}

# slug | module | test path (relative to ROOT)
# Each test is expected to PASS on real code and FAIL under the mutation.
entries=(
  "http|convex/http.ts|convex/http.test.ts"
  "settlement|convex/settlement.ts|convex/settlement.test.ts"
  "files|convex/files.ts|convex/files.test.ts"
  "observationIngest|convex/observationIngest.ts|convex/observationIngest.test.ts"
  "release-flags|packages/backend/src/release-flags.mjs|packages/backend/test/release-flags.test.ts"
  "recovery-kit|packages/domain/src/recovery-kit.ts|apps/web/src/recovery-runtime.test.ts"
  "delivery-commitment|packages/backend/src/delivery-commitment.mjs|packages/backend/test/delivery-integrity.test.ts"
)

nc_pass=0
echo ""
echo "=== E-NC-01 negative controls (worktree outside workspace) ==="
for entry in "${entries[@]}"; do
  IFS='|' read -r slug mod testpath <<< "$entry"
  WT="$WT_BASE/g4-mut-$slug"
  echo ""
  echo "--- NC $slug | $mod | $testpath ---"
  # 1) real code must PASS
  set +e
  sh scripts/with-bun.sh test "$testpath" >"$LOG_DIR/real-$slug.out" 2>&1
  real_rc=$?
  set -e
  real_line=$(grep -E '^ *[0-9]+ pass' "$LOG_DIR/real-$slug.out" | tail -1 | sed 's/^ *//')
  echo "REAL rc=$real_rc $real_line"
  if [ "$real_rc" -ne 0 ]; then
    echo "NC_FAIL $slug real-code test did not pass"
    tail -15 "$LOG_DIR/real-$slug.out"
    continue
  fi

  # 2) mutation worktree OUTSIDE workspace
  rm -rf "$WT"
  git worktree prune
  git worktree add --detach "$WT" HEAD >"$LOG_DIR/wt-add-$slug.out" 2>&1
  ln -s "$ROOT/node_modules" "$WT/node_modules"
  ln -s "$ROOT/.tools" "$WT/.tools"
  if [ -d "$ROOT/packages/contract/generated" ]; then
    mkdir -p "$WT/packages/contract"
    ln -s "$ROOT/packages/contract/generated" "$WT/packages/contract/generated"
  fi

  set +e
  apply_mutation "$slug" "$WT" >"$LOG_DIR/mutate-$slug.out" 2>&1
  mut_rc=$?
  set -e
  cat "$LOG_DIR/mutate-$slug.out"
  if [ "$mut_rc" -ne 0 ]; then
    echo "NC_FAIL $slug mutation not applied"
    git worktree remove --force "$WT" || true
    rm -rf "$WT"
    continue
  fi

  # 3) same test must FAIL on mutated code
  set +e
  (cd "$WT" && sh scripts/with-bun.sh test "$testpath") >"$LOG_DIR/mut-$slug.out" 2>&1
  mut_test_rc=$?
  set -e
  mut_line=$(grep -E '^ *[0-9]+ (pass|fail)' "$LOG_DIR/mut-$slug.out" | tail -2 | tr '\n' ' ')
  echo "MUT rc=$mut_test_rc $mut_line"
  if [ "$mut_test_rc" -eq 0 ]; then
    echo "NC_FAIL $slug mutated test still passed (no negative control)"
    tail -15 "$LOG_DIR/mut-$slug.out"
    git worktree remove --force "$WT" || true
    rm -rf "$WT"
    continue
  fi

  # 4) remove worktree by exact path
  git worktree remove --force "$WT"
  rm -rf "$WT"
  if [ -e "$WT" ]; then
    echo "NC_FAIL $slug worktree path still exists: $WT"
    continue
  fi
  echo "NC_OK $slug worktree_removed=$WT"
  nc_pass=$((nc_pass+1))
done

echo ""
echo "=== E-NC-02 summary ==="
echo "tests-with-negative-control $nc_pass of 7"
echo "modules-signed $signed of 7"
git worktree list
echo "leftover_worktrees_under=$(ls -d "$WT_BASE"/g4-mut-* 2>/dev/null | wc -l)"