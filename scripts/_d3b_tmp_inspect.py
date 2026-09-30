import json, os, re, base64, urllib.request

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
pkg = json.load(open(os.path.join(root, "package.json")))
print("SCRIPTS", list(pkg.get("scripts", {}).keys()))

env = {}
for line in open(os.path.join(root, ".env.local")):
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    env[k.strip()] = v.strip()
app_id = env.get("PRIVY_APP_ID", "")
secret = env.get("PRIVY_APP_SECRET", "")
print("APP_ID", app_id)
print("SECRET_LEN", len(secret))

auth = base64.b64encode(f"{app_id}:{secret}".encode()).decode()
headers = {
    "Authorization": f"Basic {auth}",
    "privy-app-id": app_id,
    "Content-Type": "application/json",
    "Accept": "application/json",
    "User-Agent": "milo-d3b-research/1.0",
}
url = f"https://api.privy.io/v1/apps/{app_id}/test_credentials"
req = urllib.request.Request(url, headers=headers, method="GET")
with urllib.request.urlopen(req, timeout=25) as r:
    raw = r.read()
    print("TC_STATUS", r.status)
    print("TC_CT", r.headers.get("content-type"))
    print("TC_LEN", len(raw))
    print("TC_RAW", repr(raw[:800]))
    if raw:
        try:
            print("TC_JSON", json.loads(raw.decode()))
        except Exception as e:
            print("TC_JSON_ERR", e)

url2 = f"https://api.privy.io/v1/apps/{app_id}"
req2 = urllib.request.Request(url2, headers=headers, method="GET")
with urllib.request.urlopen(req2, timeout=25) as r:
    app = json.loads(r.read().decode())
    for k in ("allowed_domains", "email_auth", "sms_auth", "guest_auth"):
        print("APP", k, app.get(k))
