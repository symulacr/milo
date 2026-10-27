#!/usr/bin/env bash
# post-push-verify.sh — the ship gate. Run it before every push.
#
# Three things make it fast enough to run on every save:
#   1. The long pole (`unit`, ~11 s) runs first and alone; the four cheap
#      checks then overlap. Running all five at once made four route-heading
#      tests flake under CPU contention, so the bound is deliberate.
#   2. A content hash of the files the checks read is compared with the last
#      green run; an unchanged tree returns the cached verdict in ~0.1 s.
#   3. `verify-readme` is not run separately: it is step J3 inside
#      `judging-minimum`, so the standalone call was 2-3 s of pure duplication.
#
# What is deliberately NOT here: `g4-negative-controls.sh` (~50 s, builds git
# worktrees and mutates modules) and `net-health.sh` (~12 s, network). Both are
# release checks, not per-save checks. Run them before a release:
#   bash scripts/g4-negative-controls.sh && bash scripts/net-health.sh
#
# Usage: bash scripts/post-push-verify.sh [--force] [--no-cache] [--quiet] [--release] [--backup] [--ci]
#   --force     ignore the cache and run every step
#   --no-cache  run everything and do not write a cache entry
#   --quiet     only print the summary
#   --release   also run the two slow release checks
#   --ci        mirror .github/workflows/local-checks.yml in its order, with the
#               deployment environment cleared, so a green run here means a green
#               run there. Use this before pushing, not just before deploying.
#   --backup    export the production database to a local zip, then exit.
#               Needs MILO_BACKUP_CONFIRM=1 (see the block below). Never uploads.
#
# Restore drill (dev only, DESTRUCTIVE on the target deployment):
#   npx convex export --dev --path /tmp/drill.zip
#   npx convex import /tmp/drill.zip --replace     # never with --prod
#   npx convex run diagnostics:counts              # verify, then record elapsed
set -uo pipefail
cd "$(dirname "$0")/.."

FORCE=0
NOCACHE=0
QUIET=0
RELEASE=0
BACKUP=0
CI=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --no-cache) NOCACHE=1 ;;
    --quiet) QUIET=1 ;;
    --release) RELEASE=1 ;;
    --backup) BACKUP=1 ;;
    --ci) CI=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

# ---- production backup ----------------------------------------------------
# Convex Free/Starter has no automatic backup: only a manual one that expires
# in 7 days (docs.convex.dev/database/backup-restore). So the weekly job is a
# local export. It is deliberately NOT automatic and NOT uploaded: a database
# dump leaving the machine is a data-processing decision, not a cron detail.
# `--replace` on import is destructive, so the export requires an explicit
# confirmation rather than running because someone typed `--backup`.
if [ "$BACKUP" -eq 1 ]; then
  if [ "${MILO_BACKUP_CONFIRM:-0}" != "1" ]; then
    echo "Refusing to export production without confirmation." >&2
    echo "This writes a full database dump to local disk. Run:" >&2
    echo "  MILO_BACKUP_CONFIRM=1 bash scripts/post-push-verify.sh --backup" >&2
    exit 2
  fi
  BACKUP_DIR="${MILO_BACKUP_DIR:-$HOME/milo-backups}"
  mkdir -p "$BACKUP_DIR"
  TARGET="$BACKUP_DIR/milo-$(date -u +%Y%m%dT%H%M%SZ).zip"
  echo "=== backup: $TARGET ==="
  npx convex export --prod --include-file-storage --path "$TARGET"
  code=$?
  if [ "$code" -ne 0 ]; then
    echo "backup FAILED (exit $code); nothing was written" >&2
    exit "$code"
  fi
  echo "backup ok: $(du -h "$TARGET" | cut -f1) at $TARGET"
  echo "restore drill (dev only): see the header of this script"
  exit 0
fi

CACHE_DIR="${TMPDIR:-/tmp}/milo-ship-cache"
mkdir -p "$CACHE_DIR"
LOG_DIR="$CACHE_DIR/logs"
rm -rf "$LOG_DIR"; mkdir -p "$LOG_DIR"

say() { [ "$QUIET" -eq 1 ] || echo "$@"; }

# ---- content key: a hash of the files the checks read ---------------------
# `git status` is wrong here: in a worktree git does not track, every file
# collapses to one `??` line, so an edit never changes the key and a broken
# tree gets served a stale green. Hash the contents instead.
content_key() {
  {
    find apps/web/src apps/web/*.html convex packages scripts -type f \
      \( -name '*.ts' -o -name '*.tsx' -o -name '*.html' -o -name '*.json' \
         -o -name '*.css' -o -name '*.sh' \) \
      -not -path '*/node_modules/*' -not -path '*/_generated/*' \
      -not -path '*/generated/*' -not -path '*/dist/*' 2>/dev/null \
      | LC_ALL=C sort | xargs -r sha256sum 2>/dev/null
    sha256sum package.json bun.lock tsconfig.json 2>/dev/null
  } | sha256sum | cut -c1-16
}

KEY=$(content_key)
STAMP="$CACHE_DIR/$KEY.ok"

if [ "$FORCE" -eq 0 ] && [ -f "$STAMP" ]; then
  say "=== ship: unchanged tree ($KEY), all checks passed last time ==="
  say "    run with --force to re-run, --no-cache to skip caching"
  cat "$STAMP"
  exit 0
fi

say "=== ship: key $KEY ==="
START=$(date +%s%N)

# Each check runs in its own subshell; the parent records the exit code and log.
run() {
  local name=$1; shift
  local log="$LOG_DIR/$name.log"
  ( "$@" > "$log" 2>&1; echo $? > "$log.code" ) &
}

say "--- starting checks"
# `--ci` mirrors .github/workflows/local-checks.yml in its order, with the
# deployment environment cleared. That is the point: Bun auto-loads `.env.local`,
# so a plain local build reads 21 variables CI does not have, and the two builds
# diverge silently. Clearing them here reproduces CI's inputs.
if [ "$CI" -eq 1 ]; then
  say "--- ci mode: clearing deployment env so this matches the workflow"
  # Bun auto-loads `.env.local` from the working directory for every child, so
  # `unset` alone is not enough — the build would read the values again.
  # `--no-env-file` is the documented switch that disables it (measured: with it,
  # a probe var in .env.local is unset; BUN_ENV_FILE and moving HOME are not).
  # Every gate below therefore goes through `bun --no-env-file`.
  BUN_NOENV="--no-env-file"
  # Also unset in this shell so any non-Bun step sees the CI shape too.
  unset BETTER_AUTH_URL CONVEX_URL CONVEX_SITE_URL SITE_URL MIDNIGHT_NETWORK \
        STRIPE_PUBLISHABLE_KEY STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET \
        MAIL_PROVIDER MAIL_FROM RESEND_API_KEY AGENTMAIL_API_KEY BREVO_API_KEY \
        MILO_OPERATOR_EMAILS MILO_TRUSTED_PROVISIONING_AUTHORITIES \
        PROVER_SERVER_URI CONVEX_DEPLOY_KEY CONVEX_DEPLOYMENT
  export BUN_NOENV
  run cohort sh scripts/with-bun.sh $BUN_NOENV scripts/verify-compact-cohort.ts
  wait
  run plan sh scripts/with-bun.sh $BUN_NOENV scripts/check-plan.ts
  run biome sh scripts/with-bun.sh $BUN_NOENV node_modules/@biomejs/biome/bin/biome check .
  run strict sh scripts/with-bun.sh $BUN_NOENV node_modules/typescript/bin/tsc --noEmit --noUnusedLocals --noUnusedParameters
  wait
  run unit sh scripts/with-bun.sh $BUN_NOENV test --parallel apps/web packages/domain packages/contract packages/backend packages/midnight-client convex e2e scripts/*.test.ts
  wait
  run integration sh scripts/with-bun.sh $BUN_NOENV scripts/test-integration.ts
  run build sh scripts/with-bun.sh $BUN_NOENV scripts/build.ts
  wait
  say "--- checks finished"
  failed=0
  total=0
  for name in cohort plan biome strict unit integration build; do
    code=$(cat "$LOG_DIR/$name.log.code" 2>/dev/null || echo 1)
    total=$((total + 1))
    if [ "$code" -eq 0 ]; then say "PASS $name"; else
      say "FAIL $name  (log: $LOG_DIR/$name.log)"; failed=$((failed + 1)); fi
  done
  say "=== ci: $((total - failed))/$total passed ==="
  [ "$failed" -eq 0 ]
  exit $?
fi

# `unit` is the long pole (~11 s) and the only suite with timing-sensitive
# tests, so it runs alone in the first wave; the four cheap checks overlap in
# the second. Running all five at once made four route-heading tests flake.
run unit sh scripts/with-bun.sh test --parallel apps/web packages/domain packages/contract packages/backend packages/midnight-client convex e2e scripts/*.test.ts
wait
run biome sh scripts/with-bun.sh node_modules/@biomejs/biome/bin/biome check apps/web convex packages scripts
run strict sh scripts/with-bun.sh node_modules/typescript/bin/tsc --noEmit --noUnusedLocals --noUnusedParameters
run build sh scripts/with-bun.sh scripts/build.ts
run judging bash scripts/judging-minimum.sh
if [ "$RELEASE" -eq 1 ]; then
  run g4 bash scripts/g4-negative-controls.sh
  run net bash scripts/net-health.sh
fi
wait

say "--- checks finished"

# ---- summary --------------------------------------------------------------
failed=0
total=0
names="biome strict unit build judging"
[ "$RELEASE" -eq 1 ] && names="$names g4 net"
for name in $names; do
  code=$(cat "$LOG_DIR/$name.log.code" 2>/dev/null || echo 1)
  total=$((total + 1))
  if [ "$code" -eq 0 ]; then
    say "PASS $name"
  else
    say "FAIL $name  (log: $LOG_DIR/$name.log)"
    failed=$((failed + 1))
  fi
done

END=$(date +%s%N)
ELAPSED=$(echo "scale=1; ($END-$START)/1000000000" | bc)

if [ "$failed" -eq 0 ] && [ "$NOCACHE" -eq 0 ]; then
  {
    echo "key $KEY"
    echo "elapsed ${ELAPSED}s"
    date -u +"at %Y-%m-%dT%H:%M:%SZ"
  } > "$STAMP"
fi

say "=== ship: $((total - failed))/$total passed in ${ELAPSED}s ==="
[ "$failed" -eq 0 ]
