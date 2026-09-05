#!/usr/bin/env bash
# Deploy ConfidentialPrizeVault + ConfidentialPrizePool and regenerate frontend ABIs.
#
# Usage:
#   ./scripts/deploy-vault.sh sepolia
#   ./scripts/deploy-vault.sh localhost        # requires `pnpm chain` running
#
# Env (auto-loaded from repo-root .env.local):
#   DEPLOYER_PRIVATE_KEY (or PRIVATE_KEY)  - deployer key, 0x-prefixed
#   KEEPER_ADDRESS                        - keeper address (required for sepolia)
#   SEPOLIA_RPC_URL                        - Sepolia RPC (sepolia target only)
#   ETHERSCAN_API_KEY                      - optional, enables --verify on Sepolia
set -euo pipefail

TARGET="${1:-localhost}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS_DIR="$REPO_ROOT/contracts"

if [[ -f "$REPO_ROOT/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env.local"
  set +a
fi

PK="${DEPLOYER_PRIVATE_KEY:-${PRIVATE_KEY:-}}"
: "${PK:?DEPLOYER_PRIVATE_KEY (or PRIVATE_KEY) is required (set in .env.local or shell)}"

RPC_URL=""
FORGE_ARGS=(script/DeployConfidentialPrizeVault.s.sol:DeployConfidentialPrizeVault --private-key "$PK" --broadcast)

case "$TARGET" in
  sepolia)
    : "${SEPOLIA_RPC_URL:=https://ethereum-sepolia-rpc.publicnode.com}"
    RPC_URL="$SEPOLIA_RPC_URL"
    FORGE_ARGS+=(--rpc-url "$RPC_URL")
    if [[ -n "${ETHERSCAN_API_KEY:-}" ]]; then
      FORGE_ARGS+=(--verify --etherscan-api-key "$ETHERSCAN_API_KEY")
    else
      echo "note: ETHERSCAN_API_KEY not set — skipping verification"
    fi
    ;;
  localhost)
    RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
    FORGE_ARGS+=(--rpc-url "$RPC_URL" --legacy)
    ;;
  *)
    echo "usage: $0 [sepolia|localhost]" >&2
    exit 1
    ;;
esac

cd "$CONTRACTS_DIR"
forge script "${FORGE_ARGS[@]}"

echo
echo "▸ Regenerating frontend ABIs + addresses"
cd "$REPO_ROOT"
pnpm generate

echo
echo "✅  Vault + pool deployed ($TARGET). Frontend contract files refreshed in nextjs/contracts/."
