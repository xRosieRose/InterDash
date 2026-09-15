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

# ------------------------------------------------------------------------------
# Release & Commit Channel Management Helpers
# ------------------------------------------------------------------------------
save_channel_state() {
  local channel="$1"
  local target="$2"
  find_project_root
  local state_file="${ROOT_DIR}/.interdash-channel"
  cat << EOF > "$state_file"
CHANNEL="$channel"
TARGET="$target"
UPDATED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date)"
EOF
  if [ -d "$VITE_DIR" ] && [ "$VITE_DIR" != "$ROOT_DIR" ]; then
    cp "$state_file" "$VITE_DIR/.interdash-channel" 2>/dev/null || true
  fi
}

detect_current_channel() {
  find_project_root
  CURRENT_CHANNEL=""
  CURRENT_TARGET=""

  local state_file="${ROOT_DIR}/.interdash-channel"
  if [ ! -f "$state_file" ] && [ -f "$VITE_DIR/.interdash-channel" ]; then
    state_file="$VITE_DIR/.interdash-channel"
  fi

  if [ -f "$state_file" ]; then
    CURRENT_CHANNEL=$(grep -E "^CHANNEL=" "$state_file" 2>/dev/null | cut -d= -f2 | tr -d ' "' || true)
    CURRENT_TARGET=$(grep -E "^TARGET=" "$state_file" 2>/dev/null | cut -d= -f2 | tr -d ' "' || true)
  fi

  if [ -d "$ROOT_DIR/.git" ]; then
    local exact_tag
    exact_tag=$(git -C "$ROOT_DIR" describe --tags --exact-match 2>/dev/null || true)
    if [ -n "$exact_tag" ]; then
      CURRENT_CHANNEL="release"
      CURRENT_TARGET="$exact_tag"
    elif [ -z "$CURRENT_CHANNEL" ]; then
      local cur_branch
      cur_branch=$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "$DEFAULT_BRANCH")
      if [ "$cur_branch" = "HEAD" ]; then
        CURRENT_CHANNEL="commit"
        CURRENT_TARGET=$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo "unknown")
      else
        CURRENT_CHANNEL="commit"
        CURRENT_TARGET="$cur_branch"
      fi
    fi
  else
    CURRENT_CHANNEL="${CURRENT_CHANNEL:-commit}"
    CURRENT_TARGET="${CURRENT_TARGET:-main}"
  fi
}

get_available_releases() {
  find_project_root
  if [ -d "$ROOT_DIR/.git" ]; then
    git -C "$ROOT_DIR" fetch --tags origin --quiet 2>/dev/null || true
    git -C "$ROOT_DIR" tag -l "v*" --sort=-v:refname 2>/dev/null || git -C "$ROOT_DIR" tag -l --sort=-v:refname 2>/dev/null
  else
    git ls-remote --tags "$REPO_URL" 2>/dev/null | awk -F'/' '{print $3}' | grep -E '^v[0-9]' | sort -V -r || true
  fi
}

get_latest_release() {
  local api_tag
  api_tag=$(curl -fsSL https://api.github.com/repos/xRosieRose/InterDash/releases/latest 2>/dev/null | grep -o '"tag_name": *"[^"]*"' | head -1 | cut -d'"' -f4 || true)
  if [ -n "$api_tag" ]; then
    echo "$api_tag"
    return 0
  fi

  local git_tag
  git_tag=$(get_available_releases | head -n 1 || true)
  if [ -n "$git_tag" ]; then
    echo "$git_tag"
    return 0
  fi

  echo "v1.0.0"
}

get_latest_commit_hash() {
  local branch="${1:-$DEFAULT_BRANCH}"
  find_project_root
  if [ -d "$ROOT_DIR/.git" ]; then
    git -C "$ROOT_DIR" fetch origin "$branch" --quiet 2>/dev/null || true
    git -C "$ROOT_DIR" rev-parse --short "origin/$branch" 2>/dev/null || echo "unknown"
  else
    git ls-remote "$REPO_URL" "refs/heads/$branch" 2>/dev/null | head -1 | awk '{print substr($1, 1, 7)}' || echo "unknown"
  fi
}

status_pm2() {
  print_banner
  print_header "PM2 Infrastructure & Version Status"
  detect_current_channel

  local local_sha="unknown"
  if [ -d "$ROOT_DIR/.git" ]; then
    local_sha=$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo "unknown")
  fi

  echo -e "  ${WHITE_BOLD}Source Channel:${NC}  ${WHITE}${CURRENT_CHANNEL}${NC} (${GRAY_LIGHT}${CURRENT_TARGET}${NC})"
  echo -e "  ${WHITE_BOLD}Local Commit:${NC}    ${GRAY_LIGHT}${local_sha}${NC}"

  if [ "$CURRENT_CHANNEL" = "release" ]; then
    local latest_rel
    latest_rel=$(get_latest_release)
    if [ "$CURRENT_TARGET" = "$latest_rel" ]; then
      echo -e "  ${WHITE_BOLD}Release Status:${NC}  ${WHITE_BOLD}Up to date${NC} (Latest: ${latest_rel})"
    else
      echo -e "  ${WHITE_BOLD}Release Status:${NC}  ${GRAY_LIGHT}New release available: ${WHITE_BOLD}${latest_rel}${NC}"
    fi
  else
    local remote_sha
    remote_sha=$(get_latest_commit_hash "${CURRENT_TARGET:-main}")
    if [ "$local_sha" = "$remote_sha" ]; then
      echo -e "  ${WHITE_BOLD}Commit Status:${NC}   ${WHITE_BOLD}Up to date${NC} (${remote_sha})"
    else
      echo -e "  ${WHITE_BOLD}Commit Status:${NC}   ${GRAY_LIGHT}New commits available: ${local_sha} → ${WHITE_BOLD}${remote_sha}${NC}"
    fi
  fi
  echo ""

  if command -v pm2 >/dev/null 2>&1; then
    pm2 status interdash 2>/dev/null || pm2 status
  else
    print_warn "PM2 is not installed."
  fi
}

# ------------------------------------------------------------------------------
# Auto Installer (Supports Release and Commit channels)
# ------------------------------------------------------------------------------
run_installer() {
  local mode="${1:-}"
  local target_ref="${2:-}"

  print_banner
  print_header "Automated Installation"

  # 1. Ensure all system packages and dependencies exist
  install_dependencies
  verify_system

  # 2. Determine Channel (Release vs Commit)
  local selected_channel="release"
  local target_checkout=""

  if [ "$mode" = "--release" ] || [ "$mode" = "-r" ] || [ "$mode" = "release" ]; then
    selected_channel="release"
    target_checkout="${target_ref:-}"
  elif [ "$mode" = "--commit" ] || [ "$mode" = "-c" ] || [ "$mode" = "commit" ]; then
    selected_channel="commit"
    target_checkout="${target_ref:-$DEFAULT_BRANCH}"
  else
    # Interactive prompt if in terminal
    if [ -t 0 ]; then
      echo -e "  ${WHITE_BOLD}Choose Installation Channel:${NC}"
      echo ""
      echo -e "    ${WHITE_BOLD}1${NC} ${GRAY_DARK}│${NC} 🏷️  ${WHITE}Stable Release${NC} ${DIM}- Pinned GitHub Release (v1.0.0, recommended for production)${NC}"
      echo -e "    ${WHITE_BOLD}2${NC} ${GRAY_DARK}│${NC} ⚡ ${WHITE}Latest Commit${NC}  ${DIM}- Cutting-edge main branch commits${NC}"
      echo -e "    ${WHITE_BOLD}3${NC} ${GRAY_DARK}│${NC} 🎯 ${WHITE}Specific Ref${NC}   ${DIM}- Enter a specific tag, branch, or commit SHA${NC}"
      echo ""
      read -p "  Select channel [1-3, default: 1]: " -r CH_CHOICE
      echo ""
      case "$CH_CHOICE" in
        2)
          selected_channel="commit"
          target_checkout="$DEFAULT_BRANCH"
          ;;
        3)
          read -p "  Enter tag, branch name, or commit SHA: " -r CUSTOM_REF
          if [ -n "$CUSTOM_REF" ]; then
            target_checkout="$CUSTOM_REF"
            if [[ "$CUSTOM_REF" =~ ^v[0-9] ]]; then
              selected_channel="release"
            else
              selected_channel="commit"
            fi
          else
            selected_channel="release"
          fi
          ;;
        *)
          selected_channel="release"
          ;;
      esac
    else
      # Non-interactive default to stable release
      selected_channel="release"
    fi
  fi

  # Resolve default target if not specified
  if [ "$selected_channel" = "release" ] && [ -z "$target_checkout" ]; then
    target_checkout=$(get_latest_release)
  elif [ "$selected_channel" = "commit" ] && [ -z "$target_checkout" ]; then
    target_checkout="$DEFAULT_BRANCH"
  fi

  print_step "Installation Channel: ${WHITE_BOLD}${selected_channel}${NC} (Target: ${GRAY_LIGHT}${target_checkout}${NC})"

  # 3. Verify or Clone Repository
  print_header "Repository Setup"
  find_project_root

  if [ ! -d "$VITE_DIR" ]; then
    TARGET_CLONE="$PWD/interdash"
    if [ -d "$TARGET_CLONE/vite-version" ]; then
      ROOT_DIR="$TARGET_CLONE"
      VITE_DIR="$TARGET_CLONE/vite-version"
      print_step "Using existing repository at: ${GRAY_LIGHT}$ROOT_DIR${NC}"
    else
      print_step "Cloning InterDash from ${GRAY_LIGHT}$REPO_URL${NC}..."
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

  # Checkout target release or commit
  cd "$ROOT_DIR"
  git fetch --tags origin --quiet 2>/dev/null || true

  if [ "$selected_channel" = "release" ]; then
    print_step "Checking out release tag: ${WHITE_BOLD}${target_checkout}${NC}..."
    git checkout "$target_checkout" --quiet 2>/dev/null || git checkout "tags/$target_checkout" --quiet
    save_channel_state "release" "$target_checkout"
  else
    print_step "Checking out commit/branch: ${WHITE_BOLD}${target_checkout}${NC}..."
    git checkout "$target_checkout" --quiet 2>/dev/null || git checkout -b "$target_checkout" "origin/$target_checkout" --quiet 2>/dev/null || true
    git pull origin "$target_checkout" --quiet 2>/dev/null || true
    local local_sha
    local_sha=$(git rev-parse --short HEAD 2>/dev/null || echo "$target_checkout")
    save_channel_state "commit" "$target_checkout"
  fi

  # 4. Setup Environment File (.env)
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

  # 5. Install Project Packages
  print_header "Installing Dependencies"
  cd "$VITE_DIR"
  print_step "Running $PKG_MGR install in $VITE_DIR..."
  if [ "$PKG_MGR" = "pnpm" ]; then
    pnpm install --prefer-frozen-lockfile 2>/dev/null || pnpm install
  else
    npm install --legacy-peer-deps
  fi
  print_success "Project dependencies installed successfully"

  # 6. Compile Production Distribution
  print_header "Building Production Bundle"
  print_step "Compiling distribution bundle..."
  if [ "$PKG_MGR" = "pnpm" ]; then
    pnpm run build
  else
    npm run build
  fi
  print_success "Production build completed"

  # 7. Start / Daemonize with PM2
  start_pm2

  # 8. Completion Summary
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
  echo -e "  ${WHITE}Channel:${NC}     ${WHITE_BOLD}${selected_channel}${NC} (${GRAY_LIGHT}${target_checkout}${NC})"
  echo -e "  ${WHITE}Access URL:${NC}  ${WHITE_BOLD}http://<your-server-ip>:${port_num}${NC}"
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
}

# ------------------------------------------------------------------------------
# Auto Updater (Supports Release and Commit channels)
# ------------------------------------------------------------------------------
run_updater() {
  local mode="${1:-}"
  local target_ref="${2:-}"

  print_banner
  print_header "Automated Updater"

  install_dependencies
  verify_system
  find_project_root

  if [ ! -d "$ROOT_DIR/.git" ]; then
    print_error "No existing Git repository found in $ROOT_DIR."
    exit 1
  fi

  detect_current_channel

  local channel="$CURRENT_CHANNEL"
  local target="$CURRENT_TARGET"

  if [ "$mode" = "--release" ] || [ "$mode" = "-r" ] || [ "$mode" = "release" ]; then
    channel="release"
    target="${target_ref:-}"
  elif [ "$mode" = "--commit" ] || [ "$mode" = "-c" ] || [ "$mode" = "commit" ]; then
    channel="commit"
    target="${target_ref:-$DEFAULT_BRANCH}"
  fi

  cd "$ROOT_DIR"

  # Stash local uncommitted changes
  local stashed=0
  if ! git diff-index --quiet HEAD -- 2>/dev/null; then
    print_warn "Stashing local changes..."
    git stash push -m "inter-updater-$(date +%s)" --quiet
    stashed=1
  fi

  if [ "$channel" = "release" ]; then
    print_step "Channel: ${WHITE_BOLD}Release${NC}"
    print_step "Fetching latest releases from GitHub..."
    git fetch --tags origin --quiet 2>/dev/null || true

    local latest_rel
    latest_rel=$(get_latest_release)
    local target_rel="${target:-$latest_rel}"
    local current_tag
    current_tag=$(git describe --tags --exact-match 2>/dev/null || echo "$CURRENT_TARGET")

    if [ "$current_tag" = "$target_rel" ] && [ -z "$target_ref" ]; then
      print_success "InterDash is already on the latest release tag (${WHITE_BOLD}${target_rel}${NC})"
      echo ""
      read -p "  Force reinstall dependencies and rebuild? (y/N): " -r FORCE_REBUILD
      if [[ ! $FORCE_REBUILD =~ ^[Yy]$ ]]; then
        if [ "$stashed" -eq 1 ]; then git stash pop --quiet 2>/dev/null || true; fi
        restart_pm2
        return 0
      fi
    else
      print_step "Updating release: ${GRAY_LIGHT}${current_tag}${NC} → ${WHITE_BOLD}${target_rel}${NC}..."
      git checkout "$target_rel" --quiet 2>/dev/null || git checkout "tags/$target_rel" --quiet
      save_channel_state "release" "$target_rel"
      print_success "Checked out release ${target_rel}"
    fi
  else
    local branch="${target:-$DEFAULT_BRANCH}"
    print_step "Channel: ${WHITE_BOLD}Commit (Branch: $branch)${NC}"
    print_step "Checking remote commits from GitHub..."

    git fetch origin "$branch" --quiet 2>/dev/null || true
    local local_hash
    local_hash=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
    local remote_hash
    remote_hash=$(git rev-parse --short "origin/$branch" 2>/dev/null || echo "unknown")

    if [ "$local_hash" = "$remote_hash" ] && [ -z "$target_ref" ]; then
      print_success "InterDash is already on the latest commit (${local_hash})"
      echo ""
      read -p "  Force reinstall dependencies and rebuild? (y/N): " -r FORCE_REBUILD
      if [[ ! $FORCE_REBUILD =~ ^[Yy]$ ]]; then
        if [ "$stashed" -eq 1 ]; then git stash pop --quiet 2>/dev/null || true; fi
        restart_pm2
        return 0
      fi
    else
      print_step "Updating commits: ${GRAY_MID}${local_hash}${NC} → ${WHITE_BOLD}${remote_hash}${NC}"
      git checkout "$branch" --quiet 2>/dev/null || true
      git pull origin "$branch" --quiet 2>/dev/null || true
      save_channel_state "commit" "$branch"
      print_success "Updated to latest commit ${remote_hash}"
    fi
  fi

  if [ "$stashed" -eq 1 ]; then
    print_step "Restoring stashed changes..."
    git stash pop --quiet 2>/dev/null || print_warn "Merge conflicts may require manual resolution"
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

  # Reload PM2 service
  print_header "Reloading PM2 Service"
  if command -v pm2 >/dev/null 2>&1 && pm2 list 2>/dev/null | grep -q "interdash"; then
    pm2 restart interdash >/dev/null 2>&1 || start_pm2
    print_success "PM2 service refreshed with latest build"
  else
    start_pm2
  fi

  print_header "Update Complete"
  echo -e "  ${WHITE_BOLD}InterDash successfully updated!${NC}"
  echo ""
}

# ------------------------------------------------------------------------------
# Channel Switcher (Switch between Release ↔ Commit)
# ------------------------------------------------------------------------------
switch_channel() {
  print_banner
  print_header "Switch Distribution Channel"
  detect_current_channel

  local target_channel="${1:-}"
  local target_ref="${2:-}"

  if [ -z "$target_channel" ]; then
    echo -e "  Current Channel: ${WHITE_BOLD}${CURRENT_CHANNEL}${NC} (${GRAY_LIGHT}${CURRENT_TARGET}${NC})"
    echo ""
    echo -e "    ${WHITE_BOLD}1${NC} ${GRAY_DARK}│${NC} 🏷️  ${WHITE}Switch to Stable Release Channel${NC} (e.g. v1.0.0)"
    echo -e "    ${WHITE_BOLD}2${NC} ${GRAY_DARK}│${NC} ⚡ ${WHITE}Switch to Latest Commit Channel${NC} (main branch)"
    echo ""
    read -p "  Select target channel [1-2]: " -r SW_CHOICE
    case "$SW_CHOICE" in
      1) target_channel="release" ;;
      2) target_channel="commit" ;;
      *) print_warn "Operation cancelled."; return 0 ;;
    esac
  fi

  if [ "$target_channel" = "release" ]; then
    local rel_tag="${target_ref:-}"
    if [ -z "$rel_tag" ]; then
      rel_tag=$(get_latest_release)
    fi
    print_step "Switching channel to Release (${WHITE_BOLD}${rel_tag}${NC})..."
    run_updater "--release" "$rel_tag"
  else
    local branch="${target_ref:-$DEFAULT_BRANCH}"
    print_step "Switching channel to Commit (${WHITE_BOLD}${branch}${NC})..."
    run_updater "--commit" "$branch"
  fi
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
    detect_current_channel
    echo -e "  ${GRAY_LIGHT}Channel:${NC} ${WHITE_BOLD}${CURRENT_CHANNEL}${NC} (${GRAY_LIGHT}${CURRENT_TARGET}${NC})"
    echo ""
    echo -e "  ${WHITE_BOLD}Infrastructure Operations:${NC}"
    echo ""
    echo -e "    ${WHITE_BOLD}1${NC} ${GRAY_DARK}│${NC} 📦 ${WHITE}Auto-Installer${NC}       ${DIM}- Install from Release (Stable) or Commit (Edge)${NC}"
    echo -e "    ${WHITE_BOLD}2${NC} ${GRAY_DARK}│${NC} 🔄 ${WHITE}Auto-Updater${NC}         ${DIM}- Update from current channel (Release or Commit)${NC}"
    echo -e "    ${WHITE_BOLD}3${NC} ${GRAY_DARK}│${NC} 🔀 ${WHITE}Switch Channel${NC}       ${DIM}- Switch between Release ↔ Commit channels${NC}"
    echo -e "    ${WHITE_BOLD}4${NC} ${GRAY_DARK}│${NC} 🚀 ${WHITE}PM2 Start/Reload${NC}     ${DIM}- Launch or restart InterDash background daemon${NC}"
    echo -e "    ${WHITE_BOLD}5${NC} ${GRAY_DARK}│${NC} 🛑 ${WHITE}PM2 Stop${NC}             ${DIM}- Stop InterDash background daemon${NC}"
    echo -e "    ${WHITE_BOLD}6${NC} ${GRAY_DARK}│${NC} 📜 ${WHITE}PM2 Logs${NC}             ${DIM}- View live streaming application logs${NC}"
    echo -e "    ${WHITE_BOLD}7${NC} ${GRAY_DARK}│${NC} 🏗️  ${WHITE}Build Bundle${NC}         ${DIM}- Run full TypeScript compiler and production build${NC}"
    echo -e "    ${WHITE_BOLD}8${NC} ${GRAY_DARK}│${NC} 🔍 ${WHITE}System Status${NC}        ${DIM}- Check channel, version, PM2, Node, Git health${NC}"
    echo -e "    ${WHITE_BOLD}9${NC} ${GRAY_DARK}│${NC} 💻 ${WHITE}Vite Dev Mode${NC}        ${DIM}- Launch foreground dev server (hot-reload)${NC}"
    echo -e "    ${WHITE_BOLD}0${NC} ${GRAY_DARK}│${NC} ✕  ${WHITE}Exit${NC}"
    echo ""
    echo -e "${GRAY_DARK}  ─────────────────────────────────────────────────────────────${NC}"
    read -p "  Select an option [0-9]: " -r OPTION
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
        switch_channel
        read -p "  Press Enter to return to menu..."
        ;;
      4)
        start_pm2
        read -p "  Press Enter to return to menu..."
        ;;
      5)
        stop_pm2
        read -p "  Press Enter to return to menu..."
        ;;
      6)
        logs_pm2
        ;;
      7)
        run_build
        read -p "  Press Enter to return to menu..."
        ;;
      8)
        status_pm2
        read -p "  Press Enter to return to menu..."
        ;;
      9)
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
    run_installer "${2:-}" "${3:-}"
    ;;
  update|--update|-u)
    run_updater "${2:-}" "${3:-}"
    ;;
  switch|switch-channel|--switch)
    switch_channel "${2:-}" "${3:-}"
    ;;
  channel|version|--version|-v)
    status_pm2
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
    echo -e "  ${WHITE_BOLD}Usage:${NC} ./inter.sh [command] [options]"
    echo ""
    echo -e "  ${WHITE_BOLD}Commands:${NC}"
    echo -e "    ${WHITE}install,   --install,   -i  [--release [tag] | --commit [ref]]${NC}"
    echo -e "                                Run installer from GitHub release or commit"
    echo -e "    ${WHITE}update,    --update,    -u  [--release [tag] | --commit [ref]]${NC}"
    echo -e "                                Update repository from release or commit channel"
    echo -e "    ${WHITE}switch,    --switch         [release|commit] [tag_or_ref]${NC}"
    echo -e "                                Switch between Release and Commit channels"
    echo -e "    ${WHITE}status,    channel,     -v${NC}  Show PM2 daemon, active channel, & git status"
    echo -e "    ${WHITE}start,     --start,     -s${NC}  Launch or reload InterDash under PM2"
    echo -e "    ${WHITE}stop,      --stop${NC}          Stop InterDash PM2 daemon"
    echo -e "    ${WHITE}restart,   --restart,   -r${NC}  Restart InterDash PM2 daemon"
    echo -e "    ${WHITE}logs,      --logs,      -l${NC}  Stream real-time PM2 application logs"
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

