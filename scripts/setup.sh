#!/usr/bin/env bash
set -euo pipefail

# Setup script for DoorDash Credit Optimizer
# Downloads curl-impersonate-chrome, which mimics Chrome's TLS fingerprint
# to bypass Cloudflare bot detection.

BIN_DIR="$(cd "$(dirname "$0")/.." && pwd)/bin"
mkdir -p "$BIN_DIR"

ARCH=$(uname -m)
OS=$(uname -s)

if [ "$OS" != "Linux" ] && [ "$OS" != "Darwin" ]; then
  echo "Error: Unsupported OS '$OS'. Only Linux and macOS are supported."
  exit 1
fi

VERSION="v0.6.1"

if [ "$OS" = "Linux" ]; then
  if [ "$ARCH" = "x86_64" ]; then
    URL="https://github.com/lwthiker/curl-impersonate/releases/download/${VERSION}/curl-impersonate-${VERSION}.x86_64-linux-gnu.tar.gz"
  elif [ "$ARCH" = "aarch64" ]; then
    URL="https://github.com/lwthiker/curl-impersonate/releases/download/${VERSION}/curl-impersonate-${VERSION}.aarch64-linux-gnu.tar.gz"
  else
    echo "Error: Unsupported architecture '$ARCH' on Linux."
    exit 1
  fi
elif [ "$OS" = "Darwin" ]; then
  if [ "$ARCH" = "x86_64" ]; then
    URL="https://github.com/lwthiker/curl-impersonate/releases/download/${VERSION}/curl-impersonate-${VERSION}.x86_64-macos.tar.gz"
  elif [ "$ARCH" = "arm64" ]; then
    URL="https://github.com/lwthiker/curl-impersonate/releases/download/${VERSION}/curl-impersonate-${VERSION}.arm64-macos.tar.gz"
  else
    echo "Error: Unsupported architecture '$ARCH' on macOS."
    exit 1
  fi
fi

if [ -f "$BIN_DIR/curl-impersonate-chrome" ]; then
  echo "curl-impersonate-chrome already exists in $BIN_DIR"
  echo "To re-download, delete it first: rm $BIN_DIR/curl-impersonate-chrome"
  exit 0
fi

echo "Downloading curl-impersonate ${VERSION} for ${OS} ${ARCH}..."
TMPDIR=$(mktemp -d)
curl -L -o "$TMPDIR/curl-impersonate.tar.gz" "$URL"

echo "Extracting..."
tar xzf "$TMPDIR/curl-impersonate.tar.gz" -C "$TMPDIR"

# Copy the chrome binary
cp "$TMPDIR/curl-impersonate-chrome" "$BIN_DIR/"
chmod +x "$BIN_DIR/curl-impersonate-chrome"

# Cleanup
rm -rf "$TMPDIR"

echo ""
echo "✓ curl-impersonate-chrome installed to $BIN_DIR/"
echo ""
echo "Next steps:"
echo "  1. Run: npm run dev"
echo "  2. Open http://localhost:3000"
echo "  3. Paste a cURL command from your DoorDash browser session"
