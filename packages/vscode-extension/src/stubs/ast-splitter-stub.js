/**
 * Real AST implementation using web-tree-sitter for VSCode extension
 * Provides true AST-based code splitting with fallback to LangChain
 */

let TreeSitter;
let Parser;
let wasmLoaded = false;

// Try to load web-tree-sitter in different environments
try {
    // In VSCode extension environment, try the CommonJS version
    TreeSitter = require('web-tree-sitter');
    Parser = TreeSitter.Parser;
} catch (error) {
    console.warn('Failed to load web-tree-sitter:', error.message);
    TreeSitter = null;
    Parser = null;
}

// Language parsers mapping - these correspond to the WASM files in the wasm directory
const LANGUAGE_PARSERS = {
    javascript: 'tree-sitter-javascript.wasm',
    typescript: 'tree-sitter-typescript.wasm',
    python: 'tree-sitter-python.wasm',
    java: 'tree-sitter-java.wasm',
    cpp: 'tree-sitter-cpp.wasm',
    go: 'tree-sitter-go.wasm',
    rust: 'tree-sitter-rust.wasm'
};

// Node types that represent logical code units
const SPLITTABLE_NODE_TYPES = {
    javascript: ['function_declaration', 'arrow_function', 'class_declaration', 'method_definition', 'export_statement'],
    typescript: ['function_declaration', 'arrow_function', 'class_declaration', 'method_definition', 'export_statement', 'interface_declaration', 'type_alias_declaration'],
    python: ['function_definition', 'class_definition', 'decorated_definition', 'async_function_definition'],
    java: ['method_declaration', 'class_declaration', 'interface_declaration', 'constructor_declaration'],
    cpp: ['function_definition', 'class_specifier', 'namespace_definition', 'declaration'],
    go: ['function_declaration', 'method_declaration', 'type_declaration', 'var_declaration', 'const_declaration'],
    rust: ['function_item', 'impl_item', 'struct_item', 'enum_item', 'trait_item', 'mod_item']
};

class AstCodeSplitterStub {
    constructor(chunkSize = 2500, chunkOverlap = 300) {
        this.chunkSize = chunkSize;
        this.chunkOverlap = chunkOverlap;
        this.parser = null;
        this.loadedLanguages = new Map();
        // Import LangChain splitter as fallback
        try {
            const { LangChainCodeSplitter } = require('@code-indexer/core');
            this.fallbackSplitter = new LangChainCodeSplitter(chunkSize, chunkOverlap);
        } catch (error) {
            console.error('Failed to initialize LangChain fallback splitter:', error);
            throw new Error('Both web-tree-sitter and LangChain splitters are unavailable');
        }
    }

    async initializeParser() {
        if (!Parser || !TreeSitter) {
            console.warn('⚠️  web-tree-sitter not available, will use fallback');
            return false;
        }

        if (!wasmLoaded) {
            try {
                if (typeof Parser.init !== 'function') {
                    console.warn('⚠️  Parser.init is not a function, Parser object:', Object.keys(Parser));
                    return false;
                }

                await Parser.init({
                    locateFile: (filename) => {
                        const path = require('path');
                        if (filename === 'tree-sitter.wasm') {
                            return path.join(__dirname, '..', 'dist', 'tree-sitter.wasm');
                        } else {
                            return path.join(__dirname, '..', 'dist', 'wasm', filename);
                        }
                    }
                });
                wasmLoaded = true;
                console.log('🌳 web-tree-sitter initialized successfully');
            } catch (error) {
                console.warn('⚠️  Failed to initialize web-tree-sitter, will use fallback:', error);
                return false;
            }
        }
        if (!this.parser && wasmLoaded && Parser) {
            this.parser = new Parser();
        }
        return wasmLoaded;
    }

    async loadLanguage(language) {
        const normalizedLang = this.normalizeLanguage(language);
        if (this.loadedLanguages.has(normalizedLang)) {
            return this.loadedLanguages.get(normalizedLang);
        }
        const wasmFile = LANGUAGE_PARSERS[normalizedLang];
        if (!wasmFile) {
            return null; // Language not supported
        }
        try {
            let Language;
            let LanguageLoader;
            if (TreeSitter.Language) {
                LanguageLoader = TreeSitter.Language;
            } else if (Parser.Language) {
                LanguageLoader = Parser.Language;
            } else if (typeof Parser.loadLanguage === 'function') {
                LanguageLoader = { load: Parser.loadLanguage };
            } else {
                console.warn(`⚠️  Cannot find Language loader in TreeSitter object for ${normalizedLang}`);
                return null;
            }
            try {
                const path = require('path');
                const wasmPath = path.join(__dirname, '..', 'dist', 'wasm', wasmFile);
                Language = await LanguageLoader.load(wasmPath);
                console.log(`📦 Loaded ${normalizedLang} parser from extension dist/wasm directory`);
            } catch (localError) {
                console.warn(`⚠️  Failed to load ${normalizedLang} parser locally:`, localError.message);
                try {
                    const wasmPath = `https://cdn.jsdelivr.net/npm/web-tree-sitter@latest/${wasmFile}`;
                    Language = await LanguageLoader.load(wasmPath);
                    console.log(`📦 Loaded ${normalizedLang} parser from CDN fallback`);
                } catch (urlError) {
                    console.warn(`⚠️  Failed to load ${normalizedLang} parser from CDN:`, urlError.message);
                    return null;
                }
            }
            this.loadedLanguages.set(normalizedLang, Language);
            console.log(`📦 Successfully loaded ${normalizedLang} parser for AST splitting`);
            return Language;
        } catch (error) {
            console.warn(`⚠️  Failed to load ${normalizedLang} parser:`, error);
            return null;
        }
    }

    normalizeLanguage(language) {
        const langMap = {
            'js': 'javascript',
            'ts': 'typescript', 
            'py': 'python',
            'c++': 'cpp',
            'c': 'cpp',
            'rs': 'rust'
        };
        return langMap[language.toLowerCase()] || language.toLowerCase();
    }

    async split(code, language, filePath) {
        try {
            const parserReady = await this.initializeParser();
            if (!parserReady || !Parser) {
                console.log('[AST Splitter] web-tree-sitter not available, using LangChain fallback');
                return this.fallbackSplitter.split(code, language, filePath);
            }
            
            const languageParser = await this.loadLanguage(language);
            if (!languageParser) {
                console.log(`[AST Splitter] Language ${language} not supported by web AST, using LangChain fallback for: ${filePath || 'unknown'}`);
                return await this.fallbackSplitter.split(code, language, filePath);
            }

            // Ensure parser is available before setting language
            if (!this.parser) {
                console.warn(`[AST Splitter] Parser not initialized, falling back to LangChain: ${filePath || 'unknown'}`);
                return await this.fallbackSplitter.split(code, language, filePath);
            }

            this.parser.setLanguage(languageParser);
            const tree = this.parser.parse(code);

            if (!tree || !tree.rootNode) {
                console.warn(`[AST Splitter] Failed to parse AST for ${language}, falling back to LangChain: ${filePath || 'unknown'}`);
                return await this.fallbackSplitter.split(code, language, filePath);
            }

            console.log(`🌳 [AST Splitter] Using web-tree-sitter for ${language} file: ${filePath || 'unknown'}`);
            
            const normalizedLang = this.normalizeLanguage(language);
            const nodeTypes = SPLITTABLE_NODE_TYPES[normalizedLang] || [];
            
            // Extract chunks based on AST nodes
            const chunks = this.extractChunks(tree.rootNode, code, nodeTypes, language, filePath);
            
            // If chunks are too large, split them further
            const refinedChunks = await this.refineChunks(chunks, code);

            return refinedChunks;
        } catch (error) {
            console.warn(`[AST Splitter] web-tree-sitter failed for ${language}, falling back to LangChain:`, error);
            return await this.fallbackSplitter.split(code, language, filePath);
        }
    }

    extractChunks(node, code, nodeTypes, language, filePath) {
        const chunks = [];
        const lines = code.split('\n');

        // Find all splittable nodes
        const splittableNodes = this.findSplittableNodes(node, nodeTypes);
        
        if (splittableNodes.length === 0) {
            // No splittable nodes found, treat as single chunk
            return [{
                content: code,
                metadata: {
                    startLine: 1,
                    endLine: lines.length,
                    language,
                    filePath
                }
            }];
        }

        let lastEndLine = 0;

        for (const astNode of splittableNodes) {
            const startLine = astNode.startPosition.row + 1;
            const endLine = astNode.endPosition.row + 1;
            
            // Add any content between previous node and current node
            if (startLine > lastEndLine + 1) {
                const betweenContent = lines.slice(lastEndLine, startLine - 1).join('\n');
                if (betweenContent.trim()) {
                    chunks.push({
                        content: betweenContent,
                        metadata: {
                            startLine: lastEndLine + 1,
                            endLine: startLine - 1,
                            language,
                            filePath
                        }
                    });
                }
            }

            // Add the current node as a chunk
            const nodeContent = lines.slice(startLine - 1, endLine).join('\n');
            chunks.push({
                content: nodeContent,
                metadata: {
                    startLine,
                    endLine,
                    language,
                    filePath,
                    nodeType: astNode.type
                }
            });

            lastEndLine = endLine;
        }

        // Add any remaining content after the last node
        if (lastEndLine < lines.length) {
            const remainingContent = lines.slice(lastEndLine).join('\n');
            if (remainingContent.trim()) {
                chunks.push({
                    content: remainingContent,
                    metadata: {
                        startLine: lastEndLine + 1,
                        endLine: lines.length,
                        language,
                        filePath
                    }
                });
            }
        }

        return chunks;
    }

    findSplittableNodes(node, nodeTypes) {
        const nodes = [];
        
        // Check if current node is splittable
        if (nodeTypes.includes(node.type)) {
            nodes.push(node);
        }

        // Recursively check children
        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child) {
                nodes.push(...this.findSplittableNodes(child, nodeTypes));
            }
        }

        return nodes;
    }

    async refineChunks(chunks, originalCode) {
        const refinedChunks = [];

        for (const chunk of chunks) {
            if (chunk.content.length <= this.chunkSize) {
                refinedChunks.push(chunk);
            } else {
                // Chunk is too large, split it using LangChain splitter
                console.log(`📏 [AST Splitter] Chunk too large (${chunk.content.length} chars), using LangChain for refinement`);
                const subChunks = await this.fallbackSplitter.split(
                    chunk.content, 
                    chunk.metadata.language, 
                    chunk.metadata.filePath
                );
                
                // Adjust line numbers for sub-chunks
                let currentStartLine = chunk.metadata.startLine;
                for (const subChunk of subChunks) {
                    const subChunkLines = subChunk.content.split('\n').length;
                    refinedChunks.push({
                        content: subChunk.content,
                        metadata: {
                            ...chunk.metadata,
                            startLine: currentStartLine,
                            endLine: currentStartLine + subChunkLines - 1
                        }
                    });
                    currentStartLine += subChunkLines;
                }
            }
        }

        return refinedChunks;
    }

    setChunkSize(chunkSize) {
        this.chunkSize = chunkSize;
        this.fallbackSplitter.setChunkSize(chunkSize);
    }

    setChunkOverlap(chunkOverlap) {
        this.chunkOverlap = chunkOverlap;
        this.fallbackSplitter.setChunkOverlap(chunkOverlap);
    }
}

module.exports = {
    AstCodeSplitter: AstCodeSplitterStub
};
