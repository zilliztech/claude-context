Run CI checks locally before pushing.

This simulates the GitHub Actions CI pipeline:
1. Install dependencies (pnpm install)
2. Build all packages (pnpm build)
3. Run type checking (pnpm typecheck)
4. Run linting (pnpm lint)
5. Run tests (pnpm test)
6. Verify build outputs exist

Use this to catch CI failures before pushing to the remote repository.
