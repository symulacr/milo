#!/usr/bin/env sh
set -eu

if [ "$(uname -s):$(uname -m)" != "Linux:x86_64" ]; then
  printf '%s\n' 'The verified Compact bootstrap currently supports Linux x86_64 only.' >&2
  exit 1
fi

mkdir -p .tools/compact-downloads .tools/compact/compiler .tools/compact/devtools

download() {
  url="$1"
  target="$2"
  digest="$3"
  if [ ! -f "$target" ]; then
    curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error "$url" -o "$target.part"
    printf '%s  %s\n' "$digest" "$target.part" | sha256sum -c -
    mv "$target.part" "$target"
  fi
  printf '%s  %s\n' "$digest" "$target" | sha256sum -c -
}

download \
  'https://github.com/LFDT-Minokawa/compact/releases/download/compactc-v0.31.1/compactc_v0.31.1_x86_64-unknown-linux-musl.zip' \
  .tools/compact-downloads/compiler.zip \
  e291b4bab4d4e857707008f8b1c25c2b8e0c843f6c737d0ee6c0d9ac69a6bbfb
download \
  'https://github.com/midnightntwrk/compact/releases/download/compact-v0.5.1/compact-x86_64-unknown-linux-musl.tar.xz' \
  .tools/compact-downloads/devtools.tar.xz \
  684c6b3d2eef9484aabba7a0820c166ae5c169f3aecf28cbea2074840263ba66

python3 scripts/extract-compact.py
tar -xJf .tools/compact-downloads/devtools.tar.xz \
  --strip-components=1 -C .tools/compact/devtools \
  compact-x86_64-unknown-linux-musl/compact

.tools/compact/devtools/compact --version
test "$(.tools/compact/compiler/compactc --version)" = '0.31.1'
