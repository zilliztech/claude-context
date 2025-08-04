# GitHub Code Vector Search Chrome Extension

A Chrome extension for indexing and semantically searching GitHub repository code, powered by Claude Context.

> 📖 **New to Claude Context?** Check out the [main project README](../../README.md) for an overview and setup instructions.

## Features

- 🔍 **Semantic Search**: Intelligent code search on GitHub repositories based on semantic understanding
- 📁 **Repository Indexing**: Automatically index GitHub repositories and build semantic vector database
- 🎯 **Context Search**: Search related code by selecting code snippets directly on GitHub
- 🔧 **Multi-platform Support**: Support for OpenAI and VoyageAI as embedding providers
- 💾 **Vector Storage**: Integrated with Milvus vector database for efficient storage and retrieval
- 🌐 **GitHub Integration**: Seamlessly integrates with GitHub's interface
- 📱 **Cross-Repository**: Search across multiple indexed repositories
- ⚡ **Real-time**: Index and search code as you browse GitHub

## Installation

### From Chrome Web Store

> **Coming Soon**: Extension will be available on Chrome Web Store

### Manual Installation (Development)

1. **Build the Extension**:
   ```bash
   cd packages/chrome-extension
   pnpm build
   ```

2. **Load in Chrome**:
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" in the top right
   - Click "Load unpacked" and select the `dist` folder
   - The extension should now appear in your extensions list

## Quick Start

1. **Configure Settings**:
   - Click the extension icon in Chrome toolbar
   - Go to Options/Settings
   - Configure embedding provider and API Key
   - Set up Milvus connection details

2. **Index a Repository**:
   - Navigate to any GitHub repository
   - Click the "Index Repository" button that appears in the sidebar
   - Wait for indexing to complete

3. **Start Searching**:
   - Use the search box that appears on GitHub repository pages
   - Enter natural language queries like "function that handles authentication"
   - Click on results to navigate to the code

## Configuration

The extension can be configured through the options page:

- **Embedding Provider**: Choose between OpenAI or VoyageAI
- **Embedding Model**: Select specific model (e.g., `text-embedding-3-small`)
- **API Key**: Your embedding provider API key
- **Milvus Settings**: Vector database connection details
- **GitHub Token**: Personal access token for private repositories (optional)

## Permissions

The extension requires the following permissions:

- **Storage**: To save configuration and index metadata
- **Scripting**: To inject search UI into GitHub pages
- **Unlimited Storage**: For storing vector embeddings locally
- **Host Permissions**: Access to GitHub.com and embedding provider APIs

## File Structure

- `src/content.ts` - Main content script that injects UI into GitHub pages
- `src/background.ts` - Background service worker for extension lifecycle
- `src/options.ts` - Options page for configuration
- `src/config/milvusConfig.ts` - Milvus connection configuration
- `src/milvus/chromeMilvusAdapter.ts` - Browser-compatible Milvus adapter
- `src/storage/indexedRepoManager.ts` - Repository indexing management
- `src/stubs/` - Browser compatibility stubs for Node.js modules

## Development Features

- **Browser Compatibility**: Node.js modules adapted for browser environment
- **WebAssembly Support**: Optimized for browser performance
- **Offline Capability**: Local storage for indexed repositories
- **Progress Tracking**: Real-time indexing progress indicators
- **Error Handling**: Graceful degradation and user feedback

## Usage Examples

### Basic Search
1. Navigate to a GitHub repository
2. Enter query: "error handling middleware"
3. Browse semantic search results

### Context Search
1. Select code snippet on GitHub
2. Right-click and choose "Search Similar Code"
3. View related code across the repository

### Multi-Repository Search
1. Index multiple repositories
2. Use the extension popup to search across all indexed repos
3. Filter results by repository or file type

## Contributing

This Chrome extension is part of the Claude Context monorepo. Please see:
- [Main Contributing Guide](../../CONTRIBUTING.md) - General contribution guidelines
- [Chrome Extension Contributing](CONTRIBUTING.md) - Specific development guide for this extension

## Related Packages

- **[@zilliz/claude-context-core](../core)** - Core indexing engine used by this extension
- **[@zilliz/claude-context-vscode-extension](../vscode-extension)** - VSCode integration
- **[@zilliz/claude-context-mcp](../mcp)** - MCP server integration

## Tech Stack

- **TypeScript** - Type-safe development
- **Chrome Extension Manifest V3** - Modern extension architecture
- **Webpack** - Module bundling and optimization
- **Claude Context Core** - Semantic search engine
- **Milvus Vector Database** - Vector storage and retrieval
- **OpenAI/VoyageAI Embeddings** - Text embedding generation

## Browser Support

- Chrome 88+
- Chromium-based browsers (Edge, Brave, etc.)

## License

MIT - See [LICENSE](../../LICENSE) for details
