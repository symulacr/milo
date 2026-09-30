#!/usr/bin/env bash
# net-health.sh — DNS/HTTP probes before network-dependent tasks.
set -u
echo "=== getent ==="
for h in indexer.preprod.midnight.network registry.npmjs.org api.stripe.com github.com tremendous-rooster-473.convex.cloud; do
  getent hosts "$h" 2>/dev/null | head -1 || echo "FAIL getent $h"
done
echo "=== curl ==="
for u in \
  "https://registry.npmjs.org/" \
  "https://api.stripe.com/" \
  "https://github.com/" \
  "https://tremendous-rooster-473.convex.cloud/"
 do
  code=$(curl -sS -m 10 -o /dev/null -w '%{http_code}' "$u" 2>/dev/null || echo "ERR")
  echo "$code $u"
done
echo "=== local indexer ==="
curl -sS -m 5 -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8088/api/v4/graphql || echo local-indexer-fail
echo "=== env proxy ==="
env | grep -iE '^(http|https|all|no)_proxy=' || echo no-proxy-env
echo "=== windows dns ==="
if command -v curl.exe >/dev/null 2>&1; then
  curl.exe -sS -m 5 -o NUL -w '%{http_code}\n' https://registry.npmjs.org/ 2>/dev/null || echo curl.exe-fail
fi
echo NET_HEALTH_DONE
