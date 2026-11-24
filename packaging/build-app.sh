#!/bin/bash
set -euo pipefail

if [ "$#" -ne 2 ] || [ "$(uname -s)-$(uname -m)" != 'Darwin-arm64' ]; then
    echo 'Usage on Apple Silicon macOS: packaging/build-app.sh <runtime-resources-dir> <output-dir>' >&2
    exit 2
fi

project=$(cd "$(dirname "$0")/.." && pwd -P)
runtime=$(cd "$1" && pwd -P)
mkdir -p "$2"
destination=$(cd "$2" && pwd -P)
manifest="$project/packaging/runtime-assets.sha256"
verify_runtime() {
    local dir="$1"
    (cd "$dir" && grep -v 'libonnxruntime' "$manifest" | shasum -a 256 -c -)
    test -f "$dir/models/libonnxruntime.1.32.0.dylib"
    if ! (cd "$dir" && grep 'libonnxruntime' "$manifest" | shasum -a 256 -c - >/dev/null 2>&1); then
        codesign --verify --strict "$dir/models/libonnxruntime.1.32.0.dylib"
    fi
}
verify_runtime "$runtime"

version=$(/usr/bin/plutil -extract CFBundleShortVersionString raw "$project/packaging/Info.plist")
build=$(/usr/bin/plutil -extract CFBundleVersion raw "$project/packaging/Info.plist")
archive="PDF-Translator-${version}-build${build}-macos-arm64.zip"
if [ -e "$destination/$archive" ] || [ -e "$destination/$archive.sha256" ]; then
    echo "The output already exists in $destination." >&2
    exit 1
fi

scratch=$(mktemp -d "$destination/.pdf-translator.XXXXXXXX")
trap 'rm -rf -- "$scratch"' EXIT
app="$scratch/PDF Translator.app"
resources="$app/Contents/Resources"
mkdir -p "$app/Contents/MacOS" "$resources/licenses"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$project/target}"
mkdir -p "$CARGO_TARGET_DIR"
CARGO_TARGET_DIR=$(cd "$CARGO_TARGET_DIR" && pwd -P)
cargo_cache=${CARGO_HOME:-"$HOME/.cargo"}
separator=$'\037'
remaps="--remap-path-prefix=$project=/pdf-translator"
remaps+="$separator--remap-path-prefix=$cargo_cache=/cargo"
remaps+="$separator--remap-path-prefix=$CARGO_TARGET_DIR=/target"

if [ -x "$project/zotero-plugin/build.sh" ]; then
    "$project/zotero-plugin/build.sh"
fi

CARGO_ENCODED_RUSTFLAGS="$remaps" CARGO_PROFILE_RELEASE_STRIP=none MACOSX_DEPLOYMENT_TARGET=14.0 \
    cargo build --manifest-path "$project/Cargo.toml" --release --locked
install -m 755 "$CARGO_TARGET_DIR/release/hermeneuein" "$app/Contents/MacOS/PDFMathTranslate"
/usr/bin/strip -S "$app/Contents/MacOS/PDFMathTranslate"
install -m 644 "$project/packaging/Info.plist" "$app/Contents/Info.plist"
if [ -f "$project/packaging/AppIcon.icns" ]; then
    install -m 644 "$project/packaging/AppIcon.icns" "$resources/AppIcon.icns"
fi
ditto "$project/web" "$resources/web"
ditto "$project/upstream-notices" "$resources/licenses"
install -m 644 "$project/LICENSE" "$resources/licenses/LICENSE"

# The checksum manifest also specifies the complete set of runtime assets.
while read -r digest path; do
    case "$path" in
        models/*|fonts/*) ;;
        *) echo "Unexpected runtime asset path: $path" >&2; exit 1 ;;
    esac
    mkdir -p "$(dirname "$resources/$path")"
    install -m 644 "$runtime/$path" "$resources/$path"
done < "$manifest"
verify_runtime "$resources"

sign_identity="${CODESIGN_IDENTITY:-LittlePaws Local Code Signing}"
if ! security find-identity -v -p codesigning 2>/dev/null | grep -Fq "$sign_identity"; then
    sign_identity="-"
fi

if [ "$sign_identity" != "-" ]; then
    # Embed the public signing certificate (never the private key) inside Resources before sealing the bundle.
    security find-certificate -c "$sign_identity" -p > "$resources/PDF-Translator-Signing.cer" 2>/dev/null || true
    codesign --force --sign "$sign_identity" "$resources/models/libonnxruntime.1.32.0.dylib"
fi

codesign --force --sign "$sign_identity" "$app"
codesign --verify --deep --strict --verbose=2 "$app"
ditto -c -k --norsrc --keepParent "$app" "$scratch/$archive"
mv "$scratch/$archive" "$destination/$archive"
(cd "$destination" && shasum -a 256 "$archive" > "$archive.sha256")
printf '%s\n' "$destination/$archive"
