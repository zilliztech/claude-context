#!/bin/bash
# Pre-release hook: Run full CI checks before releasing

set -e

echo "Running pre-release checks..."

# Clean build
echo "Cleaning..."
pnpm clean

# Install dependencies
echo "Installing dependencies..."
pnpm install

# Build
echo "Building..."
pnpm build

# Type check
echo "Type checking..."
pnpm typecheck

# Lint
echo "Linting..."
pnpm lint

# Test (if test script exists)
if grep -q '"test"' package.json; then
  echo "Running tests..."
  pnpm test
fi

echo "Pre-release checks passed! Ready to release."
