#!/usr/bin/env python3
"""Copy this repository's toolkit to scripts/worktree/* without overwriting files."""
import hashlib
import json
import sys
from pathlib import Path

source = Path(__file__).resolve().parent
if len(sys.argv) != 2:
    raise SystemExit("Usage: python3 install.py /path/to/your/repository")
target = Path(sys.argv[1]).resolve(strict=True)
if not target.is_dir():
    raise SystemExit("Target must be an existing directory")
manifest = json.loads((source / "manifest.json").read_text())
items = []
for name, item in manifest["files"].items():
    rel = Path(item["path"])
    if rel.is_absolute() or ".." in rel.parts or rel.parts[0] != "scripts":
        raise SystemExit(f"Invalid destination: {rel}")
    data = (source / item["path"]).read_bytes()
    if hashlib.sha256(data).hexdigest() != item["sha256"]:
        raise SystemExit(f"Checksum mismatch: {name}")
    dest = target / rel
    for part in [dest, *dest.parents]:
        if part == target:
            break
        if part.is_symlink():
            raise SystemExit(f"Refusing symlink: {part}")
    if dest.exists():
        raise SystemExit(f"Refusing to overwrite: {dest}")
    items.append((dest, data))
for dest, data in items:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open("xb") as handle:
        handle.write(data)
print(f"Installed {len(items)} source files. Adapt the configuration and package scripts before setup.")
