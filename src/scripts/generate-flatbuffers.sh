#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$ROOT/src/core/flatbuffer"
FLATC="${FLATC:-flatc}"

if ! command -v "$FLATC" >/dev/null 2>&1; then
  echo "error: flatc not found; set FLATC=/path/to/flatc" >&2
  exit 1
fi

FLATC_VERSION="$("$FLATC" --version 2>&1)"
echo "Using $FLATC_VERSION"

if [[ ! "$FLATC_VERSION" =~ version[[:space:]]25\. ]]; then
  echo "error: expected flatc 25.x; got: $FLATC_VERSION" >&2
  exit 1
fi

RUNTIME_PKG="$ROOT/node_modules/flatbuffers/package.json"

if [[ ! -f "$RUNTIME_PKG" ]]; then
  echo "error: flatbuffers runtime missing; install root dependencies first" >&2
  exit 1
fi

RUNTIME_VERSION="$(
  python3 - "$RUNTIME_PKG" <<'PY'
import json
import sys
from pathlib import Path

print(json.loads(Path(sys.argv[1]).read_text())["version"])
PY
)"

echo "Resolved flatbuffers runtime: $RUNTIME_VERSION"

if [[ ! "$RUNTIME_VERSION" =~ ^25\. ]]; then
  echo "error: expected flatbuffers runtime 25.x; got: $RUNTIME_VERSION" >&2
  exit 1
fi

# Create temporary output under the same filesystem as the canonical tree.
TMP="$(mktemp -d "$OUT/.zene-generation.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

"$FLATC" --ts -o "$TMP" "$OUT/manifest.fbs"
"$FLATC" --ts -o "$TMP" "$OUT/integrity.fbs"

ZENE_TMP="$TMP/zene"

if [[ ! -d "$ZENE_TMP" ]]; then
  echo "error: flatc did not generate $ZENE_TMP" >&2
  exit 1
fi

# Validate expected files, schema-derived methods, and nullable priority
# before replacing the existing canonical tree.
python3 - "$ZENE_TMP" <<'PY'
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])

required_files = [
    "system/zene-manifest.ts",
    "system/file-entry.ts",
    "system/integrity-payload.ts",
    "system/node-dependency.ts",
    "system.ts",
    "integrity/manifest.ts",
    "integrity/file-entry.ts",
    "integrity.ts",
]

missing_files = [name for name in required_files if not (root / name).is_file()]
if missing_files:
    raise SystemExit("Missing generated files: " + ", ".join(missing_files))

manifest_path = root / "system/zene-manifest.ts"
text = manifest_path.read_text(encoding="utf-8")

required_api = [
    "signedPayload(",
    "addSignedPayload(",
    "metadataVersion(",
    "addMetadataVersion(",
    "canonicalizationVersion(",
    "addCanonicalizationVersion(",
    "addZeneVersion(",
    "addPriority(",
]

missing_api = [name for name in required_api if name not in text]
if missing_api:
    raise SystemExit("Missing generated API: " + ", ".join(missing_api))

if not re.search(r"priority\(\)\s*:\s*number\s*\|\s*null", text):
    raise SystemExit(
        "priority() is not nullable. Check that manifest.fbs declares "
        "'priority: int = null;'"
    )

# The nullable default must cause explicit zero to be serialized.
if not re.search(
    r"addFieldInt32\(10,\s*priority,\s*null\)",
    text,
):
    raise SystemExit(
        "addPriority does not use null as its default; explicit-zero "
        "presence is not verified."
    )

# Strip only standalone obsolete eslint-disable lines from generated files.
directive = re.compile(r"^\s*/\*\s*eslint-disable\b.*\*/\s*$")
cleaned = 0

for path in sorted(root.rglob("*.ts")):
    original = path.read_text(encoding="utf-8")
    lines = original.splitlines()
    filtered = [line for line in lines if not directive.match(line)]
    result = "\n".join(filtered).lstrip("\n") + "\n"

    if result != original:
        path.write_text(result, encoding="utf-8")
        cleaned += 1

print(f"Generated API validated; cleaned {cleaned} eslint-disable directives.")
PY

BACKUP="$TMP/zene.previous"

# Keep the old tree recoverable until the new tree has been installed.
if [[ -e "$OUT/zene" ]]; then
  mv "$OUT/zene" "$BACKUP"
fi

if ! mv "$ZENE_TMP" "$OUT/zene"; then
  if [[ -e "$BACKUP" ]]; then
    mv "$BACKUP" "$OUT/zene"
  fi
  echo "error: could not install generated zene bindings; previous tree restored" >&2
  exit 1
fi

rm -rf "$BACKUP"

echo "Generated canonical bindings at $OUT/zene"
find "$OUT/zene" -type f -print | sort
