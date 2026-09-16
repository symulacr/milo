from pathlib import Path
from zipfile import ZipFile

with ZipFile(".tools/compact-downloads/compiler.zip") as archive:
    for name in ("compactc", "compactc.bin", "fixup-compact", "format-compact", "zkir", "zkir-v3"):
        target = Path(".tools/compact/compiler") / name
        target.write_bytes(archive.read(name))
        target.chmod(0o755)
