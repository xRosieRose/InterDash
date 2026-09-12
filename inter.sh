#!/usr/bin/env bash
# ==============================================================================
# InterDash - InterENL Free Cloud VPS Management Platform
# Script: inter.sh
# Purpose: Automated Installer, Updater, PM2 Daemon & Infrastructure Manager
# Theme: 21st.dev Monochrome / Sleek Dark Minimalist
# Repository: https://github.com/xRosieRose/InterDash
# ==============================================================================

set -e

# ------------------------------------------------------------------------------
# Ensure standard binary search paths are available
# ------------------------------------------------------------------------------
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/share/pnpm:$HOME/.cargo/bin:$PATH"

# Dynamically include global npm prefix in PATH if available
if command -v npm >/dev/null 2>&1; then
  NPM_GLOBAL_BIN="$(npm config get prefix 2>/dev/null || echo '/usr/local')/bin"
  export PATH="$NPM_GLOBAL_BIN:$PATH"
fi

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
  # 1. Discover repo root via git worktree if current or script directory is in a repo
  local git_root
  git_root=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || git -C "$PWD" rev-parse --show-toplevel 2>/dev/null || true)
  if [ -n "$git_root" ] && [ -d "$git_root/.git" ]; then
    ROOT_DIR="$git_root"
    if [ -d "$ROOT_DIR/vite-version" ]; then
      VITE_DIR="$ROOT_DIR/vite-version"
      return 0
    elif [ -d "$ROOT_DIR/shadcn-dashboard-landing-template/vite-version" ]; then
      ROOT_DIR="$ROOT_DIR/shadcn-dashboard-landing-template"
      VITE_DIR="$ROOT_DIR/vite-version"
      return 0
    elif [ -f "$ROOT_DIR/package.json" ]; then
      VITE_DIR="$ROOT_DIR"
      return 0
    fi
  fi

  # 2. Check running PM2 process working directory
  if command -v pm2 >/dev/null 2>&1; then
    local pm2_cwd
    pm2_cwd=$(pm2 jlist 2>/dev/null | grep -o '"pm_cwd":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
    if [ -n "$pm2_cwd" ] && [ -d "$pm2_cwd" ]; then
      if [ -d "$pm2_cwd/../.git" ]; then
        ROOT_DIR="$(cd "$pm2_cwd/.." && pwd)"
        VITE_DIR="$pm2_cwd"
        return 0
      elif [ -d "$pm2_cwd/.git" ]; then
        ROOT_DIR="$pm2_cwd"
        VITE_DIR="$pm2_cwd"
        return 0
      fi
    fi
  fi

  # 3. Check common deployment candidates
  local candidates=(
    "$SCRIPT_DIR/InterDash"
    "$SCRIPT_DIR/interdash"
    "$PWD/InterDash"
    "$PWD/interdash"
    "$HOME/InterDash"
    "$HOME/interdash"
    "$SCRIPT_DIR"
    "$PWD"
    "$SCRIPT_DIR/shadcn-dashboard-landing-template"
    "$PWD/shadcn-dashboard-landing-template"
    "/var/www/InterDash"
    "/var/www/interdash"
    "/opt/InterDash"
    "/opt/interdash"
  )

  for dir in "${candidates[@]}"; do
    if [ -d "$dir/.git" ]; then
      ROOT_DIR="$dir"
      if [ -d "$dir/vite-version" ]; then
        VITE_DIR="$dir/vite-version"
        return 0
      elif [ -d "$dir/shadcn-dashboard-landing-template/vite-version" ]; then
        ROOT_DIR="$dir/shadcn-dashboard-landing-template"
        VITE_DIR="$ROOT_DIR/vite-version"
        return 0
      elif [ -f "$dir/package.json" ]; then
        VITE_DIR="$dir"
        return 0
      fi
    fi
  done

  # 4. Fallback check for directories that contain vite-version
  for dir in "${candidates[@]}"; do
    if [ -d "$dir/vite-version" ]; then
      ROOT_DIR="$dir"
      VITE_DIR="$dir/vite-version"
      return 0
    fi
  done

  # Default fallback
  ROOT_DIR="${PWD}/InterDash"
  VITE_DIR="$ROOT_DIR/vite-version"
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
# Automated Dependency Installer (Auto-provisions Node 20 LTS, pnpm, PM2, git)
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

  # 4. Check and Auto-Install PM2 Process Manager
  if ! command -v pm2 >/dev/null 2>&1; then
    print_step "Installing PM2 process manager for 24/7 background uptime..."
    if command -v npm >/dev/null 2>&1; then
      $SUDO npm install -g pm2 --silent >/dev/null 2>&1 || npm install -g pm2 --silent >/dev/null 2>&1 || true
    fi

    if command -v npm >/dev/null 2>&1; then
      NPM_GLOBAL_BIN="$(npm config get prefix 2>/dev/null || echo '/usr/local')/bin"
      export PATH="$NPM_GLOBAL_BIN:$PATH"
    fi

    if command -v pm2 >/dev/null 2>&1; then
      print_success "PM2 installed: v$(pm2 --version)"
    else
      print_warn "PM2 global install pending; will be verified during startup"
    fi
  else
    print_step "PM2 Process Manager: v$(pm2 --version)"
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

  if command -v pm2 >/dev/null 2>&1; then
    print_step "Daemon Manager: PM2 v$(pm2 --version)"
  else
    print_warn "Daemon Manager: PM2 not currently in PATH (will install on start)"
  fi
}

# ------------------------------------------------------------------------------
# PM2 Daemon Controller Functions
# ------------------------------------------------------------------------------
start_pm2() {
  print_header "Starting InterDash with PM2"
  find_project_root

  # Ensure PM2 is installed
  if ! command -v pm2 >/dev/null 2>&1; then
    print_step "PM2 not found. Auto-installing PM2..."
    if command -v npm >/dev/null 2>&1; then
      $SUDO npm install -g pm2 --silent >/dev/null 2>&1 || npm install -g pm2 --silent >/dev/null 2>&1 || true
      NPM_GLOBAL_BIN="$(npm config get prefix 2>/dev/null || echo '/usr/local')/bin"
      export PATH="$NPM_GLOBAL_BIN:$PATH"
    fi
  fi

  if ! command -v pm2 >/dev/null 2>&1; then
    print_error "PM2 could not be installed automatically. Run: npm install -g pm2"
    return 1
  fi

  # Ensure production distribution bundle exists
  if [ ! -d "$VITE_DIR/dist" ] || [ ! -f "$VITE_DIR/dist/index.html" ]; then
    print_step "Production bundle missing. Compiling distribution..."
    cd "$VITE_DIR"
    if [ "${PKG_MGR:-pnpm}" = "pnpm" ] && command -v pnpm >/dev/null 2>&1; then
      pnpm run build
    else
      npm run build
    fi
    print_success "Production bundle compiled"
  fi

  # Read PORT from .env or default to 5173
  local app_port="5173"
  if [ -f "$VITE_DIR/.env" ]; then
    local env_port
    env_port=$(grep -E "^PORT=" "$VITE_DIR/.env" 2>/dev/null | cut -d= -f2 | tr -d ' "' || true)
    if [ -n "$env_port" ]; then
      app_port="$env_port"
    fi
  fi

  cd "$VITE_DIR"

  # If an existing interdash process is in PM2, delete it cleanly
  if pm2 list 2>/dev/null | grep -q "interdash"; then
    print_step "Replacing existing PM2 instance of interdash..."
    pm2 delete interdash >/dev/null 2>&1 || true
  fi

  print_step "Starting InterDash server on port $app_port with PM2..."
  if [ -f "$VITE_DIR/ecosystem.config.cjs" ]; then
    PORT="$app_port" pm2 start "$VITE_DIR/ecosystem.config.cjs" >/dev/null 2>&1
  else
    PORT="$app_port" pm2 start "npx" --name "interdash" -- tsx server/index.ts >/dev/null 2>&1
  fi

  pm2 save >/dev/null 2>&1 || true

  print_success "InterDash is active and running in background via PM2"
  echo ""
  echo -e "  ${WHITE_BOLD}Service Status:${NC}"
  echo -e "    ${WHITE}Name:${NC}   ${GRAY_LIGHT}interdash${NC}"
  echo -e "    ${WHITE}Port:${NC}   ${WHITE_BOLD}${app_port}${NC}"
  echo -e "    ${WHITE}Mode:${NC}   ${GRAY_LIGHT}PM2 Background Daemon (Auto-Restart)${NC}"
  echo ""
  pm2 status interdash 2>/dev/null || pm2 status
  echo ""
}

stop_pm2() {
  print_header "Stopping PM2 Service"
  if command -v pm2 >/dev/null 2>&1; then
    pm2 stop interdash 2>/dev/null || true
    print_success "InterDash PM2 service stopped"
  else
    print_warn "PM2 is not installed."
  fi
}

restart_pm2() {
  print_header "Restarting PM2 Service"
  find_project_root

  if command -v pm2 >/dev/null 2>&1 && pm2 list 2>/dev/null | grep -q "interdash"; then
    pm2 restart interdash >/dev/null 2>&1
    print_success "InterDash PM2 service restarted"
    echo ""
    pm2 status interdash 2>/dev/null || true
  else
    start_pm2
  fi
}

logs_pm2() {
  if command -v pm2 >/dev/null 2>&1; then
    pm2 logs interdash --lines 50
  else
    print_error "PM2 is not installed."
  fi
}

status_pm2() {
  print_banner
  print_header "PM2 Infrastructure Status"
  if command -v pm2 >/dev/null 2>&1; then
    pm2 status interdash 2>/dev/null || pm2 status
  else
    print_warn "PM2 is not installed."
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
# InterDash Production Environment Configuration
NODE_ENV=production
PORT=5173
APP_URL=http://localhost:5173
SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" 2>/dev/null || echo "session_secret_32bytes_random_hex_key")
DATABASE_PATH=./data/interdash.db
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_REDIRECT_URI=http://localhost:5173/api/auth/discord/callback
DISCORD_SCOPES=identify email
DISCORD_ADMIN_USER_ID=
PROXMOX_DEFAULT_STORAGE=local-lvm
PROXMOX_DEFAULT_BRIDGE=vmbr0
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

  # 6. Start / Daemonize with PM2
  start_pm2

  # 7. Completion Summary
  local port_num="5173"
  if [ -f "$env_file" ]; then
    local p
    p=$(grep -E "^PORT=" "$env_file" 2>/dev/null | cut -d= -f2 | tr -d ' "' || true)
    if [ -n "$p" ]; then
      port_num="$p"
    fi
  fi

  print_header "Installation Complete"
  echo -e "  ${WHITE_BOLD}InterDash is online and managed 24/7 by PM2!${NC}"
  echo ""
  echo -e "  ${WHITE}Access URL:${NC}"
  echo -e "    ${WHITE_BOLD}http://<your-server-ip>:${port_num}${NC}"
  echo ""
  echo -e "  ${WHITE}Configure Discord OAuth2 credentials:${NC}"
  echo -e "    ${GRAY_LIGHT}nano ${env_file}${NC}"
  echo ""
  echo -e "  ${WHITE}PM2 Commands:${NC}"
  echo -e "    ${GRAY_LIGHT}pm2 logs interdash${NC}     - View real-time logs"
  echo -e "    ${GRAY_LIGHT}pm2 status${NC}             - Check uptime & memory"
  echo -e "    ${GRAY_LIGHT}pm2 restart interdash${NC}  - Restart service"
  echo -e "    ${GRAY_LIGHT}pm2 stop interdash${NC}     - Stop service"
  echo ""
  echo -e "  ${WHITE}To enable auto-start on server reboot:${NC}"
  echo -e "    ${WHITE_BOLD}pm2 startup && pm2 save${NC}"
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
    print_warn "No existing Git repository found in $ROOT_DIR."
    TARGET_CLONE="$PWD/InterDash"
    if [ -d "$TARGET_CLONE/.git" ]; then
      ROOT_DIR="$TARGET_CLONE"
      VITE_DIR="$ROOT_DIR/vite-version"
      print_step "Using repository at: ${GRAY_LIGHT}$ROOT_DIR${NC}"
    else
      print_step "Cloning InterDash from ${GRAY_LIGHT}$REPO_URL${NC} into: ${GRAY_LIGHT}$TARGET_CLONE${NC}..."
      git clone "$REPO_URL" "$TARGET_CLONE"
      ROOT_DIR="$TARGET_CLONE"
      VITE_DIR="$ROOT_DIR/vite-version"
    fi
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
    if [ ! -t 0 ] || [ "${FORCE:-0}" = "1" ] || [ "${1:-}" = "-f" ] || [ "${2:-}" = "-f" ] || [ "${1:-}" = "--force" ] || [ "${2:-}" = "--force" ]; then
      FORCE_REBUILD="y"
    else
      read -p "  Force reinstall dependencies and rebuild? (y/N): " -r FORCE_REBUILD
      if [[ ! $FORCE_REBUILD =~ ^[Yy]$ ]]; then
        restart_pm2
        exit 0
      fi
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

  # Reload PM2 service seamlessly
  print_header "Reloading PM2 Service"
  if command -v pm2 >/dev/null 2>&1 && pm2 list 2>/dev/null | grep -q "interdash"; then
    print_step "Reloading InterDash service in PM2..."
    pm2 restart interdash >/dev/null 2>&1 || start_pm2
    print_success "PM2 service refreshed with latest build"
  else
    start_pm2
  fi

  # Create global 'inter' command in PATH if writable
  if [ -d "/usr/local/bin" ] && ([ -w "/usr/local/bin" ] || [ "$(id -u)" -eq 0 ]); then
    ln -sf "$ROOT_DIR/inter" /usr/local/bin/inter 2>/dev/null || true
    ln -sf "$ROOT_DIR/inter.sh" /usr/local/bin/inter.sh 2>/dev/null || true
  fi

  print_header "Update Complete"
  echo -e "  ${WHITE_BOLD}InterDash successfully updated to ${REMOTE_HASH}!${NC}"
  echo ""
  echo -e "  ${WHITE}Check PM2 status:${NC} ${GRAY_LIGHT}pm2 status interdash${NC}"
  echo -e "  ${WHITE}Check logs:${NC}       ${GRAY_LIGHT}pm2 logs interdash${NC}"
  echo ""
}

# ------------------------------------------------------------------------------
# Dev Server Runner (Interactive foreground Vite server)
# ------------------------------------------------------------------------------
run_dev() {
  print_banner
  print_header "Starting Development Server"
  verify_system
  find_project_root
  cd "$VITE_DIR"
  print_step "Launching Vite dev server bound to 0.0.0.0:5173..."
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
    echo -e "    ${WHITE_BOLD}1${NC} ${GRAY_DARK}│${NC} 📦 ${WHITE}Auto-Installer${NC}   ${DIM}- Provision Node/PM2, setup .env, build & start daemon${NC}"
    echo -e "    ${WHITE_BOLD}2${NC} ${GRAY_DARK}│${NC} 🔄 ${WHITE}Auto-Updater${NC}     ${DIM}- Pull GitHub commits, refresh deps, rebuild & restart PM2${NC}"
    echo -e "    ${WHITE_BOLD}3${NC} ${GRAY_DARK}│${NC} 🚀 ${WHITE}PM2 Start/Reload${NC} ${DIM}- Launch or restart InterDash background daemon${NC}"
    echo -e "    ${WHITE_BOLD}4${NC} ${GRAY_DARK}│${NC} 🛑 ${WHITE}PM2 Stop${NC}         ${DIM}- Stop InterDash background daemon${NC}"
    echo -e "    ${WHITE_BOLD}5${NC} ${GRAY_DARK}│${NC} 📜 ${WHITE}PM2 Logs${NC}         ${DIM}- View live streaming application logs${NC}"
    echo -e "    ${WHITE_BOLD}6${NC} ${GRAY_DARK}│${NC} 🏗️  ${WHITE}Build Bundle${NC}     ${DIM}- Run full TypeScript compiler and production build${NC}"
    echo -e "    ${WHITE_BOLD}7${NC} ${GRAY_DARK}│${NC} 🔍 ${WHITE}System Status${NC}    ${DIM}- Check PM2, Node, Git, and service health${NC}"
    echo -e "    ${WHITE_BOLD}8${NC} ${GRAY_DARK}│${NC} 💻 ${WHITE}Vite Dev Mode${NC}    ${DIM}- Launch foreground dev server (hot-reload)${NC}"
    echo -e "    ${WHITE_BOLD}0${NC} ${GRAY_DARK}│${NC} ✕  ${WHITE}Exit${NC}"
    echo ""
    echo -e "${GRAY_DARK}  ─────────────────────────────────────────────────────────────${NC}"
    read -p "  Select an option [0-8]: " -r OPTION
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
        start_pm2
        read -p "  Press Enter to return to menu..."
        ;;
      4)
        stop_pm2
        read -p "  Press Enter to return to menu..."
        ;;
      5)
        logs_pm2
        ;;
      6)
        run_build
        read -p "  Press Enter to return to menu..."
        ;;
      7)
        status_pm2
        read -p "  Press Enter to return to menu..."
        ;;
      8)
        run_dev
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
  start|--start|-s)
    start_pm2
    ;;
  stop|--stop)
    stop_pm2
    ;;
  restart|--restart|-r)
    restart_pm2
    ;;
  logs|--logs|-l)
    logs_pm2
    ;;
  status)
    status_pm2
    ;;
  dev|--dev|-d)
    run_dev
    ;;
  build|--build|-b)
    run_build
    ;;
  patch-pve|--patch-pve)
    SCRIPT_PATH="$SCRIPT_DIR/scripts/patch-pve-termproxy.sh"
    if [ -f "$SCRIPT_PATH" ]; then
      bash "$SCRIPT_PATH"
    else
      curl -fsSL "https://raw.githubusercontent.com/xRosieRose/InterDash/main/scripts/patch-pve-termproxy.sh" | bash
    fi
    ;;
  help|--help|-h)
    print_banner
    echo -e "  ${WHITE_BOLD}Usage:${NC} ./inter.sh [command]"
    echo ""
    echo -e "  ${WHITE_BOLD}Commands:${NC}"
    echo -e "    ${WHITE}install,   --install,   -i${NC}  Run automated installation & start with PM2"
    echo -e "    ${WHITE}update,    --update,    -u${NC}  Pull latest changes from GitHub & reload PM2"
    echo -e "    ${WHITE}start,     --start,     -s${NC}  Launch or reload InterDash under PM2"
    echo -e "    ${WHITE}stop,      --stop${NC}          Stop InterDash PM2 daemon"
    echo -e "    ${WHITE}restart,   --restart,   -r${NC}  Restart InterDash PM2 daemon"
    echo -e "    ${WHITE}logs,      --logs,      -l${NC}  Stream real-time PM2 application logs"
    echo -e "    ${WHITE}status${NC}                  Show PM2 daemon and service status"
    echo -e "    ${WHITE}dev,       --dev,       -d${NC}  Start interactive Vite dev server (0.0.0.0:5173)"
    echo -e "    ${WHITE}build,     --build,     -b${NC}  Compile production distribution"
    echo -e "    ${WHITE}patch-pve, --patch-pve${NC}    Apply Proxmox termproxy API Token authentication patch"
    echo -e "    ${WHITE}help,      --help,      -h${NC}  Show this help reference"
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
