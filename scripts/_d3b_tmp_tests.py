import json, os
root = "/home/eya/milo/milo-main"
pkg = json.load(open(os.path.join(root, "package.json")))
print(json.dumps(pkg.get("scripts", {}), indent=2))
print("TEST_REFS")
for dirpath, dirs, files in os.walk(root):
    dirs[:] = [d for d in dirs if d not in ("node_modules", "dist", ".git", ".tools")]
    for f in files:
        if f.endswith((".test.ts", ".test.tsx", ".test.mjs")):
            print(os.path.relpath(os.path.join(dirpath, f), root))
