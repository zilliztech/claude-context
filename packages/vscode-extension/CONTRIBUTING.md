# Contributing to VSCode Extension

Thanks for your interest in contributing to the CodeIndexer VSCode extension!

> 📖 **First time contributing?** Please read the [main contributing guide](../../CONTRIBUTING.md) first for general setup and workflow.

## VSCode Extension Development

This guide covers development specific to the VSCode extension.

### Quick Commands
```bash
# Build VSCode extension
pnpm build:vscode

# Watch mode for development
pnpm dev:vscode

# Package extension
pnpm package
```

### Development Setup
Press `F5` to launch Extension Development Host

## Making Changes

1. Create a new branch for your feature/fix
2. Make changes in the `src/` directory
3. Run in the Extension Development Host
4. Follow commit guidelines in the [main guide](../../CONTRIBUTING.md)

## Project Structure

- `src/extension.ts` - Main extension entry point
- `src/` - Extension source code
- `resources/` - Icons and assets
- `package.json` - Extension manifest and commands
- `webpack.config.js` - Build configuration

## Development Workflow

1. Press `F5` in VSCode to open Extension Development Host
2. Try all commands and features
3. Check the Output panel for errors
4. Try with different project types

## Guidelines

- Follow VSCode extension best practices
- Use TypeScript for all code
- Keep UI responsive and non-blocking
- Provide user feedback for long operations
- Handle errors gracefully with user-friendly messages

## Extension Features

- Semantic code search within VSCode
- Integration with CodeIndexer core
- Progress indicators for indexing
- Search results in sidebar

## Working in VSCode

### Extension Development Host
- Press `F5` to open a new VSCode window with your extension loaded
- Try the extension in the new window with real codebases
- Check the Developer Console (`Help > Toggle Developer Tools`) for errors

### Manual Verification Checklist
- [ ] Index a sample codebase successfully
- [ ] Search returns relevant results
- [ ] UI components display correctly
- [ ] Configuration settings work properly
- [ ] Commands execute without errors

## Testing with .vsix Package

For a more robust pre-production test (safer than F5 development mode), you can package and install the extension locally:

```bash
# Navigate to extension directory
cd packages/vscode-extension

# Package the extension (remove existing .vsix file if present)
pnpm run package

# Uninstall any existing version
code --uninstall-extension semanticcodesearch-xxx.vsix

# Install the packaged extension
code --install-extension semanticcodesearch-xxx.vsix
```

After installation, the extension will be available in VSCode just like any marketplace extension. This method:
- Tests the actual packaged version
- Simulates real user installation experience
- Provides better isolation from development environment
- **Recommended for final testing before production release**

## Publishing

> **Note**: Only maintainers can publish to VS Code Marketplace

## Questions?

- **General questions**: See [main contributing guide](../../CONTRIBUTING.md)
- **VSCode-specific issues**: Open an issue with the `vscode` label 