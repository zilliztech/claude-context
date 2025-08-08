# Environment Variables Configuration

## 🎯 Global Configuration

Claude Context supports a global configuration file at `~/.context/.env` to simplify MCP setup across different MCP clients.

**Benefits:**
- Configure once, use everywhere
- No need to specify environment variables in each MCP client
- Cleaner MCP configurations

## 📋 Environment Variable Priority

1. **Process Environment Variables** (highest)
2. **Global Configuration File** (`~/.context/.env`)
3. **Default Values** (lowest)

## 🔧 Required Environment Variables

### Embedding Provider
| Variable | Description | Default |
|----------|-------------|---------|
| `EMBEDDING_PROVIDER` | Provider: `OpenAI`, `VoyageAI`, `Gemini`, `Ollama` | `OpenAI` |
| `OPENAI_API_KEY` | OpenAI API key | Required for OpenAI |
| `VOYAGEAI_API_KEY` | VoyageAI API key | Required for VoyageAI |
| `GEMINI_API_KEY` | Gemini API key | Required for Gemini |

### Vector Database
| Variable | Description | Default |
|----------|-------------|---------|
| `MILVUS_TOKEN` | Milvus authentication token. Get [Zilliz Personal API Key](https://github.com/zilliztech/claude-context/blob/master/assets/signup_and_get_apikey.png) | Recommended |
| `MILVUS_ADDRESS` | Milvus server address. Optional when using Zilliz Personal API Key | Auto-resolved from token |

### Ollama (Local)
| Variable | Description | Default |
|----------|-------------|---------|
| `OLLAMA_HOST` | Ollama server URL | `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | Model name | `nomic-embed-text` |

### Advanced Configuration
| Variable | Description | Default |
|----------|-------------|---------|
| `HYBRID_MODE` | Enable hybrid search (BM25 + dense vector). Set to `false` for dense-only search | `true` |
| `EMBEDDING_BATCH_SIZE` | Batch size for processing. Larger batch size means less indexing time | `100` |
| `SPLITTER_TYPE` | Code splitter type: `ast`, `langchain` | `ast` |
| `CUSTOM_EXTENSIONS` | Additional file extensions to include (comma-separated, e.g., `.vue,.svelte,.astro`) | None |
| `CUSTOM_IGNORE_PATTERNS` | Additional ignore patterns (comma-separated, e.g., `temp/**,*.backup,private/**`) | None |

## 🚀 Quick Setup

### 1. Create Global Config
```bash
mkdir -p ~/.context
cat > ~/.context/.env << 'EOF'
EMBEDDING_PROVIDER=OpenAI
OPENAI_API_KEY=sk-your-openai-api-key
MILVUS_TOKEN=your-zilliz-cloud-api-key
EOF
```

### 2. Simplified MCP Configuration

**Claude Code:**
```bash
claude mcp add claude-context -- npx @zilliz/claude-context-mcp@latest
```

**Cursor/Windsurf/Others:**
```json
{
  "mcpServers": {
    "claude-context": {
      "command": "npx",
      "args": ["-y", "@zilliz/claude-context-mcp@latest"]
    }
  }
}
```

## 📚 Additional Information

For detailed information about file processing rules and how custom patterns work, see:
- [What files does Claude Context decide to embed?](../troubleshooting/faq.md#q-what-files-does-claude-context-decide-to-embed)
 