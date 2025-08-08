# Frequently Asked Questions (FAQ)

## Q: What files does Claude Context decide to embed?

**A:** Claude Context embeds files based on the following rules:

**Files that are included:**
- Files with supported extensions from multiple sources:
  - DEFAULT_SUPPORTED_EXTENSIONS (built-in defaults)
  - MCP custom extensions (via `customExtensions` parameter)
  - Environment variable custom extensions (via `CUSTOM_EXTENSIONS`)

**Files that are excluded:**
- Files matching ignore patterns from multiple sources:
  - DEFAULT_IGNORE_PATTERNS (built-in defaults)
  - MCP custom ignore patterns (via `ignorePatterns` parameter)
  - Environment variable custom ignore patterns (via `CUSTOM_IGNORE_PATTERNS`)
  - Files matching patterns in .gitignore
  - Files matching patterns in any .xxxignore files (e.g., .cursorignore, .codeiumignore)
  - Files matching patterns in global ~/.context/.contextignore

The final rule is: `(DEFAULT_SUPPORTED_EXTENSIONS + MCP custom extensions + custom extensions from env variable) - (DEFAULT_IGNORE_PATTERNS + MCP custom ignore patterns + custom ignore patterns from env variable + .gitignore + .xxxignore files + global .contextignore)`

**Extension sources (all patterns are combined):**
1. **Default extensions**: Built-in supported file extensions (.ts, .js, .py, .java, .cpp, .md, etc.)
2. **MCP custom extensions**: Additional extensions passed via MCP `customExtensions` parameter
3. **Environment custom extensions**: Extensions from `CUSTOM_EXTENSIONS` env variable (comma-separated, e.g., `.vue,.svelte,.astro`)

**Ignore pattern sources (all patterns are combined):**
1. **Default patterns**: Built-in ignore patterns for common build outputs, dependencies, etc.
2. **MCP custom ignore patterns**: Additional patterns passed via MCP `ignorePatterns` parameter
3. **Environment custom ignore patterns**: Patterns from `CUSTOM_IGNORE_PATTERNS` env variable (comma-separated)
4. **.gitignore**: Standard Git ignore patterns in codebase root
5. **.xxxignore files**: Any file in codebase root matching pattern `.xxxignore` (e.g., `.cursorignore`, `.codeiumignore`)
6. **Global ignore**: `~/.context/.contextignore` for user-wide patterns

All patterns are merged together - MCP custom patterns and environment variables will NOT be overwritten by file-based patterns.

**Environment Variables:**
- `CUSTOM_EXTENSIONS`: Comma-separated list of file extensions (e.g., `.vue,.svelte,.astro`)
- `CUSTOM_IGNORE_PATTERNS`: Comma-separated list of ignore patterns (e.g., `temp/**,*.backup,private/**`)

These environment variables can be set in:
- System environment variables (highest priority)
- Global `~/.context/.env` file (lower priority)

Supported extensions include common programming languages (.ts, .js, .py, .java, .cpp, etc.) and documentation files (.md, .markdown). Default ignore patterns cover build outputs, dependencies (node_modules), IDE files, and temporary files.

**See the `DEFAULT_SUPPORTED_EXTENSIONS` and `DEFAULT_IGNORE_PATTERNS` definition:** [`packages/core/src/context.ts`](../../packages/core/src/context.ts)

## Q: Can I use a fully local deployment setup?

**A:** Yes, you can deploy Claude Context entirely on your local infrastructure. While we recommend using the fully managed [Zilliz Cloud](https://cloud.zilliz.com/signup?utm_source=github&utm_medium=referral&utm_campaign=2507-codecontext-readme) service for ease of use, you can also set up your own private local deployment.

**For local deployment:**

1. **Vector Database (Milvus)**: Deploy Milvus locally using Docker Compose by following the [official Milvus installation guide](https://milvus.io/docs/install_standalone-docker-compose.md). Configure the following environment variables:
   - `MILVUS_ADDRESS=127.0.0.1:19530` (or your Milvus server address)
   - `MILVUS_TOKEN=your-optional-token` (if authentication is enabled)

2. **Embedding Service (Ollama)**: Install and run [Ollama](https://ollama.com/) locally for embedding generation. Configure:
   - `EMBEDDING_PROVIDER=Ollama`
   - `OLLAMA_HOST=http://127.0.0.1:11434` (or your Ollama server URL)
   - `OLLAMA_MODEL=nomic-embed-text` (or your preferred embedding model)

This setup gives you complete control over your data while maintaining full functionality. See our [environment variables guide](../getting-started/environment-variables.md) for detailed configuration options.

## Q: Does it support multiple projects / codebases?

**A:** Yes, Claude Context fully supports multiple projects and codebases. In MCP mode, it automatically leverages the MCP client's AI Agent to detect and obtain the current codebase path where you're working.

You can seamlessly use queries like `index this codebase` or `search the main function` without specifying explicit paths. When you switch between different codebase working directories, Claude Context automatically discovers the change and adapts accordingly - no need to manually input specific codebase paths.

**Key features for multi-project support:**
- **Automatic Path Detection**: Leverages MCP client's workspace awareness to identify current working directory
- **Seamless Project Switching**: Automatically detects when you switch between different codebases
- **Background Code Synchronization**: Continuously monitors for changes and automatically re-indexes modified parts
- **Context-Aware Operations**: All indexing and search operations are scoped to the current project context

This makes it effortless to work across multiple projects while maintaining isolated, up-to-date indexes for each codebase.

