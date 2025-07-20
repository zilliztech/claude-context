# 🔍 Code Context

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org/)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/zilliz.semanticcodesearch?label=VS%20Code%20Extension&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=zilliz.semanticcodesearch)
[![npm - core](https://img.shields.io/npm/v/@zilliz/code-context-core?label=%40zilliz%2Fcode-context-core&logo=npm)](https://www.npmjs.com/package/@zilliz/code-context-core)
[![npm - mcp](https://img.shields.io/npm/v/@zilliz/code-context-mcp?label=%40zilliz%2Fcode-context-mcp&logo=npm)](https://www.npmjs.com/package/@zilliz/code-context-mcp)
[![Twitter](https://img.shields.io/twitter/url/https/twitter.com/zilliz_universe.svg?style=social&label=Follow%20%40Zilliz)](https://twitter.com/zilliz_universe)
[![DeepWiki](https://img.shields.io/badge/DeepWiki-AI%20Docs-purple.svg?logo=gitbook&logoColor=white)](https://deepwiki.com/zilliztech/code-context)
<a href="https://discord.gg/mKc3R95yE5"><img height="20" src="https://img.shields.io/badge/Discord-%235865F2.svg?style=for-the-badge&logo=discord&logoColor=white" alt="discord" /></a>

**Code Context** is an MCP plugin for semantic code search for Claude Code, Gemini CLI, or Cursor. It adds semantic search and code analysis, providing improved context awareness in code generation.

This plugin allows your coding assistant to perform semantic searches on your codebase, enabling it to answer questions and generate code with a deeper understanding of the project's context. For example, you can ask *"Where are all the authentication checks?"* and the agent will find the relevant code snippets based on meaning, not just keyword matches.

- **Search code by meaning, not just keywords**—thanks to powerful embedding models and Zilliz Cloud vector database integration.
- **Understand and navigate massive codebases** with semantic search, context-aware discovery, and AI-powered code writing.
- **Accelerate your workflow** by combining the best of Gemini CLI's AI capabilities with deep, actionable code insights.

> *"Code Context is a tool for code comprehension, search, and development. Unlock the full potential of your codebase, no matter its size."*

---

## 🌟 Why Code Context?

In the era of AI-first development, codebases are growing faster than ever. Traditional tools can't keep up:

- **Claude Code** or **Gemini CLI** lacked full context of the entire codebase. No LLM can fit millions of lines of code in context, and `grep` doesn't work unless you can remember all variable names.
- **Code Context** provides semantic search, allowing you to find, understand, and reuse code using natural language rather than just `grep`. It offers true context awareness by understanding relationships, structure, and intent across your entire codebase.
- **Powered by Zilliz Cloud**, you get blazing-fast, scalable vector search for all your code.

**Code Context provides the essential connection between AI code generation and understanding a codebase.**

---

## 🚀 Quick Start: MCP Integration

Model Context Protocol (MCP) allows you to integrate Code Context with your favorite AI coding assistants.

### Prerequisites

- Node.js >= 20.0.0
- pnpm >= 10.0.0
- (Optional) Milvus database
- (Optional) API key for OpenAI, VoyageAI, or other embedding providers.

### Environment Variables (Optional)

If you want to use cloud embedding/vector DBs:

```bash
OPENAI_API_KEY=your-openai-api-key
MILVUS_ADDRESS=your-milvus-endpoint
MILVUS_TOKEN=your-milvus-token
```

### Configure MCP for your AI Assistant

#### Gemini CLI

Gemini CLI requires manual configuration through a JSON file:

1. Create or edit the `~/.gemini/settings.json` file.
2. Add the following configuration:

```json
{
  "mcpServers": {
    "code-context": {
      "command": "npx",
      "args": ["@zilliz/code-context-mcp@latest"],
      "env": {
        "OPENAI_API_KEY": "your-openai-api-key",
        "MILVUS_ADDRESS": "localhost:19530"
      }
    }
  }
}
```
3. Save the file and restart Gemini CLI to apply the changes.

#### Claude Code

Use the command line interface to add the Code Context MCP server:

```bash
# Add the Code Context MCP server
claude mcp add code-context -e OPENAI_API_KEY=your-openai-api-key -e MILVUS_ADDRESS=localhost:19530 -- npx @zilliz/code-context-mcp@latest
```

See the [Claude Code MCP documentation](https://docs.anthropic.com/en/docs/claude-code/mcp) for more details about MCP server management.

<details>
<summary><strong>Other MCP Client Configurations (Cursor, Windsurf, etc.)</strong></summary>

<details>
<summary><strong>Cursor</strong></summary>

<a href="https://cursor.com/install-mcp?name=code-context&config=JTdCJTIyY29tbWFuZCUyMiUzQSUyMm5weCUyMC15JTIwJTQwemlsbGl6JTJGY29kZS1jb250ZXh0LW1jcCU0MGxhdGVzdCUyMiUyQyUyMmVudiUyMiUzQSU3QiUyMk9QRU5BSV9BUElfS0VZJTIyJTNBJTIyeW91ci1vcGVuYWktYXBpLWtleSUyMiUyQyUyMk1JTFZVU19BRERSRVNTJTIyJTNBJTIybG9jYWxob3N0JTNBMTk1MzAlMjIlN0QlN0Q%3D"><img src="https://cursor.com/deeplink/mcp-install-dark.svg" alt="Add code-context MCP server to Cursor" height="32" /></a>

Go to: `Settings` -> `Cursor Settings` -> `MCP` -> `Add new global MCP server`

Pasting the following configuration into your Cursor `~/.cursor/mcp.json` file is the recommended approach. You may also install in a specific project by creating `.cursor/mcp.json` in your project folder. See [Cursor MCP docs](https://docs.cursor.com/context/model-context-protocol) for more info.

```json
{
  "mcpServers": {
    "code-context": {
      "command": "npx",
      "args": ["-y", "@zilliz/code-context-mcp@latest"],
      "env": {
        "OPENAI_API_KEY": "your-openai-api-key",
        "OPENAI_BASE_URL": "https://your-custom-endpoint.com/v1",
        "MILVUS_ADDRESS": "localhost:19530"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>Claude Desktop</strong></summary>

Add to your Claude Desktop configuration:

```json
{
  "mcpServers": {
    "code-context": {
      "command": "npx",
      "args": ["@zilliz/code-context-mcp@latest"],
      "env": {
        "OPENAI_API_KEY": "your-openai-api-key",
        "OPENAI_BASE_URL": "https://your-custom-endpoint.com/v1",
        "MILVUS_ADDRESS": "localhost:19530"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>Windsurf</strong></summary>

Windsurf supports MCP configuration through a JSON file. Add the following configuration to your Windsurf MCP settings:

```json
{
  "mcpServers": {
    "code-context": {
      "command": "npx",
      "args": ["-y", "@zilliz/code-context-mcp@latest"],
      "env": {
        "OPENAI_API_KEY": "your-openai-api-key",
        "OPENAI_BASE_URL": "https://your-custom-endpoint.com/v1",
        "MILVUS_ADDRESS": "localhost:19530"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>VS Code</strong></summary>

The Code Context MCP server can be used with VS Code through MCP-compatible extensions. Add the following configuration to your VS Code MCP settings:

```json
{
  "mcpServers": {
    "code-context": {
      "command": "npx",
      "args": ["-y", "@zilliz/code-context-mcp@latest"],
      "env": {
        "OPENAI_API_KEY": "your-openai-api-key",
        "OPENAI_BASE_URL": "https://your-custom-endpoint.com/v1",
        "MILVUS_ADDRESS": "localhost:19530"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>Cherry Studio</strong></summary>

Cherry Studio allows for visual MCP server configuration through its settings interface. While it doesn't directly support manual JSON configuration, you can add a new server via the GUI:

1. Navigate to **Settings → MCP Servers → Add Server**.
2. Fill in the server details:
   - **Name**: `code-context`
   - **Type**: `STDIO`
   - **Command**: `npx`
   - **Arguments**: `["@zilliz/code-context-mcp@latest"]`
   - **Environment Variables**:
     - `OPENAI_API_KEY`: `your-openai-api-key`
     - `OPENAI_BASE_URL`: `https://your-custom-endpoint.com/v1` (optional)
     - `MILVUS_ADDRESS`: `localhost:19530`
3. Save the configuration to activate the server.

</details>

<details>
<summary><strong>Cline</strong></summary>

Cline uses a JSON configuration file to manage MCP servers. To integrate the provided MCP server configuration:

1. Open Cline and click on the **MCP Servers** icon in the top navigation bar.

2. Select the **Installed** tab, then click **Advanced MCP Settings**.

3. In the `cline_mcp_settings.json` file, add the following configuration:

```json
{
  "mcpServers": {
    "code-context": {
      "command": "npx",
      "args": ["@zilliz/code-context-mcp@latest"],
      "env": {
        "OPENAI_API_KEY": "your-openai-api-key",
        "OPENAI_BASE_URL": "https://your-custom-endpoint.com/v1",
        "MILVUS_ADDRESS": "localhost:19530"
      }
    }
  }
}
```

4. Save the file.

</details>

<details>
<summary><strong>Augment</strong></summary>

To configure Code Context MCP in Augment Code, you can use either the graphical interface or manual configuration.

#### **A. Using the Augment Code UI**

1. Click the hamburger menu.

2. Select **Settings**.

3. Navigate to the **Tools** section.

4. Click the **+ Add MCP** button.

5. Enter the following command:

   ```
   npx @zilliz/code-context-mcp@latest
   ```

6. Name the MCP: **Code Context**.

7. Click the **Add** button.

------

#### **B. Manual Configuration**

1. Press Cmd/Ctrl Shift P or go to the hamburger menu in the Augment panel
2. Select Edit Settings
3. Under Advanced, click Edit in settings.json
4. Add the server configuration to the `mcpServers` array in the `augment.advanced` object

```json
"augment.advanced": { 
  "mcpServers": [ 
    { 
      "name": "code-context", 
      "command": "npx", 
      "args": ["-y", "@zilliz/code-context-mcp@latest"],
      "env": {
        "OPENAI_API_KEY": "your-openai-api-key",
        "OPENAI_BASE_URL": "https://your-custom-endpoint.com/v1",
        "MILVUS_ADDRESS": "localhost:19530"
      }
    }
  ]
}
```

</details>

<details>
<summary><strong>Roo Code</strong></summary>

Roo Code utilizes a JSON configuration file for MCP servers:

1. Open Roo Code and navigate to **Settings → MCP Servers → Edit Global Config**.

2. In the `mcp_settings.json` file, add the following configuration:

```json
{
  "mcpServers": {
    "code-context": {
      "command": "npx",
      "args": ["@zilliz/code-context-mcp@latest"],
      "env": {
        "OPENAI_API_KEY": "your-openai-api-key",
        "OPENAI_BASE_URL": "https://your-custom-endpoint.com/v1",
        "MILVUS_ADDRESS": "localhost:19530"
      }
    }
  }
}
```

3. Save the file to activate the server.

</details>


<details>
<summary><strong>Other MCP Clients</strong></summary>

The server uses stdio transport and follows the standard MCP protocol. It can be integrated with any MCP-compatible client by running:

```bash
npx @zilliz/code-context-mcp@latest
```

</details>

</details>

---

## ✨ Features

- 🔍 **Semantic Code Search**: Ask questions like *"find functions that handle user authentication"* and get relevant, context-rich code instantly.
-  **Context-Aware Discovery**: Understand how different parts of your codebase relate, even across millions of lines.
-  **AI-Assisted Programming**: Generate, refactor, or extend code using natural language prompts.
-  **Local & Cloud Indexing**: Index your codebase locally or leverage Zilliz Cloud for scalable, privacy-respecting search.
- ⚡ **Incremental File Synchronization**: Efficiently re-index only changed files using Merkle trees.
-  **Smart Chunking**: AST-based code splitting for context-preserving search and generation.
-  **Productivity**: Reduce time spent searching and writing boilerplate code—focus on what matters.
-  **Pluggable Embedding Providers**: Support for OpenAI, VoyageAI, Ollama, and more.
-  **Vector Storage**: Integrates with Zilliz Cloud for scalable vector search, no matter how large your codebase is.
-  **Customizable**: Configure file extensions, ignore patterns, and embedding models.

---

## 🏗️ Architecture
![](assets/Architecture.png)

Code Context is a monorepo containing three main packages:

### Core Components

- **`@zilliz/code-context-core`**: Core indexing engine with embedding and vector database integration
- **VSCode Extension**: Semantic Code Search extension for Visual Studio Code
- **`@zilliz/code-context-mcp`**: Model Context Protocol server for AI agent integration

### Supported Technologies
- **Embedding Providers**: [OpenAI](https://openai.com), [VoyageAI](https://voyageai.com), [Ollama](https://ollama.ai)
- **Vector Databases**: [Milvus](https://milvus.io) or [Zilliz Cloud](https://zilliz.com/cloud)(fully managed vector database as a service)
- **Code Splitters**: AST-based splitter (with automatic fallback), LangChain character-based splitter
- **Languages**: TypeScript, JavaScript, Python, Java, C++, C#, Go, Rust, PHP, Ruby, Swift, Kotlin, Scala, Markdown
- **Development Tools**: VSCode, Model Context Protocol

---

## 📦 Other Ways to Use Code Context

While MCP is the recommended way to use Code Context with AI assistants, you can also use it directly or through the VSCode extension.

### Core Package Usage

The `@zilliz/code-context-core` package provides the fundamental functionality for code indexing and semantic search.

```typescript
import { CodeIndexer, MilvusVectorDatabase, OpenAIEmbedding } from '@zilliz/code-context-core';

// Initialize embedding provider
const embedding = new OpenAIEmbedding({
    apiKey: process.env.OPENAI_API_KEY || 'your-openai-api-key',
    model: 'text-embedding-3-small'
});

// Initialize vector database
const vectorDatabase = new MilvusVectorDatabase({
    address: process.env.MILVUS_ADDRESS || 'localhost:19530',
    token: process.env.MILVUS_TOKEN || ''
});

// Create indexer instance
const indexer = new CodeIndexer({
    embedding,
    vectorDatabase
});

// Index your codebase with progress tracking
const stats = await indexer.indexCodebase('./your-project', (progress) => {
    console.log(`${progress.phase} - ${progress.percentage}%`);
});
console.log(`Indexed ${stats.indexedFiles} files, ${stats.totalChunks} chunks`);

// Perform semantic search
const results = await indexer.semanticSearch('./your-project', 'vector database operations', 5);
results.forEach(result => {
    console.log(`File: ${result.relativePath}:${result.startLine}-${result.endLine}`);
    console.log(`Score: ${(result.score * 100).toFixed(2)}%`);
    console.log(`Content: ${result.content.substring(0, 100)}...`);
});
```

### VSCode Extension

Integrates Code Context directly into your IDE. Provides an intuitive interface for semantic code search and navigation.

1. **Direct Link**: [Install from VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=zilliz.semanticcodesearch)
2. **Manual Search**:
    - Open Extensions view in VSCode (Ctrl+Shift+X or Cmd+Shift+X on Mac)
    - Search for "Semantic Code Search"
    - Click Install

![img](https://lh7-rt.googleusercontent.com/docsz/AD_4nXddRXEWLX9uzbAZa9FgHo77leAgYneIclqWObTM9To_Deo4fBIOZFrsM8_IVjCnJQeuOO1FgtI_IFj9S8MWnUX3aej98QvhlGrCbGALQ-d2c0DgyJEj3-Nsg-ufX39-951DamHmkA?key=_L-CtW461S9w7NRqzdFOIg)

---

## 🛠️ Development

### Setup Development Environment

```bash
# Clone repository
git clone https://github.com/zilliztech/code-context.git
cd code-context

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Start development mode
pnpm dev
```

### Building

```bash
# Build all packages
pnpm build

# Build specific package
pnpm build:core
pnpm build:vscode
pnpm build:mcp
```

### Running Examples

```bash
# Development with file watching
cd examples/basic-usage
pnpm dev
```

### Supported File Extensions

By default, Code Context supports:
- Programming languages: `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.java`, `.cpp`, `.c`, `.h`, `.hpp`, `.cs`, `.go`, `.rs`, `.php`, `.rb`, `.swift`, `.kt`, `.scala`, `.m`, `.mm`
- Documentation: `.md`, `.markdown`

### Ignore Patterns

Common directories and files are automatically ignored:
- `node_modules/**`, `dist/**`, `build/**`
- `.git/**`, `.vscode/**`, `.idea/**`
- `*.log`, `*.min.js`, `*.map`

---

## 📖 Examples

Check the `/examples` directory for complete usage examples:

- **Basic Usage**: Simple indexing and search example

---

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details on how to get started.

**Package-specific contributing guides:**
- [Core Package Contributing](packages/core/CONTRIBUTING.md)
- [MCP Server Contributing](packages/mcp/CONTRIBUTING.md)  
- [VSCode Extension Contributing](packages/vscode-extension/CONTRIBUTING.md)

---

## 🗺️ Roadmap

- [x] AST-based code analysis for improved understanding
- [x] Support for additional embedding providers
- [ ] Agent-based interactive search mode
- [ ] Enhanced code chunking strategies
- [ ] Search result ranking optimization
- [ ] Robust Chrome Extension

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🔗 Links

- [GitHub Repository](https://github.com/zilliztech/code-context)
- [VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=zilliz.semanticcodesearch)
- [Milvus Documentation](https://milvus.io/docs)
- [Zilliz Cloud](https://zilliz.com/cloud)