"""Check the export can be installed intact without overwriting existing tooling."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

source = Path(__file__).resolve().parents[1]
manifest = json.loads((source / "manifest.json").read_text())

def install(target):
    return subprocess.run(
        [sys.executable, str(source / "install.py"), str(target)],
        capture_output=True, text=True,
    )

with tempfile.TemporaryDirectory(prefix="convex-worktrees-install-") as temp:
    target = Path(temp) / "app"
    target.mkdir()
    result = install(target)
    assert result.returncode == 0, result.stderr
    for item in manifest["files"].values():
        data = (target / item["path"]).read_bytes()
        assert hashlib.sha256(data).hexdigest() == item["sha256"], item["path"]
    result = install(target)
    assert result.returncode != 0 and "Refusing to overwrite" in result.stderr
    outside = Path(temp) / "outside"
    outside.mkdir()
    linked = Path(temp) / "linked-app"
    linked.mkdir()
    (linked / "scripts").symlink_to(outside, target_is_directory=True)
    result = install(linked)
    assert result.returncode != 0 and "Refusing symlink" in result.stderr
    assert not list(outside.iterdir()), "Installer wrote through a symlink"

print("Installer: source hashes, restored layout, overwrite refusal and symlink refusal passed.")
