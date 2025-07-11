# 🔍 CodeIndexer

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org/)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/zilliz.semanticcodesearch?label=VS%20Code%20Extension&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=zilliz.semanticcodesearch)
[![npm - core](https://img.shields.io/npm/v/@code-indexer/core?label=%40code-indexer%2Fcore&logo=npm)](https://www.npmjs.com/package/@code-indexer/core)
[![npm - mcp](https://img.shields.io/npm/v/@code-indexer/mcp?label=%40code-indexer%2Fmcp&logo=npm)](https://www.npmjs.com/package/@code-indexer/mcp)
[![Twitter](https://img.shields.io/twitter/url/https/twitter.com/zilliz_universe.svg?style=social&label=Follow%20%40Zilliz)](https://twitter.com/zilliz_universe)
[![DeepWiki](https://img.shields.io/badge/DeepWiki-AI%20Docs-purple.svg?logo=gitbook&logoColor=white)](https://deepwiki.com/zilliztech/CodeIndexer)
<a href="https://discord.gg/mKc3R95yE5"><img height="20" src="https://img.shields.io/badge/Discord-%235865F2.svg?style=for-the-badge&logo=discord&logoColor=white" alt="discord"/></a>

An open-source implementation of the code indexing and context awareness capabilities found in AI-powered IDEs like Cursor and Windsurf, built with Milvus vector database and popular embedding models. You can build your own AI Coding IDE or code search plugin with it, or directly integrate it into your existing IDEs through MCP or VSCode extension.

## 🌟 Why CodeIndexer?

In the **AI-first development era**, traditional keyword-based search is no longer sufficient for modern software development:

### 🚀 **The AI Coding Revolution**
- **AI-Powered IDEs** like Cursor and Claude Code are transforming development workflows
- **Growing demand** for intelligent code assistance and semantic understanding
- **Modern codebases** contain millions of lines across hundreds of files, making manual navigation inefficient

### ❌ **Current Limitations**
- LLMs have **limited context windows** and can't process entire large codebases at once
- Regex and keyword-based search miss **contextual relationships**
- Some IDEs lack **context awareness** - they can't understand how different parts of your codebase relate to each other
- Developers waste time navigating large codebases manually  
- Traditional search tools can't bridge the gap between **human intent** and **code implementation**

### ✅ **Our Solution**
CodeIndexer bridges the gap between human understanding and code discovery through:
- **Context awareness** - understands relationships between different parts of your codebase
- **Semantic search** with natural language queries like *"find authentication functions"*
- **AI-powered understanding** of code meaning and relationships
- **Universal integration** across multiple platforms and development environments through MCP and VSCode extension

> 💡 **Find code by describing functionality, not just keywords** - Discover existing solutions before writing duplicate code. Give your AI tools the context they need to understand your entire codebase.

## ✨ Features

- 🔍 **Semantic Code Search**: Ask questions like *"find functions that handle user authentication"* instead of guessing keywords
- 📁 **Intelligent Indexing**: Automatically index entire codebases and build semantic vector databases with contextual understanding
- 🎯 **Context-Aware Discovery**: Find related code snippets based on meaning, not just text matching
- ⚡ **Incremental File Synchronization**: Efficient change detection using Merkle trees to only re-index modified files
- 🧩 **Smart Chunking**: AST-based code splitting that preserves context and structure
- 🚀 **Developer Productivity**: Significantly reduce time spent searching for relevant code and discovering existing solutions
- 🔧 **Embedding Providers**: Support for OpenAI, VoyageAI, Ollama as embedding providers
- 💾 **Vector Storage**: Integrated with Milvus/Zilliz Cloud for efficient storage and retrieval
- 🛠️ **VSCode Integration**: Built-in VSCode extension for seamless development workflow
- 🤖 **MCP Support**: Model Context Protocol integration for AI agent interactions
- 📊 **Progress Tracking**: Real-time progress feedback during indexing operations
- 🎨 **Customizable**: Configurable file extensions, ignore patterns, and embedding models

## 🏗️ Architecture
![](assets/Architecture.png)

CodeIndexer is a monorepo containing three main packages:

### Core Components

- **`@code-indexer/core`**: Core indexing engine with embedding and vector database integration
- **VSCode Extension**: Semantic Code Search extension for Visual Studio Code
- **`@code-indexer/mcp`**: Model Context Protocol server for AI agent integration

### Supported Technologies
- **Embedding Providers**: [OpenAI](https://openai.com), [VoyageAI](https://voyageai.com), [Ollama](https://ollama.ai)
- **Vector Databases**: [Milvus](https://milvus.io) or [Zilliz Cloud](https://zilliz.com/cloud)(fully managed vector database as a service)
- **Code Splitters**: AST-based splitter (with automatic fallback), LangChain character-based splitter
- **Languages**: TypeScript, JavaScript, Python, Java, C++, C#, Go, Rust, PHP, Ruby, Swift, Kotlin, Scala, Markdown
- **Development Tools**: VSCode, Model Context Protocol

## 🚀 Quick Start (for the core package)

### Prerequisites

- Node.js >= 20.0.0
- pnpm >= 10.0.0
- Milvus database
- OpenAI or VoyageAI API key

### Installation

```bash
# Using npm
npm install @code-indexer/core

# Using pnpm
pnpm add @code-indexer/core

# Using yarn
yarn add @code-indexer/core
```


### Prepare Environment Variables
#### OpenAI API key
See [OpenAI Documentation](https://platform.openai.com/docs/api-reference) for more details to get your API key.
```bash
OPENAI_API_KEY=your-openai-api-key
```

#### Milvus configuration
Zilliz Cloud(fully managed Milvus vector database as a service, you can [use it for free](https://zilliz.com/cloud))

- `MILVUS_ADDRESS` is the Public Endpoint of your Zilliz Cloud instance
- `MILVUS_TOKEN` is the token of your Zilliz Cloud instance.
```bash
MILVUS_ADDRESS=https://xxx-xxxxxxxxxxxx.serverless.gcp-us-west1.cloud.zilliz.com
MILVUS_TOKEN=xxxxxxx
```
> Optional: Self-hosted Milvus. See [Milvus Documentation](https://milvus.io/docs/install_standalone-docker-compose.md) for more details to install Milvus.



### Basic Usage
[@code-indexer/core](packages/core/README.md)
Core indexing engine that provides the fundamental functionality for code indexing and semantic search. Handles embedding generation, vector storage, and search operations.

```typescript
import { CodeIndexer, MilvusVectorDatabase, OpenAIEmbedding } from '@code-indexer/core';

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

## 📦 Built on Core

All the following packages are built on top of the `@code-indexer/core` engine, extending its capabilities to different platforms and use cases. They leverage the core's semantic search and indexing functionality to provide specialized interfaces and integrations.

> 📖 Each package has its own detailed documentation and usage examples. Click the links below to learn more.


### [@code-indexer/mcp](packages/mcp/README.md) 
Model Context Protocol (MCP) server that enables AI assistants and agents to interact with CodeIndexer through a standardized protocol. Exposes indexing and search capabilities via MCP tools.
![img](https://lh7-rt.googleusercontent.com/slidesz/AGV_vUfOR-7goqarF653roYT5u_HY_J3VkMMeUPUc2ZVj11ue82_tIzE_lIOuJ27HWcVYjTEQj2S3v9tZtS0-AXpyOP6F9VV_mymssD-57wT_ZVjF2MrS7cm5Ynj0goSEPpy81N4xSqi=s2048?key=DDtZSt7cnK5OdJgxQI2Ysg)


<details>
<summary><strong>Cursor</strong></summary>

<a href="https://cursor.com/install-mcp?name=code-indexer&config=JTdCJTIyY29tbWFuZCUyMiUzQSUyMm5weCUyMC15JTIwJTQwY29kZS1pbmRleGVyJTJGbWNwJTQwbGF0ZXN0JTIyJTJDJTIyZW52JTIyJTNBJTdCJTIyT1BFTkFJX0FQSV9LRVklMjIlM0ElMjJ5b3VyLW9wZW5haS1hcGkta2V5JTIyJTJDJTIyTUlMVlVTX0FERFJFU1MlMjIlM0ElMjJsb2NhbGhvc3QlM0ExOTUzMCUyMiU3RCU3RA%3D%3D"><img src="https://cursor.com/deeplink/mcp-install-dark.svg" alt="Add code-indexer MCP server to Cursor" height="32" /></a>

Go to: `Settings` -> `Cursor Settings` -> `MCP` -> `Add new global MCP server`

Pasting the following configuration into your Cursor `~/.cursor/mcp.json` file is the recommended approach. You may also install in a specific project by creating `.cursor/mcp.json` in your project folder. See [Cursor MCP docs](https://docs.cursor.com/context/model-context-protocol) for more info.

```json
{
  "mcpServers": {
    "code-indexer": {
      "command": "npx",
      "args": ["-y", "@code-indexer/mcp@latest"],
      "env": {
        "OPENAI_API_KEY": "your-openai-api-key",
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
    "code-indexer": {
      "command": "npx",
      "args": ["@code-indexer/mcp@latest"],
      "env": {
        "OPENAI_API_KEY": "your-openai-api-key",
        "MILVUS_ADDRESS": "localhost:19530"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>Claude Code</strong></summary>

Use the command line interface to add the CodeIndexer MCP server:

```bash
# Add the CodeIndexer MCP server
claude mcp add code-indexer -e OPENAI_API_KEY=your-openai-api-key -e MILVUS_ADDRESS=localhost:19530 -- npx @code-indexer/mcp@latest

```

See the [Claude Code MCP documentation](https://docs.anthropic.com/en/docs/claude-code/mcp) for more details about MCP server management.

</details>

<details>
<summary><strong>Windsurf</strong></summary>

Windsurf supports MCP configuration through a JSON file. Add the following configuration to your Windsurf MCP settings:

```json
{
  "mcpServers": {
    "code-indexer": {
      "command": "npx",
      "args": ["-y", "@code-indexer/mcp@latest"],
      "env": {
        "OPENAI_API_KEY": "your-openai-api-key",
        "MILVUS_ADDRESS": "localhost:19530"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>VS Code</strong></summary>

The CodeIndexer MCP server can be used with VS Code through MCP-compatible extensions. Add the following configuration to your VS Code MCP settings:

```json
{
  "mcpServers": {
    "code-indexer": {
      "command": "npx",
      "args": ["-y", "@code-indexer/mcp@latest"],
      "env": {
        "OPENAI_API_KEY": "your-openai-api-key",
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
   - **Name**: `code-indexer`
   - **Type**: `STDIO`
   - **Command**: `npx`
   - **Arguments**: `["@code-indexer/mcp@latest"]`
   - **Environment Variables**:
     - `OPENAI_API_KEY`: `your-openai-api-key`
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
    "code-indexer": {
      "command": "npx",
      "args": ["@code-indexer/mcp@latest"],
      "env": {
        "OPENAI_API_KEY": "your-openai-api-key",
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

To configure Code Indexer MCP in Augment Code, you can use either the graphical interface or manual configuration.

#### **A. Using the Augment Code UI**

1. Click the hamburger menu.

2. Select **Settings**.

3. Navigate to the **Tools** section.

4. Click the **+ Add MCP** button.

5. Enter the following command:

   ```
   npx @code-indexer/mcp@latest
   ```

6. Name the MCP: **Code Indexer**.

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
      "name": "code-indexer", 
      "command": "npx", 
      "args": ["-y", "@code-indexer/mcp@latest"] 
    } 
  ] 
}
```

</details>

<details>
<summary><strong>Gemini CLI</strong></summary>

Gemini CLI requires manual configuration through a JSON file:

1. Create or edit the `~/.gemini/settings.json` file.

2. Add the following configuration:

```json
{
  "mcpServers": {
    "code-indexer": {
      "command": "npx",
      "args": ["@code-indexer/mcp@latest"],
      "env": {
        "OPENAI_API_KEY": "your-openai-api-key",
        "MILVUS_ADDRESS": "localhost:19530"
      }
    }
  }
}
```

3. Save the file and restart Gemini CLI to apply the changes.

</details>

<details>
<summary><strong>Roo Code</strong></summary>

Roo Code utilizes a JSON configuration file for MCP servers:

1. Open Roo Code and navigate to **Settings → MCP Servers → Edit Global Config**.

2. In the `mcp_settings.json` file, add the following configuration:

```json
{
  "mcpServers": {
    "code-indexer": {
      "command": "npx",
      "args": ["@code-indexer/mcp@latest"],
      "env": {
        "OPENAI_API_KEY": "your-openai-api-key",
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
npx @code-indexer/mcp@latest
```

</details>

### [VSCode Extension](packages/vscode-extension/README.md)
Visual Studio Code extension that integrates CodeIndexer directly into your IDE. Provides an intuitive interface for semantic code search and navigation.

1. **Direct Link**: [Install from VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=zilliz.semanticcodesearch)

2. **Manual Search**:
    - Open Extensions view in VSCode (Ctrl+Shift+X or Cmd+Shift+X on Mac)
    - Search for "Semantic Code Search"
    - Click Install


![img](https://lh7-rt.googleusercontent.com/docsz/AD_4nXddRXEWLX9uzbAZa9FgHo77leAgYneIclqWObTM9To_Deo4fBIOZFrsM8_IVjCnJQeuOO1FgtI_IFj9S8MWnUX3aej98QvhlGrCbGALQ-d2c0DgyJEj3-Nsg-ufX39-951DamHmkA?key=_L-CtW461S9w7NRqzdFOIg)



## 🛠️ Development

### Setup Development Environment

```bash
# Clone repository
git clone https://github.com/zilliztech/CodeIndexer.git
cd CodeIndexer

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

By default, CodeIndexer supports:
- Programming languages: `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.java`, `.cpp`, `.c`, `.h`, `.hpp`, `.cs`, `.go`, `.rs`, `.php`, `.rb`, `.swift`, `.kt`, `.scala`, `.m`, `.mm`
- Documentation: `.md`, `.markdown`

### Ignore Patterns

Common directories and files are automatically ignored:
- `node_modules/**`, `dist/**`, `build/**`
- `.git/**`, `.vscode/**`, `.idea/**`
- `*.log`, `*.min.js`, `*.map`

## 📖 Examples

Check the `/examples` directory for complete usage examples:

- **Basic Usage**: Simple indexing and search example

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details on how to get started.

**Package-specific contributing guides:**
- [Core Package Contributing](packages/core/CONTRIBUTING.md)
- [MCP Server Contributing](packages/mcp/CONTRIBUTING.md)  
- [VSCode Extension Contributing](packages/vscode-extension/CONTRIBUTING.md)


## 🗺️ Roadmap

- [x] AST-based code analysis for improved understanding
- [x] Support for additional embedding providers
- [ ] Agent-based interactive search mode
- [ ] Enhanced code chunking strategies
- [ ] Search result ranking optimization
- [ ] Robust Chrome Extension

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔗 Links

- [GitHub Repository](https://github.com/zilliztech/CodeIndexer)
- [VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=zilliz.semanticcodesearch)
- [Milvus Documentation](https://milvus.io/docs)
- [Zilliz Cloud](https://zilliz.com/cloud)