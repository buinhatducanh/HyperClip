#!/bin/bash
cd d:/LOOP_COMPANY/HyperClip

ts=$(date +%Y%m%d-%H%M%S)
patchName="HyperClip-Patch-$ts"
dir="release/$patchName"

rm -rf "$dir" 2>/dev/null
mkdir -p "$dir/app/_internal/resources"

cp target/release/hyperclip-launcher.exe "$dir/HyperClip.exe"
cp build/dist/hyperclip-bundle/HyperClip.exe "$dir/app/"
cp build/dist/hyperclip-bundle/_internal/hyperclip-tauri.exe "$dir/app/_internal/"
cp build/dist/hyperclip-bundle/_internal/base_library.zip "$dir/app/_internal/"
cp -r build/dist/hyperclip-bundle/_internal/qml "$dir/app/_internal/"
cp crates/hyperclip_ipc/src/innertube_helper.js "$dir/app/_internal/resources/"
[ -f bg.jpg ] && cp bg.jpg "$dir/"

head=$(git rev-parse --short HEAD)
gdate=$(git log -1 --pretty=%ai)
branch=$(git branch --show-current)
cat > "$dir/patch-version.json" << ENDJSON
{"patchBuiltAt":"$(date -Iseconds)","gitHead":"$head","gitDate":"$gdate","gitBranch":"$branch"}
ENDJSON

# compress
tar -a -cf "$dir.zip" -C "$dir" .
rm -rf "$dir"

echo "=== Done ==="
echo "ZIP: $(ls -lh "$dir.zip" | awk '{print $NF, $5}')"
