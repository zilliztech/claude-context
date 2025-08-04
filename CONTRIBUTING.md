# Contributing to Claude Context

Thank you for your interest in contributing to Claude Context! This guide will help you get started.

## 🚀 Getting Started

### Prerequisites

- Node.js >= 20.0.0
- pnpm >= 10.0.0
- Git

### Development Setup

1. **Fork and Clone**
   ```bash
   git clone https://github.com/your-username/claude-context.git
   cd claude-context
   ```

2. **Install Dependencies**
   ```bash
   pnpm install
   ```

3. **Build All Packages**
   ```bash
   pnpm build
   ```

4. **Start Development Mode**
   ```bash
   pnpm dev
   ```

## 📁 Project Structure

```
claude-context/
├── packages/
│   ├── core/              # Core indexing engine
│   ├── vscode-extension/  # VSCode extension
│   └── mcp/              # Model Context Protocol server
├── examples/
│   └── basic-usage/      # Basic usage example 
```

### Package-Specific Development

Each package has its own development guide with specific instructions:

- **[Core Package](packages/core/CONTRIBUTING.md)** - Develop the core indexing engine
- **[VSCode Extension](packages/vscode-extension/CONTRIBUTING.md)** - Develop the VSCode extension
- **[MCP Server](packages/mcp/CONTRIBUTING.md)** - Develop the MCP protocol server

## 🛠️ Development Workflow

### Building All Packages

```bash
# Build all packages
pnpm build

# Clean and rebuild
pnpm clean && pnpm build

# Development mode (watch all packages)
pnpm dev
```

### Package-Specific Development

For detailed development instructions for each package, see:
- [Core Package Development](packages/core/CONTRIBUTING.md)
- [VSCode Extension Development](packages/vscode-extension/CONTRIBUTING.md)
- [MCP Server Development](packages/mcp/CONTRIBUTING.md)

## 📝 Making Changes

### Commit Guidelines

We follow conventional commit format:

```
type(scope): description

feat(core): add new embedding provider
fix(vscode): resolve search result display issue
docs(readme): update installation instructions
refactor(mcp): improve error handling
```

**Types**: `feat`, `fix`, `docs`, `refactor`, `perf`, `chore`

**Scopes**: `core`, `vscode`, `mcp`, `examples`, `docs`

### Pull Request Process

1. **Create Feature Branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make Your Changes**
   - Keep changes focused and atomic
   - Update documentation if needed

3. **Build and Verify**
   ```bash
   pnpm build
   ```

4. **Commit Your Changes**
   ```bash
   git add .
   git commit -m "feat(core): add your feature description"
   ```

5. **Push and Create PR**
   ```bash
   git push origin feature/your-feature-name
   ```

## 🎯 Contribution Areas

### Priority Areas

- **Core Engine**: Improve indexing performance and accuracy
- **Embedding Providers**: Add support for more embedding services
- **Vector Databases**: Extend database integration options
- **Documentation**: Improve examples and guides
- **Bug Fixes**: Fix reported issues

### Ideas for Contribution

- Add support for new programming languages
- Improve code chunking strategies
- Enhance search result ranking
- Add configuration options
- Create more usage examples

## 📋 Reporting Issues

When reporting bugs or requesting features:

1. **Check Existing Issues**: Search for similar issues first
2. **Use Templates**: Follow the issue templates when available
3. **Provide Context**: Include relevant details about your environment
4. **Steps to Reproduce**: Clear steps for reproducing bugs

## 💬 Getting Help

- **GitHub Issues**: For bugs and feature requests
- **GitHub Discussions**: For questions and general discussion

## 📄 License

By contributing to Claude Context, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to Claude Context! 🎉
