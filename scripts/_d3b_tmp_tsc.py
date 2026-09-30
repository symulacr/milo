import json, os, subprocess
root = "/home/eya/milo/milo-main"
os.chdir(root)
# project typecheck, filter to our files
p = subprocess.run(
    ["sh", "scripts/with-bun.sh", "node_modules/typescript/bin/tsc", "--noEmit"],
    capture_output=True,
    text=True,
)
out = (p.stdout or "") + (p.stderr or "")
for line in out.splitlines():
    if "privy-test-login" in line:
        print("OURS", line)
print("TOTAL_LINES", len(out.splitlines()))
print("EXIT", p.returncode)
# show first 15 non-empty for context
shown = 0
for line in out.splitlines():
    if line.strip():
        print("CTX", line[:200])
        shown += 1
        if shown >= 15:
            break
