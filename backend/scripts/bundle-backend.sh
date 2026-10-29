#!/usr/bin/env bash
# Builds a self-contained backend folder: the executable, the Qt libraries it needs and the Qt plugins it loads.
# Usage: bundle-backend.sh <output dir>   (Qt: QT_ROOT, default ~/Qt/6.11.3/gcc_64)
set -euo pipefail
OUT="${1:?output directory}"
QT="${QT_ROOT:-$HOME/Qt/6.11.3/gcc_64}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$HERE/build-relocatable"
cmake -S "$HERE" -B "$BUILD" -G Ninja -DCMAKE_PREFIX_PATH="$QT" -DQDR_RELOCATABLE=ON -DQDR_TEST_PLUGIN=OFF >/dev/null
cmake --build "$BUILD" --target designer_backend >/dev/null
mkdir -p "$OUT/lib" "$OUT/plugins"
cp "$BUILD/designer_backend" "$OUT/"
copy_deps() { LD_LIBRARY_PATH="$QT/lib" ldd "$1" | awk '/=> \// {print $3}' | grep -E "$QT/lib/|libicu" | while read -r lib; do cp --update=none -L "$lib" "$OUT/lib/"; done; }
copy_deps "$OUT/designer_backend"
for plugin in platforms/libqoffscreen.so imageformats styles iconengines platformthemes; do
    [ -e "$QT/plugins/$plugin" ] || continue
    mkdir -p "$OUT/plugins/$(dirname "$plugin")"
    cp -rL "$QT/plugins/$plugin" "$OUT/plugins/$(dirname "$plugin")/"
done
# plugins have their own Qt dependencies
find "$OUT/plugins" -name '*.so' | while read -r so; do copy_deps "$so"; done
echo "bundled into $OUT: $(du -sh "$OUT" | cut -f1)"
