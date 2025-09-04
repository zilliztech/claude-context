# Contributing to Chrome Extension

Thanks for your interest in contributing to the Claude Context Chrome extension!

> 📖 **First time contributing?** Please read the [main contributing guide](../../CONTRIBUTING.md) first for general setup and workflow.

## Chrome Extension Development

This guide covers development specific to the Chrome extension.

### Quick Commands

```bash
# Build Chrome extension
pnpm build:chrome

# Watch mode for development
pnpm dev:chrome

# Clean build artifacts
pnpm clean

# Lint code
pnpm lint

# Type checking
pnpm typecheck

# Generate icons
pnpm prebuild
```

### Development Setup

1. **Install Dependencies**:

   ```bash
   cd packages/chrome-extension
   pnpm install
   ```

2. **Build Extension**:

   ```bash
   pnpm build
   ```

3. **Load in Chrome**:
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked" and select the `dist` folder

4. **Development Mode**:

   ```bash
   pnpm dev  # Watch mode for automatic rebuilds
   ```

## Making Changes

1. Create a new branch for your feature/fix
2. Make changes in the `src/` directory
3. Test in Chrome with "Reload extension" after changes
4. Follow commit guidelines in the [main guide](../../CONTRIBUTING.md)

## Project Structure

```
src/
├── content.ts              # Content script for GitHub integration
├── background.ts           # Background service worker
├── options.ts             # Options/settings page
├── options.html           # Options page HTML
├── styles.css             # Extension styles
├── manifest.json          # Extension manifest
├── config/
│   └── milvusConfig.ts    # Milvus configuration
├── milvus/
│   └── chromeMilvusAdapter.ts  # Browser Milvus adapter
├── storage/
│   └── indexedRepoManager.ts   # Repository management
├── stubs/                 # Browser compatibility stubs
└── icons/                 # Extension icons
```

## Development Workflow

### 1. Content Script Development

- Modify `src/content.ts` for GitHub UI integration
- Test on various GitHub repository pages
- Ensure UI doesn't conflict with GitHub's interface

### 2. Background Service Worker

- Edit `src/background.ts` for extension lifecycle management
- Handle cross-tab communication and data persistence
- Test extension startup and shutdown scenarios

### 3. Options Page

- Update `src/options.ts` and `src/options.html` for settings
- Test configuration persistence and validation
- Ensure user-friendly error messages

### 4. Testing Workflow

1. Make changes to source files
2. Run `pnpm build` or use `pnpm dev` for watch mode
3. Go to `chrome://extensions/` and click "Reload" on the extension
4. Test functionality on GitHub repositories
5. Check Chrome DevTools console for errors

## Browser Compatibility

### WebPack Configuration

- `webpack.config.js` handles Node.js polyfills for browser environment
- Modules like `crypto`, `fs`, `path` are replaced with browser-compatible versions

### Key Polyfills

- `crypto-browserify` - Cryptographic functions
- `buffer` - Node.js Buffer API
- `process` - Process environment variables
- `path-browserify` - Path manipulation
- `vm-browserify` - Virtual machine context

### Testing Browser Compatibility

```bash
# Build and test in different browsers
pnpm build
# Load extension in Chrome, Edge, Brave, etc.
```

## Extension-Specific Guidelines

### Manifest V3 Compliance

- Use service workers instead of background pages
- Follow content security policy restrictions
- Handle permissions properly

### Performance Considerations

- Minimize content script impact on GitHub page load
- Use efficient DOM manipulation
- Lazy load heavy components

### Security Best Practices

- Validate all user inputs
- Sanitize HTML content
- Use secure communication between scripts
- Handle API keys securely

### UI/UX Guidelines

- Match GitHub's design language
- Provide loading states for async operations
- Show clear error messages
- Ensure accessibility compliance

## Chrome Extension Features

### Core Functionality

- **Repository Indexing**: Parse GitHub repositories and create vector embeddings
- **Semantic Search**: Natural language code search within repositories
- **UI Integration**: Seamless GitHub interface enhancement
- **Configuration Management**: User settings and API key management

### Advanced Features

- **Cross-Repository Search**: Search across multiple indexed repositories
- **Context-Aware Search**: Search similar code from selected snippets
- **Progress Tracking**: Real-time indexing progress indicators
- **Offline Support**: Local caching of indexed repositories

## Testing Checklist

### Manual Testing

- [ ] Extension loads without errors
- [ ] UI appears correctly on GitHub repository pages
- [ ] Indexing works for public repositories
- [ ] Search returns relevant results
- [ ] Options page saves configuration correctly
- [ ] Extension works across different GitHub page types
- [ ] No conflicts with GitHub's native functionality

### Cross-Browser Testing

- [ ] Chrome (latest)
- [ ] Edge (Chromium-based)
- [ ] Brave Browser
- [ ] Other Chromium-based browsers

### GitHub Integration Testing

- [ ] Repository home pages
- [ ] File browser pages
- [ ] Code view pages
- [ ] Pull request pages
- [ ] Different repository sizes
- [ ] Private repositories (with token)

## Debugging

### Chrome DevTools

1. Right-click extension icon → "Inspect popup"
2. Go to GitHub page → F12 → check console for content script errors
3. `chrome://extensions/` → click "service worker" link for background script debugging

### Common Issues

- **Permission errors**: Check manifest.json permissions
- **CSP violations**: Verify content security policy compliance
- **Module not found**: Check webpack polyfill configuration
- **API errors**: Validate API keys and network connectivity

### Debug Commands

```bash
# Check build output (Unix/macOS)
ls -la dist/

# Check build output (Windows PowerShell)
Get-ChildItem dist/ | Format-Table -AutoSize

# Validate manifest (Unix/macOS)
cat dist/manifest.json | jq

# Validate manifest (Windows PowerShell)
Get-Content dist/manifest.json | ConvertFrom-Json | ConvertTo-Json -Depth 10

# Check for TypeScript errors (cross-platform)
pnpm typecheck
```

## Publishing Preparation

### Pre-Publishing Checklist

- [ ] All tests pass
- [ ] No console errors
- [ ] Icons generated correctly
- [ ] Manifest version updated
- [ ] README updated with new features
- [ ] Screenshots prepared for store listing

### Build for Production

```bash
# Clean build
pnpm clean
pnpm build

# Verify bundle size (Unix/macOS)
ls -lh dist/

# Verify bundle size (Windows PowerShell)
Get-ChildItem dist/ | Select-Object Name, @{Name="Size";Expression={[math]::Round($_.Length/1KB,2)}} | Format-Table -AutoSize
```

> **Note**: Only maintainers can publish to Chrome Web Store

## Questions?

- **General questions**: See [main contributing guide](../../CONTRIBUTING.md)
- **Chrome extension specific issues**: Open an issue with the `chrome-extension` label
- **Browser compatibility**: Test across different Chromium browsers
- **GitHub integration**: Ensure changes work across all GitHub page types
