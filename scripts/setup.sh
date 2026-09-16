#!/usr/bin/env sh
set -eu

BUN_VERSION="1.4.2"
BUN_BIN=".tools/bun/node_modules/.bin/bun"

if [ ! -x "$BUN_BIN" ] || [ "$("$BUN_BIN" --version)" != "$BUN_VERSION" ]; then
  rm -rf .tools/bun
  # DEBT-073: persist package.json/package-lock.json so npm pins and verifies
  # sha512 integrity for the bun tarball and its platform packages.
  npm install --prefix .tools/bun "bun@$BUN_VERSION"
fi

if [ -f bun.lock ]; then
  "$BUN_BIN" install --frozen-lockfile
else
  "$BUN_BIN" install
fi

sh scripts/setup-compact.sh
