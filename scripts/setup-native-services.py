#!/usr/bin/env python3
"""Extract two pinned public OCI executables without a container runtime."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import tarfile
import tempfile
import urllib.error
import urllib.parse
import urllib.request


ROOT = Path(__file__).resolve().parent.parent / ".tools" / "native-midnight"
CHUNK = 1024 * 1024
INDEXER_CONFIG = {
    "url": "https://raw.githubusercontent.com/midnightntwrk/midnight-indexer/a89e1d3b3d8daf73a0e7beed9839ee70188e92c4/indexer-standalone/config.yaml",
    "sha256": "474cba116a5001910583abe335d9b603843ca85e47a4f2480106b2e6fc535493",
    "size": 2162,
}
SERVICES = {
    "indexer": {
        "image": "indexer-standalone",
        "manifest": "03afd079b00bcd229df29a24771439c5e7695c339cd89216d0763ce40731cc4b",
        "platform": "07de7d3b615a95cf0fa693557d69446cb4fce0d52dc6d2182d719b20a61c478e",
        "layer": "95524495474f7b663e0e464245c6afdfdae4c1a43ef1af9c353fc8b2f8feaba4",
        "layer_size": 24576976,
        "member": "usr/local/bin/indexer-standalone",
        "binary": "79744f23e9f58b6562131c07d938c17cfff0856c8f476745b820a57cf8892fb5",
        "binary_size": 82917264,
    },
    "prover": {
        "image": "proof-server",
        "manifest": "801bbc0340e9e96f16735f77b523f23c7459e3359842f7c79c2c53f4e994d531",
        "platform": "829d02876b346fe773d3d17419a38aadb9fafc6653603afbb3f16672bc122bd4",
        "layer": "ab2ba8217f6bfb8aeefd3777c7016bde036f31a92784fa23a0cc4ca833d68f0a",
        "layer_size": 26728867,
        "member": "nix/store/6naj0x3l5n0b4cx722xwasyp597p6z3h-ledger-8.1.0/bin/midnight-proof-server",
        "binary": "0e7c638afff563a382316bb06cf31e4afe327e0ada9fd8f2e9b1ef5b73171e03",
        "binary_size": 23986080,
    },
}


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urllib.parse.urlparse(newurl).scheme != "https":
            raise ValueError("refusing non-HTTPS redirect")
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if redirected and urllib.parse.urlparse(req.full_url).netloc != urllib.parse.urlparse(newurl).netloc:
            redirected.remove_header("Authorization")
        return redirected


HTTP = urllib.request.build_opener(SafeRedirect())


def directory(path):
    if path.is_symlink():
        raise ValueError(f"refusing symlink directory: {path.name}")
    if not path.exists():
        directory(path.parent)
        path.mkdir(mode=0o700, exist_ok=True)
    if not path.is_dir():
        raise ValueError(f"not a directory: {path.name}")


def regular_or_missing(path):
    try:
        mode = path.lstat().st_mode
    except FileNotFoundError:
        return False
    if not stat.S_ISREG(mode):
        raise ValueError(f"refusing non-regular file: {path.name}")
    return True


def verified(path, digest, size):
    if not regular_or_missing(path):
        return False
    if path.stat().st_size != size:
        return False
    hasher = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(CHUNK):
            hasher.update(chunk)
    return hasher.hexdigest() == digest


def small_response(url, headers=None):
    with HTTP.open(urllib.request.Request(url, headers=headers or {}), timeout=60) as response:
        data = response.read(2 * CHUNK + 1)
    if len(data) > 2 * CHUNK:
        raise ValueError("oversized registry metadata")
    return data


def registry_auth(service):
    query = urllib.parse.urlencode({
        "service": "registry.docker.io",
        "scope": f"repository:midnightntwrk/{service['image']}:pull",
    })
    token = json.loads(small_response(f"https://auth.docker.io/token?{query}"))["token"]
    return {"Authorization": f"Bearer {token}"}


def verify_manifests(service, headers):
    headers = {**headers, "Accept": ",".join([
        "application/vnd.oci.image.index.v1+json",
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.docker.distribution.manifest.list.v2+json",
        "application/vnd.docker.distribution.manifest.v2+json",
    ])}
    base = f"https://registry-1.docker.io/v2/midnightntwrk/{service['image']}"
    documents = []
    for digest in (service["manifest"], service["platform"]):
        data = small_response(f"{base}/manifests/sha256:{digest}", headers)
        if hashlib.sha256(data).hexdigest() != digest:
            raise ValueError("registry manifest checksum mismatch")
        documents.append(json.loads(data))
    if not any(
        item["digest"] == f"sha256:{service['platform']}"
        and item.get("platform", {}).get("architecture") == "amd64"
        and item.get("platform", {}).get("os") == "linux"
        for item in documents[0]["manifests"]
    ):
        raise ValueError("pinned Linux amd64 manifest not found")
    if not any(
        item["digest"] == f"sha256:{service['layer']}"
        and item["size"] == service["layer_size"]
        for item in documents[1]["layers"]
    ):
        raise ValueError("pinned executable layer not found")


def download(service, archive):
    if verified(archive, service["layer"], service["layer_size"]):
        return
    headers = registry_auth(service)
    verify_manifests(service, headers)
    url = f"https://registry-1.docker.io/v2/midnightntwrk/{service['image']}/blobs/sha256:{service['layer']}"
    download_file(url, archive, service["layer"], service["layer_size"], headers)


def download_file(url, destination, digest, expected_size, headers=None):
    if verified(destination, digest, expected_size):
        return
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as output:
            temporary = Path(output.name)
            size = 0
            hasher = hashlib.sha256()
            with HTTP.open(urllib.request.Request(url, headers=headers or {}), timeout=60) as response:
                while chunk := response.read(CHUNK):
                    size += len(chunk)
                    if size > expected_size:
                        raise ValueError("download exceeds pinned size")
                    output.write(chunk)
                    hasher.update(chunk)
        if size != expected_size or hasher.hexdigest() != digest:
            raise ValueError("download checksum or size mismatch")
        os.replace(temporary, destination)
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)


def extract(service, archive, destination):
    if verified(destination, service["binary"], service["binary_size"]):
        destination.chmod(0o700)
        return
    temporary = None
    found = False
    try:
        with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as output:
            temporary = Path(output.name)
            with tarfile.open(archive, "r|gz") as members:
                for member in members:
                    if member.name != service["member"]:
                        continue
                    if found or not member.isfile() or member.size != service["binary_size"]:
                        raise ValueError("unexpected executable archive member")
                    found = True
                    hasher = hashlib.sha256()
                    size = 0
                    with members.extractfile(member) as source:
                        while chunk := source.read(CHUNK):
                            size += len(chunk)
                            output.write(chunk)
                            hasher.update(chunk)
                    if size != service["binary_size"] or hasher.hexdigest() != service["binary"]:
                        raise ValueError("executable checksum or size mismatch")
        if not found:
            raise ValueError("pinned executable missing from layer")
        temporary.chmod(0o700)
        os.replace(temporary, destination)
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--service", choices=["all", *SERVICES], default="all")
    args = parser.parse_args()
    if os.uname().sysname != "Linux" or os.uname().machine != "x86_64":
        parser.error("these executable pins are for Linux x86_64 only")
    # Check each owned path component, including an already-existing tools directory.
    for path in (ROOT.parent, ROOT, ROOT / "downloads"):
        directory(path)
    for name, service in SERVICES.items():
        if args.service not in ("all", name):
            continue
        directory(ROOT / name)
        archive = ROOT / "downloads" / f"{name}-{service['layer']}.tar.gz"
        destination = ROOT / name / Path(service["member"]).name
        download(service, archive)
        extract(service, archive, destination)
        if name == "indexer":
            config = ROOT / name / "config.yaml"
            download_file(INDEXER_CONFIG["url"], config, INDEXER_CONFIG["sha256"], INDEXER_CONFIG["size"])
            print(f"Verified indexer config SHA256 {INDEXER_CONFIG['sha256']}")
        print(f"Verified {name}: {destination.relative_to(ROOT.parent.parent)}")
        print(f"SHA256 {service['binary']}; no service started")


if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as error:
        raise SystemExit(f"Public registry request failed (HTTP {error.code}); no credentials logged") from None
    except urllib.error.URLError:
        raise SystemExit("Public registry connection failed; no credentials logged") from None
    except (OSError, ValueError, KeyError, tarfile.TarError) as error:
        raise SystemExit(f"Native executable setup failed: {type(error).__name__}") from None
