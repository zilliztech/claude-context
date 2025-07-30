# Frequently Asked Questions (FAQ)

## Q: What files does Code Context decide to embed?

**A:** Code Context embeds files based on the following rules:

**Files that are included:**
- Files with supported extensions (DEFAULT_SUPPORTED_EXTENSIONS)

**Files that are excluded:**
- Files matching DEFAULT_IGNORE_PATTERNS 
- Files matching patterns in .gitignore
- Files matching patterns in any .xxxignore files (e.g., .cursorignore, .codeiumignore)
- Files matching patterns in global ~/.codecontext/.codecontextignore

The final rule is: `DEFAULT_SUPPORTED_EXTENSIONS - (DEFAULT_IGNORE_PATTERNS + MCP_CUSTOM_PATTERNS + .gitignore + .xxxignore files + global .codecontextignore)`

**Ignore pattern merging (all patterns are combined):**
1. **Default patterns**: Built-in ignore patterns for common build outputs, dependencies, etc.
2. **MCP custom patterns**: Additional patterns passed via MCP `ignorePatterns` parameter 
3. **.gitignore**: Standard Git ignore patterns in codebase root
4. **.xxxignore files**: Any file in codebase root matching pattern `.xxxignore` (e.g., `.cursorignore`, `.codeiumignore`)
5. **Global ignore**: `~/.codecontext/.codecontextignore` for user-wide patterns

All patterns are merged together - MCP custom patterns will NOT be overwritten by file-based patterns.

Supported extensions include common programming languages (.ts, .js, .py, .java, .cpp, etc.) and documentation files (.md, .markdown). Default ignore patterns cover build outputs, dependencies (node_modules), IDE files, and temporary files.

**See the `DEFAULT_SUPPORTED_EXTENSIONS` and `DEFAULT_IGNORE_PATTERNS` definition:** [`packages/core/src/context.ts`](../../packages/core/src/context.ts)

## Q: Can I use a fully local deployment setup?

**A:** Yes, you can deploy Code Context entirely on your local infrastructure. While we recommend using the fully managed [Zilliz Cloud](https://cloud.zilliz.com/signup?utm_source=github&utm_medium=referral&utm_campaign=2507-codecontext-readme) service for ease of use, you can also set up your own private local deployment.

**For local deployment:**

1. **Vector Database (Milvus)**: Deploy Milvus locally using Docker Compose by following the [official Milvus installation guide](https://milvus.io/docs/install_standalone-docker-compose.md). Configure the following environment variables:
   - `MILVUS_ADDRESS=127.0.0.1:19530` (or your Milvus server address)
   - `MILVUS_TOKEN=your-optional-token` (if authentication is enabled)

2. **Embedding Service (Ollama)**: Install and run [Ollama](https://ollama.com/) locally for embedding generation. Configure:
   - `EMBEDDING_PROVIDER=Ollama`
   - `OLLAMA_HOST=http://127.0.0.1:11434` (or your Ollama server URL)
   - `OLLAMA_MODEL=nomic-embed-text` (or your preferred embedding model)

This setup gives you complete control over your data while maintaining full functionality. See our [environment variables guide](../getting-started/environment-variables.md) for detailed configuration options.

