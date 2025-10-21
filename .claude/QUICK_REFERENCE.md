# Claude Code Quick Reference

## Common Commands

| Task | Command | Description |
|------|---------|-------------|
| Build everything | `/build` | Build all packages |
| Build specific | `/build core` | Build only core package |
| Start dev mode | `/dev` | Watch mode for development |
| Run tests | `/test` | Execute all tests |
| Check types | `/typecheck` | TypeScript type checking |
| Lint code | `/lint` | Run ESLint |
| Auto-fix lint | `/lint --fix` | Fix linting issues |
| Clean build | `/clean` | Remove build artifacts |
| Local CI check | `/ci` | Run full CI pipeline locally |
| Performance test | `/benchmark` | Measure build times |
| Setup project | `/setup` | Initial project setup |

## Quick Workflows

### Before Committing
```bash
/typecheck
/lint
/build
/test
```

Or just run:
```bash
/ci
```

### Starting Development
```bash
/setup      # First time only
/dev        # Start watch mode
```

### Creating a Feature
1. Ask: "Use the feature prompt"
2. Implement the feature
3. Run `/ci` to verify
4. Commit your changes

### Fixing a Bug
1. Ask: "Use the bugfix prompt"
2. Reproduce and fix
3. Add regression test
4. Run `/ci` to verify

### Refactoring Code
1. Ask: "Use the refactor prompt"
2. Make incremental changes
3. Run `/test` after each change
4. Run `/ci` when done

## Keyboard Shortcuts

- Type `/` to see available commands
- Press Tab to autocomplete commands
- Use arrow keys to navigate command history

## Environment Variables

Set these for full functionality:

```bash
export OPENAI_API_KEY=sk-your-key-here
export MILVUS_TOKEN=your-token-here
```

## Package-Specific Commands

### Core Package
```bash
/build core
/dev core
```

### MCP Package
```bash
/build mcp
/dev mcp
```

### VSCode Extension
```bash
/build vscode
/dev vscode
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Command not found | Run `/setup` or `pnpm install` |
| Build fails | Run `/clean` then `/build` |
| Type errors | Run `/typecheck` to see details |
| Lint errors | Run `/lint --fix` to auto-fix |
| Hook fails | Check `.claude/hooks/*.sh` logs |

## Advanced Usage

### Running Hooks Manually
```bash
./.claude/hooks/pre-commit.sh
./.claude/hooks/post-build.sh
./.claude/hooks/pre-release.sh
```

### Custom MCP Configuration
Edit `.claude/claude.json` to customize MCP server settings.

### Adding New Commands
Create new `.md` files in `.claude/commands/` directory.

## Learn More

- Full docs: `.claude/README.md`
- Project info: `.claude/project.md`
- Main README: `../README.md`
