#!/usr/bin/env bash
# Round-trip every .ui under a directory through the real Designer engine (no edit),
# then compare the uic output of original vs saved. Usage: roundtrip.sh <dir> <workdir>
Q=/home/devel/Qt/6.12.0/gcc_64
export LD_LIBRARY_PATH=$Q/lib QT_QPA_PLATFORM=offscreen QT_PLUGIN_PATH=$Q/plugins POC_RESIZE=1 POC_NOOP=1
# Normalise only: include-guard names (temp file names) and enum qualification (X::Enum::V == X::V).
norm() { grep -v '^\*\* Form generated\|^\*\* Created\|^#ifndef\|^#define\|^#endif' | sed -E 's/::[A-Za-z]+::([A-Za-z0-9_]+)/::\1/g'; }
BIN="$(dirname "$0")/../build/poc"
pass=0; same=0; diffc=0; loadfail=0; uicfail=0
mkdir -p "$2"
while IFS= read -r f; do
  n=$(echo "$f" | md5sum | cut -c1-8)
  if ! timeout 60 "$BIN" "$f" "$2/$n.png" "$2/$n.ui" >"$2/$n.log" 2>&1; then echo "LOADFAIL $f"; loadfail=$((loadfail+1)); continue; fi
  $Q/libexec/uic "$f" 2>/dev/null | norm > "$2/$n.a.h" || { echo "ORIG-UICFAIL $f"; continue; }
  if ! $Q/libexec/uic "$2/$n.ui" 2>/dev/null | norm > "$2/$n.b.h"; then echo "SAVED-UICFAIL $f"; uicfail=$((uicfail+1)); continue; fi
  pass=$((pass+1))
  if diff -q "$2/$n.a.h" "$2/$n.b.h" >/dev/null; then same=$((same+1)); else diffc=$((diffc+1)); echo "DIFF $f ($n)"; fi
done < <(find "$1" -name '*.ui' | sort)
echo "processed=$pass identical_uic=$same different_uic=$diffc loadfail=$loadfail uicfail=$uicfail"
