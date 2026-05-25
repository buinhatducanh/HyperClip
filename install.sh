#!/bin/bash
# HyperClip One-Command Installer (Linux/macOS)
# Run:
#   curl -fsSL https://raw.githubusercontent.com/loopcompany/hyperclip/main/install.sh | bash
#   # or
#   bash install.sh
set -e

INSTALL_PATH="${1:-$HOME/HyperClip}"
REPO_URL="${2:-https://github.com/loopcompany/hyperclip.git}"
APP_NAME="HyperClip"

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; NC='\033[0m'
step() { echo -e "${CYAN}[1/8] $1${NC}"; }
ok()   { echo -e "  ${GREEN}OK${NC}  $1"; }
fail() { echo -e "  ${RED}FAIL${NC} $1"; exit 1; }

echo ""
echo "=== HyperClip Installer ==="
echo ""

# ── 1. Prerequisites ────────────────────────────────────────────────────────────
step "Checking prerequisites..."

if command -v node &>/dev/null; then
    ok "Node.js $(node -v)"
else
    echo "  Installing Node.js 22..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
    apt-get install -y nodejs >/dev/null 2>&1 || yum install -y nodejs >/dev/null 2>&1
    ok "Node.js $(node -v)"
fi

if command -v pnpm &>/dev/null; then
    ok "pnpm $(pnpm -v)"
else
    echo "  Installing pnpm..."
    npm install -g pnpm >/dev/null 2>&1
    ok "pnpm installed"
fi

if command -v git &>/dev/null; then
    ok "Git $(git --version | cut -d' ' -f3)"
else
    fail "Git not installed. Install: sudo apt install git"
fi

# ── 2. Clone / Update repo ───────────────────────────────────────────────────────
step "Cloning repository..."
if [ -d "$INSTALL_PATH" ]; then
    ok "Directory exists: $INSTALL_PATH"
    cd "$INSTALL_PATH"
    if [ -d .git ]; then
        echo "  Pulling latest changes..."
        git pull origin main 2>/dev/null || true
        ok "Updated"
    fi
else
    git clone --depth 1 "$REPO_URL" "$INSTALL_PATH"
    cd "$INSTALL_PATH"
    ok "Cloned into $INSTALL_PATH"
fi

# ── 3. Install dependencies ──────────────────────────────────────────────────────
step "Installing dependencies..."
pnpm install --silent 2>/dev/null || pnpm install
ok "Dependencies ready"

# ── 4. Setup FFmpeg ──────────────────────────────────────────────────────────────
step "Setting up FFmpeg..."
FFMPEG_BIN="$INSTALL_PATH/resources/ffmpeg/bin/ffmpeg"
if [ -f "$FFMPEG_BIN" ]; then
    ok "FFmpeg already present"
else
    mkdir -p "$INSTALL_PATH/resources/ffmpeg/bin"
    echo "  Downloading FFmpeg (~177MB)..."
    curl -fsSL "https://github.com/GyanD/codexffmpeg/releases/download/7.1/ffmpeg-7.1-full_build.zip" -o /tmp/ffmpeg.zip
    unzip -q /tmp/ffmpeg.zip -d "$INSTALL_PATH/resources/ffmpeg/"
    cp "$INSTALL_PATH/resources/ffmpeg/ffmpeg-7.1-full_build/bin/"* "$INSTALL_PATH/resources/ffmpeg/bin/"
    rm -rf "$INSTALL_PATH/resources/ffmpeg/ffmpeg-7.1-full_build"
    rm /tmp/ffmpeg.zip
    ok "FFmpeg ready"
fi

# ── 5. Setup yt-dlp ──────────────────────────────────────────────────────────────
step "Setting up yt-dlp..."
mkdir -p "$INSTALL_PATH/resources/yt-dlp"
if [ -f "$INSTALL_PATH/resources/yt-dlp/yt-dlp" ]; then
    ok "yt-dlp already present"
else
    curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp" -o "$INSTALL_PATH/resources/yt-dlp/yt-dlp"
    chmod +x "$INSTALL_PATH/resources/yt-dlp/yt-dlp"
    ok "yt-dlp ready"
fi

# ── 6. Copy demo GCP projects ───────────────────────────────────────────────────
step "Setting up demo GCP projects (30 projects)..."
DEMO_PROJECTS_SRC="$INSTALL_PATH/demo-data/projects"
DEMO_PROJECTS_DST="$HOME/HyperClip-Data/projects"
if [ -d "$DEMO_PROJECTS_SRC" ]; then
    mkdir -p "$DEMO_PROJECTS_DST"
    count=0
    for proj in "$DEMO_PROJECTS_SRC"/*/; do
        proj_name=$(basename "$proj")
        dst="$DEMO_PROJECTS_DST/$proj_name"
        if [ ! -d "$dst" ]; then
            cp -r "$proj" "$DEMO_PROJECTS_DST/"
            count=$((count + 1))
        fi
    done
    ok "Copied $count GCP projects to ~/HyperClip-Data/projects"
else
    echo "  Skipping — no demo-data/projects/"
fi

# ── 7. Build ─────────────────────────────────────────────────────────────────────
step "Building Electron app..."
echo "  (First build: 5-15 min. Subsequent: 1-2 min.)"

TSCPATH="$INSTALL_PATH/node_modules/.pnpm/typescript@6.0.3/node_modules/typescript/lib/tsc.js"
node "$TSCPATH" -p "$INSTALL_PATH/electron/tsconfig.main.json" 2>/dev/null || true
node "$TSCPATH" -p "$INSTALL_PATH/electron/tsconfig.preload.json" 2>/dev/null || true

# Patch __dirname shim
MAIN_JS="$INSTALL_PATH/dist-electron/main.js"
if [ -f "$MAIN_JS" ]; then
    sed -i "/^const __dirname = .+;/d" "$MAIN_JS"
    sed -i "/^const __filename = .+;/d" "$MAIN_JS"
fi

# Next.js build
cd "$INSTALL_PATH"
node node_modules/next/dist/bin/next build 2>&1 | grep -v "^  " || true

# Electron builder
cd "$INSTALL_PATH"
npx electron-builder --linux --config electron-builder.yml 2>/dev/null || npx electron-builder --dir --config electron-builder.yml
ok "Build complete"

# ── 7. Done ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}=== Done! ===${NC}"
echo ""
EXE_PATH="$INSTALL_PATH/release/linux-unpacked/$APP_NAME"
if [ -f "$EXE_PATH" ]; then
    echo -e "App:     $EXE_PATH"
    echo -e "AppImage: $INSTALL_PATH/release/${APP_NAME}-*.AppImage"
    echo ""
    echo -e "${YELLOW}Run app:${NC}  $EXE_PATH"
else
    echo -e "${RED}Build failed. Check:$NC  $INSTALL_PATH/release/"
fi
echo ""
