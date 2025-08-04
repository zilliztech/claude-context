const path = require('path');
const webpack = require('webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
    target: 'node', // VSCode extensions run in a Node.js-context
    mode: 'none', // this leaves the source code as close as possible to the original

    entry: './src/extension.ts', // the entry point of this extension
    output: {
        // the bundle is stored in the 'dist' folder (check package.json)
        path: path.resolve(__dirname, 'dist'),
        filename: 'extension.js',
        libraryTarget: 'commonjs2'
    },
    devtool: 'nosources-source-map',
    externals: {
        vscode: 'commonjs vscode', // the vscode-module is created on-the-fly and must be excluded
        // Note: We completely ignore @zilliz/milvus2-sdk-node instead of externalizing it
        // Ignore native tree-sitter modules that don't work in VSCode extension context
        // but allow web-tree-sitter to be bundled
        // (tree-sitter externals removed)
    },
    resolve: {
        // support reading TypeScript and JavaScript files
        extensions: ['.ts', '.js'],
        alias: {
            '@zilliz/claude-context-core': path.resolve(__dirname, '../core/dist/index.js'),
            '@zilliz/claude-context-core/dist/splitter': path.resolve(__dirname, '../core/dist/splitter'),
            '@zilliz/claude-context-core/dist/embedding': path.resolve(__dirname, '../core/dist/embedding'),
            '@zilliz/claude-context-core/dist/vectordb': path.resolve(__dirname, '../core/dist/vectordb')
        }
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                use: [
                    {
                        loader: 'ts-loader',
                        options: {
                            transpileOnly: true,
                            onlyCompileBundledFiles: true
                        }
                    }
                ]
            },
            {
                test: /\.wasm$/,
                type: 'webassembly/async'
            },
            {
                test: /tree-sitter.*\.wasm$/,
                type: 'asset/resource',
                generator: {
                    filename: 'wasm/[name][ext]'
                }
            }
        ]
    },
    experiments: {
        asyncWebAssembly: true
    },
    plugins: [
        // Ignore gRPC Milvus SDK completely
        new webpack.IgnorePlugin({
            resourceRegExp: /@zilliz\/milvus2-sdk-node/
        }),

        // Ignore only native tree-sitter modules that cause issues in VSCode extension context
        // but allow web-tree-sitter to be bundled
        new webpack.IgnorePlugin({
            resourceRegExp: /^tree-sitter$/
        }),

        // Replace MilvusVectorDatabase with a stub to avoid import errors
        // This handles both .ts and .js versions
        new webpack.NormalModuleReplacementPlugin(
            /.*milvus-vectordb(\.js)?$/,
            path.resolve(__dirname, 'src/stubs/milvus-vectordb-stub.js')
        ),

        // Replace AST splitter with stub since it depends on tree-sitter
        new webpack.NormalModuleReplacementPlugin(
            /.*ast-splitter(\.js)?$/,
            path.resolve(__dirname, 'src/stubs/ast-splitter-stub.js')
        ),

        // Copy web-tree-sitter.wasm and language parsers to dist directory for runtime loading
        new CopyWebpackPlugin({
            patterns: [
                {
                    from: path.resolve(__dirname, 'node_modules/web-tree-sitter/tree-sitter.wasm'),
                    to: path.resolve(__dirname, 'dist/tree-sitter.wasm')
                },
                // Copy all WASM parsers from wasm directory
                {
                    from: path.resolve(__dirname, 'wasm'),
                    to: path.resolve(__dirname, 'dist/wasm'),
                    globOptions: {
                        ignore: ['**/.DS_Store']
                    }
                }
            ]
        })
    ]
};