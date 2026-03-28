#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out_path="${1:-}"
build_dir="$repo_dir/.tonic/build"
log_file="$(mktemp)"

if [[ -z "$out_path" ]]; then
  echo "Usage: scripts/build-release.sh <output-path>" >&2
  exit 1
fi

cleanup() {
  rm -f "$log_file"
}
trap cleanup EXIT

mkdir -p "$(dirname "$out_path")"

if tonic compile "$repo_dir" --out "$out_path" >"$log_file" 2>&1; then
  cat "$log_file"
  chmod +x "$out_path"
  printf 'built release binary: %s\n' "$out_path"
  exit 0
fi

cat "$log_file" >&2

if ! grep -q 'tn_runtime_length' "$log_file" || ! grep -q 'tn_runtime_elem' "$log_file"; then
  echo "error: tonic compile failed for an unsupported reason" >&2
  exit 1
fi

if [[ ! -f "$build_dir/main.c" ]]; then
  echo "error: tonic compile failed before generating $build_dir/main.c" >&2
  exit 1
fi

# TONIC_MISSING workaround: current tonic native compile output may omit
# tn_runtime_length/tn_runtime_elem helpers needed by generated Enum code.
python3 - "$build_dir/main.c" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
marker = "static TnVal tn_runtime_length(TnVal value) {"
if marker in text:
    raise SystemExit(0)
needle = "static TnVal tn_runtime_guard_is_nil(TnVal value) {\n  TnObj *obj = tn_get_obj(value);\n  return (obj != NULL && obj->kind == TN_OBJ_NIL) ? 1 : 0;\n}\n"
shim = needle + "\nstatic TnVal tn_runtime_length(TnVal value) {\n  TnObj *obj = tn_get_obj(value);\n  if (obj == NULL) {\n    return (TnVal)0LL;\n  }\n  switch (obj->kind) {\n    case TN_OBJ_LIST:\n    case TN_OBJ_KEYWORD:\n      return (TnVal)obj->as.list.len;\n    case TN_OBJ_TUPLE:\n      return (TnVal)2LL;\n    case TN_OBJ_MAP:\n      return (TnVal)obj->as.map_like.len;\n    default:\n      return (TnVal)0LL;\n  }\n}\n\nstatic TnVal tn_runtime_elem(TnVal value, TnVal index) {\n  TnObj *obj = tn_get_obj(value);\n  if (obj == NULL) {\n    return tn_runtime_const_nil();\n  }\n  switch (obj->kind) {\n    case TN_OBJ_TUPLE:\n      if (index == (TnVal)0LL) {\n        return obj->as.tuple.left;\n      }\n      if (index == (TnVal)1LL) {\n        return obj->as.tuple.right;\n      }\n      return tn_runtime_const_nil();\n    case TN_OBJ_LIST:\n    case TN_OBJ_KEYWORD:\n      if (index < (TnVal)0LL) {\n        return tn_runtime_const_nil();\n      }\n      if ((size_t)index >= obj->as.list.len) {\n        return tn_runtime_const_nil();\n      }\n      return obj->as.list.items[index];\n    default:\n      return tn_runtime_const_nil();\n  }\n}\n"
if needle not in text:
    raise SystemExit("failed to find runtime nil guard anchor in generated C")
path.write_text(text.replace(needle, shim, 1))
PY

${CC:-cc} -O2 "$build_dir/main.c" -o "$out_path"
chmod +x "$out_path"
printf 'built release binary with runtime shim fallback: %s\n' "$out_path"
