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
# Locate Project Directories
# ------------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

find_project_root() {
  if [ -d "$SCRIPT_DIR/vite-version" ]; then
    ROOT_DIR="$SCRIPT_DIR"
    VITE_DIR="$SCRIPT_DIR/vite-version"
  elif [ -d "$SCRIPT_DIR/shadcn-dashboard-landing-template/vite-version" ]; then
    ROOT_DIR="$SCRIPT_DIR/shadcn-dashboard-landing-template"
    VITE_DIR="$ROOT_DIR/vite-version"
  elif [ -f "$SCRIPT_DIR/package.json" ] && grep -q "shadcn-dashboard-vite" "$SCRIPT_DIR/package.json" 2>/dev/null; then
    ROOT_DIR="$(dirname "$SCRIPT_DIR")"
    VITE_DIR="$SCRIPT_DIR"
  else
    ROOT_DIR="$SCRIPT_DIR"
    VITE_DIR="$SCRIPT_DIR/vite-version"
  fi
}

find_project_root

# ------------------------------------------------------------------------------
# UI Helpers & Visual Branding
# ------------------------------------------------------------------------------
print_banner() {
  clear 2>/dev/null || true
  echo -e "${WHITE_BOLD}"
  echo "  ┌──────────────────────────────────────────────────────────┐"
  echo "  │                                                          │"
  echo "  │   ██╗███╗   ██╗████████╗███████╗██████╗  █████╗ ███████╗  │"
  echo "  │   ██║████╗  ██║╚══██╔══╝██╔════╝██╔══██╗██╔══██╗██╔════╝  │"
  echo "  │   ██║██╔██╗ ██║   ██║   █████╗  ██████╔╝███████║███████╗  │"
  echo "  │   ██║██║╚██╗██║   ██║   ██╔══╝  ██╔══██╗██╔══██║╚════██║  │"
  echo "  │   ██║██║ ╚████║   ██║   ███████╗██║  ██║██║  ██║███████║  │"
  echo "  │   ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝  │"
  echo "  │                                                          │"
  echo "  │   InterENL Free Cloud VPS Management Platform            │"
  echo "  │   Discord SSO • AMD EPYC Dedicated vCPU • DDR5 NVMe      │"
  echo "  └──────────────────────────────────────────────────────────┘"
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
# Dependency & Environment Checks
# ------------------------------------------------------------------------------
check_prerequisites() {
  print_header "System Verification"

  # Git Check
  if command -v git >/dev/null 2>&1; then
    print_step "Git Version: $(git --version | awk '{print $3}')"
  else
    print_error "Git is not installed. Please install git (e.g. sudo apt install git)"
    exit 1
  fi

  # Node.js Check
  if command -v node >/dev/null 2>&1; then
    NODE_VERSION=$(node -v | sed 's/v//')
    NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
    if [ "$NODE_MAJOR" -lt 18 ]; then
      print_warn "Node.js $NODE_VERSION found. Recommended: Node.js 20+ LTS"
    else
      print_step "Node.js Version: v$NODE_VERSION"
    fi
  else
    print_error "Node.js is not installed. Please install Node.js 20+ LTS"
    exit 1
  fi

  # Package Manager (pnpm preferred, fallback to npm)
  if command -v pnpm >/dev/null 2>&1; then
    PKG_MGR="pnpm"
    print_step "Package Manager: pnpm v$(pnpm --version)"
  elif command -v npm >/dev/null 2>&1; then
    PKG_MGR="npm"
    print_step "Package Manager: npm v$(npm --version) (Note: pnpm is recommended)"
  else
    print_error "No supported package manager found (pnpm or npm required)."
    exit 1
  fi
}

# ------------------------------------------------------------------------------
# Auto Installer
# ------------------------------------------------------------------------------
run_installer() {
  print_banner
  print_header "Automated Installation"

  check_prerequisites

  # Verify or Clone Repository
  print_header "Repository Configuration"
  if [ ! -d "$VITE_DIR" ]; then
    print_step "InterDash not detected locally. Initializing repository clone..."
    git clone "$REPO_URL" "$ROOT_DIR"
    find_project_root
  else
    print_step "Found existing project directory at: ${GRAY_LIGHT}$VITE_DIR${NC}"
  fi

  # Setup Environment File
  print_header "Environment Setup"
  local env_file="$VITE_DIR/.env"
  local env_example="$VITE_DIR/.env.example"

  if [ ! -f "$env_file" ]; then
    if [ -f "$env_example" ]; then
      cp "$env_example" "$env_file"
      print_success "Created .env from .env.example"
    else
      cat << 'EOF' > "$env_file"
# InterDash Environment Configuration
VITE_DISCORD_CLIENT_ID=123456789012345678
DISCORD_CLIENT_SECRET=your_discord_client_secret_here
VITE_DISCORD_REDIRECT_URI=http://localhost:5173/auth/callback
VITE_DISCORD_SCOPES=identify email
DISCORD_ADMIN_USER_ID=987654321098765432
VITE_GTM_ID=
VITE_BASENAME=
EOF
      print_success "Generated initial .env file"
    fi
  else
    print_step "Existing .env file detected"
  fi

  # Install Dependencies
  print_header "Installing Dependencies"
  print_step "Executing $PKG_MGR install in $VITE_DIR..."
  cd "$VITE_DIR"
  if [ "$PKG_MGR" = "pnpm" ]; then
    pnpm install
  else
    npm install
  fi
  print_success "Dependencies successfully installed"

  # Production Build Verification
  print_header "Production Build Verification"
  print_step "Compiling TypeScript and bundling Vite assets..."
  if [ "$PKG_MGR" = "pnpm" ]; then
    pnpm run build
  else
    npm run build
  fi
  print_success "Production build completed successfully"

  # Completion Summary
  print_header "Installation Complete"
  echo -e "  ${WHITE_BOLD}InterDash is ready!${NC}"
  echo ""
  echo -e "  ${WHITE}Start development server:${NC}"
  echo -e "    ${GRAY_LIGHT}cd ${VITE_DIR} && ${PKG_MGR} run dev${NC}"
  echo ""
  echo -e "  ${WHITE}Configure Discord OAuth2:${NC}"
  echo -e "    ${GRAY_LIGHT}nano ${env_file}${NC}"
  echo ""
  echo -e "  ${GRAY_MID}Access the management console at: http://localhost:5173${NC}"
  echo ""
}

# ------------------------------------------------------------------------------
# Auto Updater
# ------------------------------------------------------------------------------
run_updater() {
  print_banner
  print_header "Automated Updater"

  check_prerequisites

  if [ ! -d "$ROOT_DIR/.git" ]; then
    print_error "Git repository not found in $ROOT_DIR. Cannot auto-update."
    exit 1
  fi

  cd "$ROOT_DIR"
  CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "$DEFAULT_BRANCH")
  LOCAL_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

  print_step "Active Branch: ${WHITE_BOLD}$CURRENT_BRANCH${NC} (commit: ${GRAY_LIGHT}$LOCAL_HASH${NC})"
  print_step "Querying remote changes from ${GRAY_LIGHT}$REPO_URL${NC}..."

  git fetch origin "$CURRENT_BRANCH" --quiet

  REMOTE_HASH=$(git rev-parse --short "origin/$CURRENT_BRANCH" 2>/dev/null || echo "unknown")

  if [ "$LOCAL_HASH" = "$REMOTE_HASH" ]; then
    print_success "InterDash is already up to date at commit $LOCAL_HASH"
    echo ""
    read -p "  Force reinstall dependencies and rebuild? (y/N): " -r FORCE_REBUILD
    if [[ ! $FORCE_REBUILD =~ ^[Yy]$ ]]; then
      exit 0
    fi
  else
    print_step "New update detected: ${GRAY_MID}$LOCAL_HASH${NC} → ${WHITE_BOLD}$REMOTE_HASH${NC}"
    
    # Check for uncommitted changes
    if ! git diff-index --quiet HEAD --; then
      print_warn "Uncommitted changes detected. Stashing changes..."
      git stash push -m "auto-updater-stash-$(date +%s)" --quiet
      STASHED=1
    fi

    print_step "Pulling latest changes from origin/$CURRENT_BRANCH..."
    git pull origin "$CURRENT_BRANCH" --quiet
    print_success "Repository successfully updated to $REMOTE_HASH"

    if [ "${STASHED:-0}" -eq 1 ]; then
      print_step "Restoring stashed changes..."
      git stash pop --quiet || print_warn "Merge conflicts may have occurred while popping stash"
    fi
  fi

  # Re-install dependencies
  print_header "Refreshing Dependencies"
  cd "$VITE_DIR"
  print_step "Running $PKG_MGR install..."
  if [ "$PKG_MGR" = "pnpm" ]; then
    pnpm install
  else
    npm install
  fi
  print_success "Dependencies updated"

  # Rebuild
  print_header "Rebuilding Assets"
  print_step "Compiling updated production bundle..."
  if [ "$PKG_MGR" = "pnpm" ]; then
    pnpm run build
  else
    npm run build
  fi
  print_success "Rebuild completed cleanly"

  print_header "Update Complete"
  echo -e "  ${WHITE_BOLD}InterDash successfully updated to ${REMOTE_HASH}!${NC}"
  echo ""
  echo -e "  ${WHITE}Recent commits:${NC}"
  git log -n 3 --oneline --color | sed 's/^/    /'
  echo ""
}

# ------------------------------------------------------------------------------
# Dev Server Runner
# ------------------------------------------------------------------------------
run_dev() {
  print_banner
  print_header "Starting Development Server"
  check_prerequisites
  cd "$VITE_DIR"
  print_step "Launching Vite development server at http://localhost:5173..."
  echo ""
  if [ "$PKG_MGR" = "pnpm" ]; then
    exec pnpm run dev
  else
    exec npm run dev
  fi
}

# ------------------------------------------------------------------------------
# Production Builder
# ------------------------------------------------------------------------------
run_build() {
  print_banner
  print_header "Building Production Bundle"
  check_prerequisites
  cd "$VITE_DIR"
  print_step "Executing build pipeline (tsc -b && vite build)..."
  echo ""
  if [ "$PKG_MGR" = "pnpm" ]; then
    pnpm run build
  else
    npm run build
  fi
  print_success "Build completed. Artifacts stored in $VITE_DIR/dist"
}

# ------------------------------------------------------------------------------
# Interactive Menu
# ------------------------------------------------------------------------------
interactive_menu() {
  while true; do
    print_banner
    echo -e "  ${WHITE_BOLD}Infrastructure Operations:${NC}"
    echo ""
    echo -e "    ${WHITE_BOLD}1${NC} ${GRAY_DARK}│${NC} 📦 ${WHITE}Auto-Installer${NC}   ${DIM}- Verify environment, setup .env, install deps & build${NC}"
    echo -e "    ${WHITE_BOLD}2${NC} ${GRAY_DARK}│${NC} 🔄 ${WHITE}Auto-Updater${NC}     ${DIM}- Fetch latest GitHub commits, refresh deps & rebuild${NC}"
    echo -e "    ${WHITE_BOLD}3${NC} ${GRAY_DARK}│${NC} 🚀 ${WHITE}Start Dev Server${NC} ${DIM}- Launch local Vite dev server on port 5173${NC}"
    echo -e "    ${WHITE_BOLD}4${NC} ${GRAY_DARK}│${NC} 🏗️  ${WHITE}Build Bundle${NC}     ${DIM}- Run full TypeScript compiler and production build${NC}"
    echo -e "    ${WHITE_BOLD}5${NC} ${GRAY_DARK}│${NC} 🔍 ${WHITE}System Status${NC}    ${DIM}- Check Git, Node, PM, and directory health${NC}"
    echo -e "    ${WHITE_BOLD}0${NC} ${GRAY_DARK}│${NC} ✕  ${WHITE}Exit${NC}"
    echo ""
    echo -e "${GRAY_DARK}  ──────────────────────────────────────────────────────────${NC}"
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
        check_prerequisites
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
    echo -e "    ${WHITE}install, --install, -i${NC}  Run automated full installation"
    echo -e "    ${WHITE}update,  --update,  -u${NC}  Pull latest changes from GitHub & rebuild"
    echo -e "    ${WHITE}dev,     --dev,     -d${NC}  Start local Vite development server"
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
