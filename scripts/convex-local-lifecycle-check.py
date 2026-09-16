"""Explicit Linux-only native harness lifecycle check; not part of unit tests."""

import json
from pathlib import Path
import signal
import subprocess
import time

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / ".tools/convex-local"
BINARY = TOOLS / "home/.cache/convex/binaries/precompiled-2026-08-25-7cce8fb/convex-local-backend"
LOCK = TOOLS / "running.lock"
COMMAND = ["node", "scripts/convex-local-verify.mjs"]


def processes():
    result = {}
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            fields = (entry / "stat").read_text().rsplit(")", 1)[1].split()
            command = (entry / "cmdline").read_bytes().split(b"\0")
            if fields[0] != "Z":
                result[int(entry.name)] = (int(fields[1]), int(fields[2]), command)
        except (FileNotFoundError, ProcessLookupError):
            pass
    return result


def interrupt(signum, phase):
    groups = set()
    inherited_groups = set()
    metadata = {"phase": phase, "signal": signum}
    with (TOOLS / f"lifecycle-{phase}.log").open("w") as log:
        child = subprocess.Popen(COMMAND, cwd=ROOT, stdout=log, stderr=log)
        try:
            deadline = time.monotonic() + 120
            while time.monotonic() < deadline:
                assert child.poll() is None, f"Harness exited before {phase} interruption"
                tree = processes()
                direct = {pid: row for pid, row in tree.items() if row[0] == child.pid}
                # /proc can see a fork before detached spawn calls setsid().
                groups.update(pid for pid, row in direct.items() if pid == row[1])
                inherited_groups.update(row[1] for pid, row in direct.items() if pid != row[1])
                native = [(pid, row) for pid, row in tree.items() if row[2] and row[2][0] == str(BINARY).encode()]
                if phase == "cli":
                    ready = any(row[0] in direct and row[1] in groups for _, row in native)
                else:
                    ready = any(row[0] == child.pid and row[1] in groups for _, row in native)
                if ready:
                    child.send_signal(signum)
                    break
                time.sleep(0.02)
            else:
                raise AssertionError(f"Never reached {phase} interruption point")
            assert child.wait(timeout=20) == 128 + signum
            assert not LOCK.exists(), "Interrupted run left its lock"
            # SIGKILL delivery and /proc removal can lag the harness's exit.
            deadline = time.monotonic() + 2
            while True:
                survivors = [
                    {"pid": pid, "ppid": row[0], "pgrp": row[1]}
                    for pid, row in processes().items() if row[1] in groups
                ]
                if not survivors or time.monotonic() >= deadline:
                    break
                time.sleep(0.02)
            metadata.update({"harnessPid": child.pid, "ownedGroups": sorted(groups),
                             "ignoredInheritedGroups": sorted(inherited_groups),
                             "survivors": survivors})
            assert groups, "No detached group observed at interruption"
            assert not survivors, f"Owned process survived: {survivors}"
        finally:
            (TOOLS / f"lifecycle-{phase}-processes.json").write_text(json.dumps(metadata, indent=2) + "\n")
            if child.poll() is None:
                child.send_signal(signal.SIGTERM)
                child.wait(timeout=20)


def main():
    assert not LOCK.exists(), "Another native verification owns this workspace"
    TOOLS.mkdir(parents=True, exist_ok=True)
    sentinel = subprocess.Popen(["sleep", "300"], start_new_session=True)
    backup = BINARY.with_suffix(".lifecycle-backup")
    assert not backup.exists(), "Previous lifecycle backup needs inspection"
    original = BINARY.exists()
    try:
        if original:
            BINARY.rename(backup)
        BINARY.parent.mkdir(parents=True, exist_ok=True)
        marker = TOOLS / "unverified-binary-executed"
        marker.unlink(missing_ok=True)
        BINARY.write_text(f"#!/bin/sh\ntouch '{marker}'\nexit 1\n")
        BINARY.chmod(0o700)
        rejected = subprocess.run(COMMAND, cwd=ROOT, capture_output=True, timeout=30)
        assert rejected.returncode != 0
        assert b"Official native backend artifact changed" in rejected.stderr
        assert not marker.exists(), "Unverified binary executed"
        assert not LOCK.exists()
        BINARY.unlink()
        # Empty cache forces the official download/extraction/checksum path.
        interrupt(signal.SIGINT, "cli")
        interrupt(signal.SIGTERM, "backend")
        assert sentinel.poll() is None, "Unowned process was terminated"
        with (TOOLS / "lifecycle-retry.log").open("w") as log:
            subprocess.run(COMMAND, cwd=ROOT, stdout=log, stderr=log, check=True, timeout=180)
        assert not LOCK.exists()
        report = json.loads((TOOLS / "verification.json").read_text())
        assert report["nativeRestartPreservedCanonicalBinding"]
        assert sentinel.poll() is None
        print("PASS: checksum before execution, fresh download, SIGINT CLI cleanup, SIGTERM backend cleanup, unowned process preserved, full retry")
    finally:
        if backup.exists():
            backup.replace(BINARY)
        sentinel.terminate()
        sentinel.wait(timeout=5)


if __name__ == "__main__":
    main()
