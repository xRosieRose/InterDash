#!/usr/bin/env bash
# ==============================================================================
# InterDash - InterENL Free Cloud VPS Management Platform
# Script: inter.sh
# Purpose: Automated Installer, Updater & Infrastructure Manager
# Theme: 21st.dev Monochrome / Sleek Dark Minimalist
# Repository: https://github.com/xRosieRose/InterDash
# ==============================================================================

set -e

# ------------------------------------------------------------------------------
# Ensure standard binary search paths are available
# ------------------------------------------------------------------------------
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/share/pnpm:$HOME/.cargo/bin:$PATH"

# ------------------------------------------------------------------------------
# 21st.dev Monochrome Color Palette & Terminal Typography
# ------------------------------------------------------------------------------
NC='\033[0m'               # Reset
BOLD='\033[1m'              # Bold
DIM='\033[2m'               # Dim / Low contrast

# Monochrome Shades (Pure White, Grays, Blacks)
WHITE='\033[38;5;255m'      # Pure Crisp White (#FFFFFF)
WHITE_BOLD='\033[1;38;5;255m'
GRAY_LIGHT='\033[38;5;250m'  # Zinc 300
GRAY_MID='\033[38;5;244m'    # Zinc 500
GRAY_DARK='\033[38;5;238m'   # Zinc 800
BG_DARK='\033[48;5;234m'     # Near-black backdrop

REPO_URL="https://github.com/xRosieRose/InterDash.git"
DEFAULT_BRANCH="main"

# ------------------------------------------------------------------------------
# Privilege Escalation Helper
# ------------------------------------------------------------------------------
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  fi
fi

# ------------------------------------------------------------------------------
# Locate Project Directories
# ------------------------------------------------------------------------------
SCRIPT_DIR="$(pwd)"
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]:-}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

find_project_root() {
  if [ -d "$SCRIPT_DIR/vite-version" ]; then
    ROOT_DIR="$SCRIPT_DIR"
    VITE_DIR="$SCRIPT_DIR/vite-version"
  elif [ -d "$SCRIPT_DIR/shadcn-dashboard-landing-template/vite-version" ]; then
    ROOT_DIR="$SCRIPT_DIR/shadcn-dashboard-landing-template"
    VITE_DIR="$ROOT_DIR/vite-version"
  elif [ -d "$PWD/vite-version" ]; then
    ROOT_DIR="$PWD"
    VITE_DIR="$PWD/vite-version"
  elif [ -d "$PWD/shadcn-dashboard-landing-template/vite-version" ]; then
    ROOT_DIR="$PWD/shadcn-dashboard-landing-template"
    VITE_DIR="$ROOT_DIR/vite-version"
  elif [ -d "$PWD/interdash/vite-version" ]; then
    ROOT_DIR="$PWD/interdash"
    VITE_DIR="$ROOT_DIR/vite-version"
  elif [ -d "$SCRIPT_DIR/interdash/vite-version" ]; then
    ROOT_DIR="$SCRIPT_DIR/interdash"
    VITE_DIR="$ROOT_DIR/vite-version"
  elif [ -f "$SCRIPT_DIR/package.json" ] && grep -q "shadcn-dashboard-vite" "$SCRIPT_DIR/package.json" 2>/dev/null; then
    ROOT_DIR="$(dirname "$SCRIPT_DIR")"
    VITE_DIR="$SCRIPT_DIR"
  else
    ROOT_DIR="$PWD/interdash"
    VITE_DIR="$ROOT_DIR/vite-version"
  fi
}

find_project_root

# ------------------------------------------------------------------------------
# UI Helpers & Visual Branding (21st.dev Style - Perfectly Aligned 78-Col Box)
# ------------------------------------------------------------------------------
print_banner() {
  clear 2>/dev/null || true
  echo -e "${WHITE_BOLD}"
  echo "  ┌────────────────────────────────────────────────────────────────────────────┐"
  echo "  │                                                                            │"
  echo "  │██╗   ███╗   ██╗████████╗███████╗██████╗ ██████╗   █████╗ ███████╗██╗  ██╗│"
  echo "  │██║   ████╗  ██║╚══██╔══╝██╔════╝██╔══██╗██╔══██╗ ██╔══██╗██╔════╝██║  ██║│"
  echo "  │██║   ██╔██╗ ██║   ██║   █████╗  ██████╔╝██║  ██║ ███████║███████╗███████║│"
  echo "  │██║   ██║╚██╗██║   ██║   ██╔══╝  ██╔══██╗██║  ██║ ██╔══██║╚════██║██╔══██║│"
  echo "  │██║   ██║ ╚████║   ██║   ███████╗██║  ██║██████╔╝ ██║  ██║███████║██║  ██║│"
  echo "  │╚═╝   ╚═╝  ╚═══╝   ╚═╝   ╚══════╝╚═╝  ╚═╝╚═════╝  ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝│"
  echo "  │                                                                            │"
  echo "  │  InterENL Free Cloud VPS Management Platform                               │"
  echo "  │  Discord SSO • AMD EPYC Dedicated vCPU • DDR5 NVMe                         │"
  echo "  └────────────────────────────────────────────────────────────────────────────┘"
  echo -e "${NC}"
}

print_header() {
  local title="$1"
  echo ""
  echo -e "${GRAY_DARK}  ───${NC} ${WHITE_BOLD}${title}${NC} ${GRAY_DARK}─────────────────────────────────────────${NC}"
  echo ""
}

print_step() {
  local msg="$1"
  echo -e "  ${WHITE_BOLD}●${NC} ${WHITE}${msg}${NC}"
}

print_substep() {
  local msg="$1"
  echo -e "    ${GRAY_MID}↳${NC} ${GRAY_LIGHT}${msg}${NC}"
}

print_success() {
  local msg="$1"
  echo -e "  ${WHITE_BOLD}✓${NC} ${WHITE_BOLD}${msg}${NC}"
}

print_warn() {
  local msg="$1"
  echo -e "  ${GRAY_LIGHT}!${NC} ${GRAY_LIGHT}${msg}${NC}"
}

print_error() {
  local msg="$1"
  echo -e "  ${WHITE_BOLD}✗ ERROR:${NC} ${GRAY_LIGHT}${msg}${NC}"
}

# ------------------------------------------------------------------------------
# Automated Dependency Installer (Auto-provisions Node 20 LTS, pnpm, curl, git)
# ------------------------------------------------------------------------------
install_dependencies() {
  print_header "Dependency Resolution"

  # 1. Base tools installation (curl, git, tar, xz, ca-certificates, gnupg)
  local need_core=0
  for cmd in curl git tar; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      need_core=1
      break
    fi
  done

  if [ "$need_core" -eq 1 ] || ! command -v xz >/dev/null 2>&1; then
    print_step "Installing core system utilities (curl, git, certificates)..."
    if command -v apt-get >/dev/null 2>&1; then
      $SUDO apt-get update -y -qq
      $SUDO apt-get install -y -qq curl git tar xz-utils ca-certificates gnupg build-essential
    elif command -v dnf >/dev/null 2>&1; then
      $SUDO dnf install -y -q curl git tar xz ca-certificates gnupg
    elif command -v yum >/dev/null 2>&1; then
      $SUDO yum install -y -q curl git tar xz ca-certificates
    elif command -v pacman >/dev/null 2>&1; then
      $SUDO pacman -Sy --noconfirm curl git tar xz ca-certificates
    elif command -v apk >/dev/null 2>&1; then
      $SUDO apk add --no-cache curl git tar xz ca-certificates bash
    fi
    print_success "Core system utilities verified"
  else
    print_step "Core utilities (curl, git, tar) available"
  fi

  # 2. Check and Auto-Install Node.js 20+ LTS
  local need_node=0
  if ! command -v node >/dev/null 2>&1; then
    need_node=1
  else
    local node_major
    node_major=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1 || echo "0")
    if [ "$node_major" -lt 18 ]; then
      print_warn "Current Node.js (v$(node -v)) is outdated. Upgrading to Node.js 20 LTS..."
      need_node=1
    fi
  fi

  if [ "$need_node" -eq 1 ]; then
    print_step "Installing Node.js 20 LTS..."

    # Method A: NodeSource repository setup for Debian/Ubuntu/RHEL
    if command -v apt-get >/dev/null 2>&1; then
      print_substep "Configuring NodeSource repository..."
      curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO bash - >/dev/null 2>&1 || true
      $SUDO apt-get install -y -qq nodejs >/dev/null 2>&1 || true
    elif command -v dnf >/dev/null 2>&1; then
      curl -fsSL https://rpm.nodesource.com/setup_20.x | $SUDO bash - >/dev/null 2>&1 || true
      $SUDO dnf install -y -q nodejs >/dev/null 2>&1 || true
    fi

    # Method B: Direct official pre-compiled binary fallback (Guaranteed 100% on any Linux)
    if ! command -v node >/dev/null 2>&1 || [ "$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1 || echo 0)" -lt 18 ]; then
      print_substep "Extracting official Node.js 20 LTS binary to /usr/local..."
      ARCH=$(uname -m)
      case "$ARCH" in
        x86_64) N_ARCH="x64" ;;
        aarch64|arm64) N_ARCH="arm64" ;;
        *) N_ARCH="x64" ;;
      esac
      curl -fsSL "https://nodejs.org/dist/v20.18.0/node-v20.18.0-linux-${N_ARCH}.tar.xz" | $SUDO tar -xJf - -C /usr/local --strip-components=1
      export PATH="/usr/local/bin:$PATH"
      hash -r 2>/dev/null || true
    fi

    if command -v node >/dev/null 2>&1; then
      print_success "Node.js installed: $(node -v)"
    else
      print_error "Failed to install Node.js automatically."
      exit 1
    fi
  else
    print_step "Node.js version: $(node -v)"
  fi

  # 3. Check and Auto-Install pnpm
  if ! command -v pnpm >/dev/null 2>&1; then
    print_step "Installing pnpm package manager..."
    if command -v npm >/dev/null 2>&1; then
      $SUDO npm install -g pnpm@latest --silent >/dev/null 2>&1 || npm install -g pnpm@latest --silent >/dev/null 2>&1 || true
    fi

    if ! command -v pnpm >/dev/null 2>&1; then
      curl -fsSL https://get.pnpm.io/install.sh | bash - >/dev/null 2>&1 || true
      export PNPM_HOME="$HOME/.local/share/pnpm"
      export PATH="$PNPM_HOME:$PATH"
    fi

    if command -v pnpm >/dev/null 2>&1; then
      print_success "pnpm installed: v$(pnpm --version)"
    else
      print_warn "pnpm installation skipped; npm will be used"
    fi
  else
    print_step "pnpm version: v$(pnpm --version)"
  fi
}

# ------------------------------------------------------------------------------
# System Verification
# ------------------------------------------------------------------------------
verify_system() {
  print_header "System Verification"

  if ! command -v git >/dev/null 2>&1 || ! command -v node >/dev/null 2>&1; then
    install_dependencies
  fi

  if command -v git >/dev/null 2>&1; then
    print_step "Git Version: $(git --version | awk '{print $3}')"
  else
    print_error "Git could not be resolved."
    exit 1
  fi

  if command -v node >/dev/null 2>&1; then
    print_step "Node.js Version: $(node -v)"
  else
    print_error "Node.js could not be resolved."
    exit 1
  fi

  if command -v pnpm >/dev/null 2>&1; then
    PKG_MGR="pnpm"
    print_step "Package Manager: pnpm v$(pnpm --version)"
  elif command -v npm >/dev/null 2>&1; then
    PKG_MGR="npm"
    print_step "Package Manager: npm v$(npm --version)"
  else
    print_error "No package manager resolved."
    exit 1
  fi
}

# ------------------------------------------------------------------------------
# Auto Installer
# ------------------------------------------------------------------------------
run_installer() {
  print_banner
  print_header "Automated Installation"

  # 1. Ensure all system packages and dependencies exist
  install_dependencies
  verify_system

  # 2. Verify or Clone Repository into a dedicated directory
  print_header "Repository Setup"
  find_project_root

  if [ ! -d "$VITE_DIR" ]; then
    TARGET_CLONE="$PWD/interdash"
    if [ -d "$TARGET_CLONE/vite-version" ]; then
      ROOT_DIR="$TARGET_CLONE"
      VITE_DIR="$TARGET_CLONE/vite-version"
      print_step "Using existing repository at: ${GRAY_LIGHT}$ROOT_DIR${NC}"
    else
      print_step "Cloning InterDash into: ${GRAY_LIGHT}$TARGET_CLONE${NC}..."
      git clone "$REPO_URL" "$TARGET_CLONE"
      ROOT_DIR="$TARGET_CLONE"
      VITE_DIR="$TARGET_CLONE/vite-version"
      if [ ! -d "$VITE_DIR" ] && [ -d "$ROOT_DIR/shadcn-dashboard-landing-template/vite-version" ]; then
        ROOT_DIR="$ROOT_DIR/shadcn-dashboard-landing-template"
        VITE_DIR="$ROOT_DIR/vite-version"
      fi
    fi
  else
    print_step "Using existing project directory: ${GRAY_LIGHT}$VITE_DIR${NC}"
  fi

  # 3. Setup Environment File (.env)
  print_header "Environment Setup"
  local env_file="$VITE_DIR/.env"
  local env_example="$VITE_DIR/.env.example"

  if [ ! -f "$env_file" ]; then
    if [ -f "$env_example" ]; then
      cp "$env_example" "$env_file"
      print_success "Created .env from template"
    else
      cat << 'EOF' > "$env_file"
# InterDash Environment Configuration
VITE_DISCORD_CLIENT_ID=123456789012345678
DISCORD_CLIENT_SECRET=your_discord_client_secret_here
VITE_DISCORD_REDIRECT_URI=http://localhost:5173/auth/callback
VITE_DISCORD_SCOPES=identify email guilds
DISCORD_ADMIN_USER_ID=your_discord_user_id_here
PORT=5173
HOST=0.0.0.0
EOF
      print_success "Created fresh .env file"
    fi
  else
    print_step "Using existing .env file"
  fi

  # 4. Install Project Packages
  print_header "Installing Dependencies"
  cd "$VITE_DIR"
  print_step "Running $PKG_MGR install in $VITE_DIR..."
  if [ "$PKG_MGR" = "pnpm" ]; then
    pnpm install --prefer-frozen-lockfile 2>/dev/null || pnpm install
  else
    npm install --legacy-peer-deps
  fi
  print_success "Project dependencies installed successfully"

  # 5. Compile Production Distribution
  print_header "Building Production Bundle"
  print_step "Compiling distribution bundle..."
  if [ "$PKG_MGR" = "pnpm" ]; then
    pnpm run build
  else
    npm run build
  fi
  print_success "Production build completed"

  # 6. Completion Summary
  print_header "Installation Complete"
  echo -e "  ${WHITE_BOLD}InterDash is fully installed!${NC}"
  echo ""
  echo -e "  ${WHITE}Start server now:${NC}"
  echo -e "    ${GRAY_LIGHT}cd ${VITE_DIR} && ${PKG_MGR} run dev -- --host 0.0.0.0${NC}"
  echo ""
  echo -e "  ${WHITE}Configure Discord OAuth2 credentials:${NC}"
  echo -e "    ${GRAY_LIGHT}nano ${env_file}${NC}"
  echo ""
  echo -e "  ${WHITE}Access URL:${NC}"
  echo -e "    ${WHITE_BOLD}http://<your-server-ip>:5173${NC}"
  echo ""
}

# ------------------------------------------------------------------------------
# Auto Updater
# ------------------------------------------------------------------------------
run_updater() {
  print_banner
  print_header "Automated Updater"

  install_dependencies
  verify_system
  find_project_root

  if [ ! -d "$ROOT_DIR/.git" ]; then
    print_error "Git repository not found in $ROOT_DIR. Cannot auto-update."
    exit 1
  fi

  cd "$ROOT_DIR"
  CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "$DEFAULT_BRANCH")
  LOCAL_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

  print_step "Branch: ${WHITE_BOLD}$CURRENT_BRANCH${NC} (local: ${GRAY_LIGHT}$LOCAL_HASH${NC})"
  print_step "Checking remote changes from ${GRAY_LIGHT}$REPO_URL${NC}..."

  git fetch origin "$CURRENT_BRANCH" --quiet

  REMOTE_HASH=$(git rev-parse --short "origin/$CURRENT_BRANCH" 2>/dev/null || echo "unknown")

  if [ "$LOCAL_HASH" = "$REMOTE_HASH" ]; then
    print_success "InterDash is already on the latest version ($LOCAL_HASH)"
    echo ""
    read -p "  Force reinstall dependencies and rebuild? (y/N): " -r FORCE_REBUILD
    if [[ ! $FORCE_REBUILD =~ ^[Yy]$ ]]; then
      exit 0
    fi
  else
    print_step "New update available: ${GRAY_MID}$LOCAL_HASH${NC} → ${WHITE_BOLD}$REMOTE_HASH${NC}"
    
    if ! git diff-index --quiet HEAD --; then
      print_warn "Stashing local changes..."
      git stash push -m "inter-updater-$(date +%s)" --quiet
      STASHED=1
    fi

    print_step "Pulling latest commits from GitHub..."
    git pull origin "$CURRENT_BRANCH" --quiet
    print_success "Updated repository to $REMOTE_HASH"

    if [ "${STASHED:-0}" -eq 1 ]; then
      print_step "Restoring stashed changes..."
      git stash pop --quiet || print_warn "Merge conflicts may require manual check"
    fi
  fi

  # Refresh dependencies
  print_header "Refreshing Dependencies"
  cd "$VITE_DIR"
  print_step "Running $PKG_MGR install..."
  if [ "$PKG_MGR" = "pnpm" ]; then
    pnpm install
  else
    npm install --legacy-peer-deps
  fi
  print_success "Dependencies updated"

  # Rebuild
  print_header "Rebuilding Production Bundle"
  print_step "Compiling distribution..."
  if [ "$PKG_MGR" = "pnpm" ]; then
    pnpm run build
  else
    npm run build
  fi
  print_success "Build complete"

  print_header "Update Complete"
  echo -e "  ${WHITE_BOLD}InterDash successfully updated to ${REMOTE_HASH}!${NC}"
  echo ""
  echo -e "  ${WHITE}Restart server:${NC}"
  echo -e "    ${GRAY_LIGHT}cd ${VITE_DIR} && ${PKG_MGR} run dev -- --host 0.0.0.0${NC}"
  echo ""
}

# ------------------------------------------------------------------------------
# Dev Server Runner
# ------------------------------------------------------------------------------
run_dev() {
  print_banner
  print_header "Starting Development Server"
  verify_system
  find_project_root
  cd "$VITE_DIR"
  print_step "Launching Vite server bound to 0.0.0.0:5173..."
  echo ""
  if [ "$PKG_MGR" = "pnpm" ]; then
    exec pnpm run dev -- --host 0.0.0.0
  else
    exec npm run dev -- --host 0.0.0.0
  fi
}

# ------------------------------------------------------------------------------
# Production Builder
# ------------------------------------------------------------------------------
run_build() {
  print_banner
  print_header "Building Production Bundle"
  verify_system
  find_project_root
  cd "$VITE_DIR"
  print_step "Compiling TypeScript and building Vite bundle..."
  echo ""
  if [ "$PKG_MGR" = "pnpm" ]; then
    pnpm run build
  else
    npm run build
  fi
  print_success "Build finished. Artifacts saved in $VITE_DIR/dist"
}

# ------------------------------------------------------------------------------
# Interactive Management Menu
# ------------------------------------------------------------------------------
interactive_menu() {
  while true; do
    print_banner
    echo -e "  ${WHITE_BOLD}Infrastructure Operations:${NC}"
    echo ""
    echo -e "    ${WHITE_BOLD}1${NC} ${GRAY_DARK}│${NC} 📦 ${WHITE}Auto-Installer${NC}   ${DIM}- Auto-install Node/pnpm, setup .env, install deps & build${NC}"
    echo -e "    ${WHITE_BOLD}2${NC} ${GRAY_DARK}│${NC} 🔄 ${WHITE}Auto-Updater${NC}     ${DIM}- Pull latest GitHub commits, refresh deps & rebuild${NC}"
    echo -e "    ${WHITE_BOLD}3${NC} ${GRAY_DARK}│${NC} 🚀 ${WHITE}Start Server${NC}     ${DIM}- Launch Vite server bound to 0.0.0.0:5173${NC}"
    echo -e "    ${WHITE_BOLD}4${NC} ${GRAY_DARK}│${NC} 🏗️  ${WHITE}Build Bundle${NC}     ${DIM}- Run full TypeScript compiler and production build${NC}"
    echo -e "    ${WHITE_BOLD}5${NC} ${GRAY_DARK}│${NC} 🔍 ${WHITE}System Status${NC}    ${DIM}- Verify Node, Git, PM, and directory health${NC}"
    echo -e "    ${WHITE_BOLD}0${NC} ${GRAY_DARK}│${NC} ✕  ${WHITE}Exit${NC}"
    echo ""
    echo -e "${GRAY_DARK}  ─────────────────────────────────────────────────────────────${NC}"
    read -p "  Select an option [0-5]: " -r OPTION
    echo ""

    case "$OPTION" in
      1)
        run_installer
        read -p "  Press Enter to return to menu..."
        ;;
      2)
        run_updater
        read -p "  Press Enter to return to menu..."
        ;;
      3)
        run_dev
        ;;
      4)
        run_build
        read -p "  Press Enter to return to menu..."
        ;;
      5)
        print_banner
        install_dependencies
        verify_system
        echo ""
        read -p "  Press Enter to return to menu..."
        ;;
      0|q|Q)
        print_banner
        echo -e "  ${GRAY_LIGHT}Exiting InterDash manager.${NC}"
        echo ""
        exit 0
        ;;
      *)
        print_warn "Invalid selection."
        sleep 1
        ;;
    esac
  done
}

# ------------------------------------------------------------------------------
# Entrypoint Router
# ------------------------------------------------------------------------------
# Handle non-interactive piping (e.g. curl -sSL ... | bash)
if [ ! -t 0 ] && [ -z "${1:-}" ]; then
  run_installer
  exit 0
fi

case "${1:-}" in
  install|--install|-i)
    run_installer
    ;;
  update|--update|-u)
    run_updater
    ;;
  dev|--dev|-d)
    run_dev
    ;;
  build|--build|-b)
    run_build
    ;;
  help|--help|-h)
    print_banner
    echo -e "  ${WHITE_BOLD}Usage:${NC} ./inter.sh [command]"
    echo ""
    echo -e "  ${WHITE_BOLD}Commands:${NC}"
    echo -e "    ${WHITE}install, --install, -i${NC}  Run automated dependency setup & installation"
    echo -e "    ${WHITE}update,  --update,  -u${NC}  Pull latest changes from GitHub & rebuild"
    echo -e "    ${WHITE}dev,     --dev,     -d${NC}  Start Vite server (0.0.0.0:5173)"
    echo -e "    ${WHITE}build,   --build,   -b${NC}  Compile production bundle"
    echo -e "    ${WHITE}help,    --help,    -h${NC}  Show this help reference"
    echo ""
    echo -e "  Run without arguments for interactive management interface."
    echo ""
    ;;
  "")
    interactive_menu
    ;;
  *)
    print_error "Unknown option '$1'. Use './inter.sh help' for usage instructions."
    exit 1
    ;;
esac
