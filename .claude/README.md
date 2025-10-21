# Claude Code Configuration

This directory contains the Claude Code configuration for the Claude Context project, providing full automation for development workflows.

## Directory Structure

```
.claude/
├── README.md           # This file
├── claude.json         # Main configuration file
├── project.md          # Project overview and context
├── commands/           # Slash commands for common tasks
│   ├── build.md
│   ├── test.md
│   ├── lint.md
│   ├── dev.md
│   ├── clean.md
│   ├── benchmark.md
│   ├── typecheck.md
│   ├── ci.md
│   ├── setup.md
│   └── release.md
├── hooks/              # Automation hooks
│   ├── pre-commit.sh
│   ├── post-build.sh
│   └── pre-release.sh
└── prompts/            # Workflow prompts
    ├── feature.md
    ├── bugfix.md
    └── refactor.md
```

## Slash Commands

Slash commands provide quick access to common development tasks:

### /build
Build all packages or specific ones.
```
/build           # Build all packages
/build core      # Build core package only
/build mcp       # Build MCP package only
```

### /test
Run tests for the project.
```
/test            # Run all tests
/test core       # Run core package tests
/test --coverage # Run with coverage
```

### /lint
Run ESLint across the codebase.
```
/lint            # Lint all files
/lint --fix      # Lint and auto-fix
```

### /dev
Start development mode with file watching.
```
/dev             # Dev mode for all packages
/dev core        # Dev mode for core package
```

### /clean
Clean all build artifacts.
```
/clean           # Remove all dist/ and cache files
```

### /benchmark
Run build performance benchmarks.
```
/benchmark       # Measure and track build times
```

### /typecheck
Run TypeScript type checking.
```
/typecheck       # Check types without building
```

### /ci
Run CI checks locally.
```
/ci              # Run full CI pipeline locally
```

### /setup
Setup development environment.
```
/setup           # Guide through project setup
```

### /release
Release packages (maintainers only).
```
/release core    # Release core package
/release mcp     # Release MCP package
/release vscode  # Release VSCode extension
```

## Automation Hooks

Hooks automatically run at specific points in your workflow:

### pre-commit.sh
Runs before git commits to ensure code quality.
- Type checking with `pnpm typecheck`
- Linting with `pnpm lint`

### post-build.sh
Runs after builds to verify outputs.
- Checks that all dist/ directories exist
- Validates build artifacts

### pre-release.sh
Runs before releases to ensure quality.
- Clean build
- Full dependency install
- Type checking
- Linting
- Tests (if available)

## Workflow Prompts

Prompts guide you through common development workflows:

### feature.md
Guide for implementing new features:
- Understanding requirements
- Choosing the right package
- Writing type-safe code
- Testing and documentation
- CI checks and commits

### bugfix.md
Guide for fixing bugs:
- Reproducing the bug
- Finding root cause
- Implementing the fix
- Adding regression tests
- Verification

### refactor.md
Guide for refactoring code:
- Identifying code smells
- Planning improvements
- Making safe incremental changes
- Maintaining backward compatibility
- Testing throughout

## Usage in Claude Code

### Enable Slash Commands
Slash commands are automatically available when this configuration is present. Just type `/` followed by the command name.

### Configure Hooks
To enable automation hooks, configure them in your Claude Code settings or run them manually:

```bash
# Pre-commit checks
./.claude/hooks/pre-commit.sh

# Post-build verification
./.claude/hooks/post-build.sh

# Pre-release checks
./.claude/hooks/pre-release.sh
```

### Use Workflow Prompts
Reference prompts when working on specific tasks:
- "Use the feature prompt to guide me"
- "Follow the bugfix workflow"
- "Apply the refactor guidelines"

## MCP Server Configuration

The `claude.json` includes MCP server configuration for using Claude Context within Claude Code:

```json
{
  "mcpServers": {
    "claude-context": {
      "command": "npx",
      "args": ["@zilliz/claude-context-mcp@latest"],
      "env": {
        "OPENAI_API_KEY": "${OPENAI_API_KEY}",
        "MILVUS_TOKEN": "${MILVUS_TOKEN}"
      }
    }
  }
}
```

Set these environment variables:
- `OPENAI_API_KEY`: Your OpenAI API key for embeddings
- `MILVUS_TOKEN`: Your Zilliz Cloud API key for vector storage

## Best Practices

1. **Use slash commands** for common tasks instead of typing long commands
2. **Run /ci locally** before pushing to catch issues early
3. **Follow workflow prompts** for consistency across the team
4. **Let hooks run** - they catch issues before they reach CI
5. **Keep hooks fast** - if they're slow, developers will skip them

## Customization

Feel free to customize this configuration:

- Add new slash commands in `commands/`
- Create additional hooks in `hooks/`
- Add workflow prompts in `prompts/`
- Update `claude.json` with new configurations

## Troubleshooting

### Hooks not running
- Ensure hooks are executable: `chmod +x .claude/hooks/*.sh`
- Check that the shebang is correct: `#!/bin/bash`

### Commands not found
- Verify pnpm is installed: `pnpm --version`
- Check you're in the project root directory
- Ensure dependencies are installed: `pnpm install`

### MCP server not connecting
- Verify environment variables are set
- Check Node.js version (requires 20.x or 22.x)
- See the main README for detailed MCP setup

## Contributing

When adding new automation:
1. Document it in this README
2. Add examples and usage instructions
3. Test on multiple platforms (Windows, Linux, macOS)
4. Keep scripts cross-platform compatible

## Learn More

- [Claude Code Documentation](https://docs.anthropic.com/en/docs/claude-code)
- [MCP Documentation](https://modelcontextprotocol.io/)
- [Project Main README](../README.md)
- [Contributing Guide](../CONTRIBUTING.md)
