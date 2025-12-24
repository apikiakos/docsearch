#!/bin/bash

# ============================================================================
# DOCSEARCH DEPLOYMENT SCRIPT
# ============================================================================
# Deploys DocSearch apps (web, api) to VPS.
# This script:
# 1. Commits and pushes local changes
# 2. Pulls latest code on VPS
# 3. Runs database migrations (one-shot Docker container)
# 4. Builds and deploys apps via vps-infra
#
# Prisma runs inside Docker containers, never on VPS shell.
#
# Usage:
#   ./scripts/deploy.sh [web|api|all] [VPS_HOST] [VPS_USER]
#
# Example:
#   ./scripts/deploy.sh all 46.224.45.144 alexandre
# ============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)/projects/docsearch"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
  echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

log_section() {
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}$1${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# Parse arguments
TARGET="${1:-all}"
VPS_HOST="${2:-${VPS_HOST:-46.224.45.144}}"
VPS_USER="${3:-${VPS_USER:-alexandre}}"

# Paths on VPS
VPS_INFRA_PATH="${VPS_INFRA_PATH:-/opt/platform/vps-infra}"
VPS_REPO_PATH="${VPS_REPO_PATH:-/opt/apps/docsearch}"

log_section "DOCSEARCH DEPLOYMENT"
log_info "Target: $TARGET"
log_info "VPS Host: $VPS_HOST"
log_info "VPS User: $VPS_USER"
log_info "VPS Repo Path: $VPS_REPO_PATH"
log_info "VPS Infra Path: $VPS_INFRA_PATH"

# Step 1: Commit and push local changes
log_section "Step 1: Committing and Pushing Changes"
cd "$REPO_DIR"
log_info "Staging changes..."
git add . || true
log_info "Committing changes..."
git commit -m "Deploy: $(date +%Y-%m-%d\ %H:%M:%S)" || log_warn "No changes to commit"
log_info "Pushing to GitHub..."
git push origin main || log_warn "Push failed or already up to date"
log_info "✓ Code pushed to GitHub"

# Step 2: Test SSH connection
log_section "Step 2: Testing SSH Connection"
if ssh -o ConnectTimeout=5 -o BatchMode=yes "${VPS_USER}@${VPS_HOST}" "echo 'SSH OK'" 2>/dev/null; then
  log_info "✅ SSH connection successful"
else
  log_error "❌ SSH connection failed"
  log_error "Please ensure:"
  log_error "  1. SSH key is added to VPS"
  log_error "  2. VPS_HOST and VPS_USER are correct"
  exit 1
fi

# Step 3: Pull latest code on VPS
log_section "Step 3: Pulling Latest Code on VPS"
log_info "Pulling DocSearch..."
ssh "${VPS_USER}@${VPS_HOST}" "
  set -e
  cd ${VPS_REPO_PATH}
  git stash || true
  git pull origin main
  git stash pop || true
" || log_error "Failed to pull code on VPS"

# Step 4: Setup networks (via vps-infra)
log_section "Step 4: Setting Up Infrastructure"
log_info "Setting up Docker networks..."
ssh "${VPS_USER}@${VPS_HOST}" "
  set -e
  cd ${VPS_INFRA_PATH}
  ./scripts/setup-networks.sh
" || log_error "Failed to setup networks"

# Step 5: Ensure infrastructure is running
log_info "Ensuring infrastructure services are running..."
ssh "${VPS_USER}@${VPS_HOST}" "
  set -e
  cd ${VPS_INFRA_PATH}
  docker compose -f compose/infra.compose.yml up -d --remove-orphans \
    platform-postgres \
    platform-redis \
    platform-elasticsearch || true
  sleep 5
" || log_error "Failed to start infrastructure"

# Step 6: Run migrations (one-shot Docker container)
log_section "Step 5: Running Database Migrations"
log_info "Running Prisma migrations in one-shot Docker container..."
ssh "${VPS_USER}@${VPS_HOST}" "
  set -e
  cd ${VPS_INFRA_PATH}
  # Run migrations using the migration service (one-shot container)
  docker compose -f compose/infra.compose.yml -f compose/apps.compose.yml \
    --profile migrate run --rm docsearch-migrate || echo '⚠️  Migrations may have failed or already applied'
" || log_warn "Migrations may have failed or already applied"

# Step 7: Build and deploy apps
log_section "Step 6: Building and Deploying Apps"

case "$TARGET" in
  web)
    log_info "Building and deploying docsearch-web..."
    ssh "${VPS_USER}@${VPS_HOST}" "
      set -e
      cd ${VPS_INFRA_PATH}
      docker compose -f compose/infra.compose.yml -f compose/apps.compose.yml build docsearch-web
      docker compose -f compose/infra.compose.yml -f compose/apps.compose.yml up -d --remove-orphans docsearch-web
    " || log_error "Failed to deploy web"
    ;;
  api)
    log_info "Building and deploying docsearch-api..."
    ssh "${VPS_USER}@${VPS_HOST}" "
      set -e
      cd ${VPS_INFRA_PATH}
      docker compose -f compose/infra.compose.yml -f compose/apps.compose.yml build docsearch-api
      docker compose -f compose/infra.compose.yml -f compose/apps.compose.yml up -d --remove-orphans docsearch-api
    " || log_error "Failed to deploy api"
    ;;
  all)
    log_info "Building and deploying all DocSearch apps..."
    ssh "${VPS_USER}@${VPS_HOST}" "
      set -e
      cd ${VPS_INFRA_PATH}
      docker compose -f compose/infra.compose.yml -f compose/apps.compose.yml build \
        docsearch-web \
        docsearch-api
      docker compose -f compose/infra.compose.yml -f compose/apps.compose.yml up -d --remove-orphans \
        docsearch-web \
        docsearch-api
    " || log_error "Failed to deploy apps"
    ;;
  *)
    log_error "Invalid target: $TARGET"
    log_error "Valid targets: web, api, all"
    exit 1
    ;;
esac

# Step 8: Verify deployment
log_section "Step 7: Verifying Deployment"
log_info "Waiting for services to start..."
sleep 10

log_info "Service status:"
ssh "${VPS_USER}@${VPS_HOST}" "
  cd ${VPS_INFRA_PATH}
  docker compose -f compose/apps.compose.yml ps | grep docsearch || true
"

log_section "DEPLOYMENT COMPLETE"
log_info "✅ DocSearch deployed successfully!"
log_info ""
log_info "Services:"
case "$TARGET" in
  web)
    log_info "  → Web: https://docsearch.artsbuilder.com"
    ;;
  api)
    log_info "  → API: Running (internal)"
    ;;
  all)
    log_info "  → Web: https://docsearch.artsbuilder.com"
    log_info "  → API: Running (internal)"
    ;;
esac
log_info ""
log_info "Check logs:"
log_info "  ssh ${VPS_USER}@${VPS_HOST} 'docker logs -f docsearch-<service>'"

