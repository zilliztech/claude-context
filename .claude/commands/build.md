Build the project packages.

You can build all packages or specify a specific package (core, vscode, mcp, chrome).

Examples:
- Build all packages: "build" or "build all"
- Build specific package: "build core" or "build mcp"

Available build targets:
- core: @zilliz/claude-context-core
- vscode: VSCode extension
- mcp: MCP server package
- chrome: Chrome extension

After building, verify that the dist directories are created and contain the compiled files.
