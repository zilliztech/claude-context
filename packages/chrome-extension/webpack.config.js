const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const webpack = require('webpack');

module.exports = {
  mode: 'production',
  entry: {
    background: './src/background.ts',
    content: './src/content.ts',
    options: './src/options.ts'
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: true
  },
  devtool: false,
  experiments: {
    outputModule: false
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/
      }
    ]
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    fallback: {
      "crypto": require.resolve("crypto-browserify"),
      "stream": require.resolve("stream-browserify"),
      "buffer": require.resolve("buffer"),
      "path": require.resolve("path-browserify"),
      "util": require.resolve("util"),
      "process": require.resolve("process/browser"),
      "vm": false,
      "os": require.resolve("os-browserify/browser"),
      "fs": false,
      "tls": false,
      "net": false,
      "http": require.resolve("stream-http"),
      "https": require.resolve("https-browserify"),
      "zlib": require.resolve("browserify-zlib"),
      "dns": false,
      "child_process": false,
      "http2": false,
      "url": require.resolve("url"),
      "assert": require.resolve("assert/"),
      "module": false,
      "worker_threads": false
    },
    alias: {
      'process/browser': require.resolve('process/browser')
    }
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        { from: 'src/manifest.json', to: 'manifest.json' },
        { from: 'src/options.html', to: 'options.html' },
        { from: 'src/styles.css', to: 'styles.css' },
        { from: 'src/icons', to: 'icons' },
        { 
          from: '../../node_modules/.pnpm/onnxruntime-web@*/node_modules/onnxruntime-web/dist/*.wasm',
          to: '[name][ext]'
        }
      ]
    }),
    new webpack.ProvidePlugin({
      process: 'process/browser',
      Buffer: ['buffer', 'Buffer']
    }),
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify('production'),
      'global': 'globalThis'
    }),
    new webpack.NormalModuleReplacementPlugin(
      /^vm$/,
      require.resolve('./src/vm-stub.js')
    )
  ],
  target: 'web',
  optimization: {
    minimize: true,
    minimizer: [
      new (require('terser-webpack-plugin'))({
        terserOptions: {
          compress: {
            drop_console: false,
            drop_debugger: true,
            pure_funcs: ['console.debug']
          },
          mangle: {
            safari10: true
          },
          output: {
            comments: false,
            safari10: true
          }
        },
        extractComments: false
      })
    ]
  },
  node: {
    global: false,
    __filename: false,
    __dirname: false
  }
};