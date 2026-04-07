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

# ---- macOS: install dependencies via Homebrew ----
if [ "$OS" = "Darwin" ]; then
  if ! command -v brew &>/dev/null; then
    echo "Error: Homebrew is required on macOS. Install it from https://brew.sh"
    exit 1
  fi

  echo "Checking macOS dependencies..."
  DEPS=(libidn2 brotli nghttp2 zstd)
  MISSING=()
  for dep in "${DEPS[@]}"; do
    if ! brew list "$dep" &>/dev/null; then
      MISSING+=("$dep")
    fi
  done

  if [ ${#MISSING[@]} -gt 0 ]; then
    echo "Installing missing dependencies: ${MISSING[*]}"
    brew install "${MISSING[@]}"
  else
    echo "All dependencies already installed."
  fi
fi

# ---- Download curl-impersonate ----
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
else
  echo "Downloading curl-impersonate ${VERSION} for ${OS} ${ARCH}..."
  TMPDIR=$(mktemp -d)
  curl -L -o "$TMPDIR/curl-impersonate.tar.gz" "$URL"

  echo "Extracting..."
  tar xzf "$TMPDIR/curl-impersonate.tar.gz" -C "$TMPDIR"

  # Copy the chrome binary and shared libs (macOS needs them alongside)
  cp "$TMPDIR/curl-impersonate-chrome" "$BIN_DIR/"
  chmod +x "$BIN_DIR/curl-impersonate-chrome"

  # On macOS, also copy any .dylib files that were bundled
  if [ "$OS" = "Darwin" ]; then
    cp "$TMPDIR"/*.dylib "$BIN_DIR/" 2>/dev/null || true
  fi

  # Cleanup
  rm -rf "$TMPDIR"

  echo "✓ curl-impersonate-chrome installed to $BIN_DIR/"
fi

# ---- Verify it works ----
echo ""
echo "Verifying curl-impersonate-chrome..."
if "$BIN_DIR/curl-impersonate-chrome" --version &>/dev/null; then
  echo "✓ curl-impersonate-chrome works!"
else
  echo "✗ curl-impersonate-chrome failed to run."
  if [ "$OS" = "Darwin" ]; then
    echo ""
    echo "Try installing missing libraries:"
    echo "  brew install libidn2 brotli nghttp2 zstd libssh2"
    echo ""
    echo "If that doesn't help, check which library is missing:"
    echo "  $BIN_DIR/curl-impersonate-chrome --version"
  fi
  exit 1
fi

echo ""
echo "Setup complete! Next steps:"
echo "  1. Run: npm run dev"
echo "  2. Open http://localhost:3000"
echo "  3. Paste a cURL command from your DoorDash browser session"
