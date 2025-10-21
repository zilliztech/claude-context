#!/bin/bash
# Pre-commit hook: Run linting and type checking before commits

set -e

echo "Running pre-commit checks..."

# Run type checking
echo "Type checking..."
pnpm typecheck

# Run linting
echo "Linting..."
pnpm lint

echo "Pre-commit checks passed!"
