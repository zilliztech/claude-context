#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
NODE_VERSION="${NODE_VERSION:-22}"

log() {
  printf '[build-local-mcp] %s\n' "$*"
}

fail() {
  printf '[build-local-mcp] ERROR: %s\n' "$*" >&2
  exit 1
}

load_nvm() {
  if [[ -z "${NVM_DIR:-}" ]]; then
    export NVM_DIR="${HOME}/.nvm"
  fi

  if [[ ! -s "${NVM_DIR}/nvm.sh" ]]; then
    fail "nvm not found at ${NVM_DIR}/nvm.sh"
  fi

  # shellcheck source=/dev/null
  . "${NVM_DIR}/nvm.sh"
}

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    return
  fi

  if command -v corepack >/dev/null 2>&1; then
    corepack enable >/dev/null 2>&1 || true
  fi

  if ! command -v pnpm >/dev/null 2>&1; then
    fail "pnpm not found. Install pnpm >=10 (for example: npm i -g pnpm@10)"
  fi
}

main() {
  load_nvm
  nvm use --silent "${NODE_VERSION}" >/dev/null || fail "Node ${NODE_VERSION} is not installed in nvm"

  ensure_pnpm

  cd "${REPO_ROOT}"

  log "Repo: ${REPO_ROOT}"
  log "Node: $(node -v)"
  log "pnpm: $(pnpm -v)"

  # Avoid interactive pnpm "approve-builds" warnings in local bootstrap.
  pnpm install --ignore-scripts
  pnpm --filter @zilliz/claude-context-core build
  pnpm --filter @zilliz/claude-context-mcp build

  local mcp_entry="${REPO_ROOT}/packages/mcp/dist/index.js"
  [[ -f "${mcp_entry}" ]] || fail "build completed but ${mcp_entry} not found"

  log "Done. Local MCP entrypoint: ${mcp_entry}"
}

main "$@"
