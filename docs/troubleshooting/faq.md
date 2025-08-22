# Frequently Asked Questions (FAQ)

## Q: What files does Claude Context decide to embed?

**A:** Claude Context uses a comprehensive rule system to determine which files to include in indexing:

**Simple Rule:**
```
Final Files = (All Supported Extensions) - (All Ignore Patterns)
```

- **Extensions are additive**: Default extensions + MCP custom + Environment variables
- **Ignore patterns are additive**: Default patterns + MCP custom + Environment variables + .gitignore + .xxxignore files + global .contextignore

**For detailed explanation see:** [File Inclusion Rules](../dive-deep/file-inclusion-rules.md)

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

## Q: How does Claude Context compare to other coding tools like Serena, Context7, or DeepWiki?

**A:** Claude Context is specifically focused on **codebase indexing and semantic search**. Here's how we compare:

- **[Serena](https://github.com/oraios/serena)**: A comprehensive coding agent toolkit with language server integration and symbolic code understanding. Provides broader AI coding capabilities.

- **[Context7](https://github.com/upstash/context7)**: Focuses on providing up-to-date documentation and code examples to prevent "code hallucination" in LLMs. Targets documentation accuracy.

- **[DeepWiki](https://docs.devin.ai/work-with-devin/deepwiki-mcp)**: Generates interactive documentation from GitHub repositories. Creates documentation from code.

**Our focus**: Making your entire codebase searchable and contextually available to AI assistants through efficient vector-based indexing and hybrid search.

