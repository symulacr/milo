#!/usr/bin/env sh
set -eu

if [ ! -x .tools/bun/node_modules/.bin/bun ] || [ "$(.tools/bun/node_modules/.bin/bun --version)" != "1.4.2" ]; then
  sh scripts/setup.sh
fi

exec .tools/bun/node_modules/.bin/bun "$@"
