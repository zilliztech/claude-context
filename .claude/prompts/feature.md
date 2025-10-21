You are implementing a new feature for Claude Context.

## Steps:
1. **Understand the feature request**: Clarify requirements and scope
2. **Design the solution**: Consider architecture and package placement
3. **Choose the right package**:
   - Core functionality → packages/core
   - MCP tools → packages/mcp
   - VSCode features → packages/vscode-extension
   - Browser features → packages/chrome-extension
4. **Write type-safe code**: Use TypeScript properly, avoid 'any'
5. **Follow project patterns**: Review existing code for consistency
6. **Add documentation**: Update README and add JSDoc comments
7. **Test the feature**: Write tests and manual testing
8. **Run CI checks**: `pnpm lint`, `pnpm typecheck`, `pnpm build`
9. **Create commit**: Follow conventional commits format

## Coding Standards:
- Use TypeScript strict mode
- Add proper error handling
- Follow existing code style
- Add meaningful comments for complex logic
- Export public APIs properly
- Use dependency injection for testability

## Testing:
- Add unit tests for core logic
- Add integration tests for MCP tools
- Test edge cases and error conditions
- Verify cross-platform compatibility (Windows/Linux/Mac)

## Documentation:
- Update package README if needed
- Add JSDoc comments for public APIs
- Update examples if relevant
- Update main README for user-facing features
