#!/bin/bash
# Post-build hook: Verify build outputs exist

set -e

echo "Verifying build outputs..."

# Check for core dist
if [ ! -d "packages/core/dist" ]; then
  echo "Error: packages/core/dist not found"
  exit 1
fi

# Check for MCP dist
if [ ! -d "packages/mcp/dist" ]; then
  echo "Error: packages/mcp/dist not found"
  exit 1
fi

# Check for VSCode extension dist
if [ ! -d "packages/vscode-extension/dist" ]; then
  echo "Error: packages/vscode-extension/dist not found"
  exit 1
fi

echo "All build outputs verified!"
