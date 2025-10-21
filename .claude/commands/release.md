Release a package to npm and/or marketplace.

IMPORTANT: This should only be run by maintainers with proper credentials.

Release options:
- Release core package: "release core"
- Release MCP package: "release mcp"
- Release VSCode extension: "release vscode"

Pre-release checklist:
1. All tests passing
2. No linting errors
3. CHANGELOG updated
4. Version bumped in package.json
5. Git tag created (v* for stable, c* for canary)

The release process:
- Builds the package
- Runs prepublishOnly hooks
- Publishes to npm (core/mcp)
- Publishes to VS Code Marketplace (vscode)

Requires NPM_TOKEN and/or VSCE_PAT environment variables.
