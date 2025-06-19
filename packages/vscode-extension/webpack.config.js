const path = require('path');
const webpack = require('webpack');

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
        vscode: 'commonjs vscode' // the vscode-module is created on-the-fly and must be excluded
        // Note: We completely ignore @zilliz/milvus2-sdk-node instead of externalizing it
    },
    resolve: {
        // support reading TypeScript and JavaScript files
        extensions: ['.ts', '.js'],
        alias: {
            '@code-indexer/core': path.resolve(__dirname, '../core/dist/index.js')
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
            }
        ]
    },
    plugins: [
        // Ignore gRPC Milvus SDK completely
        new webpack.IgnorePlugin({
            resourceRegExp: /@zilliz\/milvus2-sdk-node/
        }),

        // Replace MilvusVectorDatabase with a stub to avoid import errors
        // This handles both .ts and .js versions
        new webpack.NormalModuleReplacementPlugin(
            /.*milvus-vectordb(\.js)?$/,
            path.resolve(__dirname, 'src/stubs/milvus-vectordb-stub.js')
        )
    ]
}; 