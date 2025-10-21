Setup the development environment.

This command helps new contributors set up the project:

1. Verify prerequisites:
   - Node.js 20.x or 22.x
   - pnpm installed globally

2. Install dependencies:
   - Run pnpm install

3. Build all packages:
   - Run pnpm build

4. Verify setup:
   - Check that all dist directories exist
   - Verify no build errors

5. Setup environment variables:
   - Copy .env.example to .env if needed
   - Prompt for required API keys (OPENAI_API_KEY, MILVUS_TOKEN)

After setup, the developer should be able to run "pnpm dev" to start development.
