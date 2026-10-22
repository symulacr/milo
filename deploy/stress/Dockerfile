# Stress-run image for Midnight Preprod.
#
# The lane refuses a non-loopback proof server: `preprodConfig` asserts
# isLoopbackHostname, because the proof server receives the full serialized
# witness in the POST body. So the prover must run inside this container, next to
# the wallet. That is what sets the floor at 4 GB: the published sizing is two
# proving workers = 4 GB, and one worker is the minimum that can prove at all.
#
# IMPORTANT: this image cannot be built from a plain git clone. Three inputs are
# gitignored, because they are large binaries or generated artifacts:
#
#   .tools/native-midnight/prover   the proof server binary
#   .tools/native-midnight/params   the public proving parameters (33 MB)
#   packages/contract/generated     the compiled contract and its ZK keys (47 MB)
#
# So the build context must be a working tree that has been provisioned, not a
# fresh checkout. The build below fails with a named error if any is missing
# rather than producing an image that starts and then cannot prove.
#
# Build from the repository root:
#   docker build -f deploy/stress/Dockerfile -t milo-stress .

FROM node:24-bookworm-slim

# The proof server binary is a Nix-built ELF. Its interpreter path points at
# /nix/store/..., which does not exist in this image, so it is invoked through the
# system loader. curl is for the health check; ca-certificates is for Blockfrost.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependency layer first, so a source change does not reinstall 362 MB of modules.
COPY package.json bun.lock* ./
COPY packages/integration/package.json packages/integration/package-lock.json ./packages/integration/
RUN npm ci --prefix packages/integration --ignore-scripts --no-audit --no-fund

COPY . .

# The prover and its public parameters. Both are large and both are required: the
# server downloads nothing at runtime beyond what MIDNIGHT_PP points at.
COPY .tools/native-midnight/prover ./tools/prover
COPY .tools/native-midnight/params ./tools/params

# Fail here, not at proof time. Each of these is gitignored, so a build context
# taken from a fresh clone reaches this check with nothing to copy. The check runs
# AFTER the copies above: a guard placed before them tests the wrong thing and
# fails on a tree that is actually complete.
RUN set -eu; \
    for required in \
      /app/tools/prover/midnight-proof-server \
      /app/tools/params \
      /app/packages/contract/generated/contract \
    ; do \
      if [ ! -e "$required" ]; then \
        echo "missing build input: $required" >&2; \
        echo "this image needs a provisioned working tree, not a fresh clone (see the header)" >&2; \
        exit 1; \
      fi; \
    done

ENV MIDNIGHT_PP=/app/tools/params
ENV MIDNIGHT_PROOF_SERVER_NUM_WORKERS=1
# Cap V8's heap so a runaway run fails with a clear OutOfMemory instead of being
# killed by the platform with no log line.
ENV NODE_OPTIONS=--max-old-space-size=2048

COPY deploy/stress/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
