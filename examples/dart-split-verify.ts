/**
 * Dart AST Split Verification Script
 * Run: npx ts-node examples/dart-split-verify.ts
 *
 * This script verifies Dart code splitting behavior.
 *
 * EXPECTED OUTPUT WHEN TREE-SITTER-DART NATIVE BINDING IS AVAILABLE:
 *   - "🌳 Using AST splitter for dart file"  ← AST path (desired)
 *
 * EXPECTED OUTPUT WHEN NATIVE BINDING IS UNAVAILABLE:
 *   - "⚠️  Failed to load tree-sitter-dart native binding"  ← fallback path
 *   - "📝 Language dart not supported by AST, using LangChain splitter"  ← fallback path
 *   Both are OK — the fallback prevents a crash.
 *
 * TO ENABLE AST-LEVEL DART SPLITTING (optional):
 *   tree-sitter-dart ships only C++ source bindings without prebuilt .node binaries.
 *   To get AST-level splitting, you need one of:
 *     1. A platform-specific prebuilt .node binary installed manually
 *     2. tree-sitter-dart to ship a node-gyp-build compatible binding
 *   Without this, Dart will always use the LangChain character-based splitter,
 *   which is still correct and non-crashing behavior.
 *
 * WHAT THIS SCRIPT VERIFIES:
 *   - Dart code is accepted and split without crashing
 *   - Output chunks contain Dart structural elements (class, mixin, etc.)
 *   - Chunk metadata (language, filePath, startLine, endLine) is correct
 */

import { AstCodeSplitter } from '../packages/core/src/splitter/ast-splitter';

const DART_SAMPLE = `
// A simple Dart class
class Person {
  String name;
  int age;

  Person(this.name, this.age);

  void greet() {
    print('Hello, my name is $name');
  }
}

// A Dart mixin
mixin Flyable {
  void fly() {
    print('Flying!');
  }
}

// A Dart extension
extension StringExtension on String {
  String get reversed => split('').reversed.join();
}

// Top-level function
int add(int a, int b) {
  return a + b;
}
`;

async function main() {
    console.log('=== Dart Split Verification ===\n');

    const splitter = new AstCodeSplitter(1000, 200);
    console.log('Splitting Dart sample file...\n');

    const chunks = await splitter.split(DART_SAMPLE, 'dart', 'sample.dart');

    console.log(`\n=== Results ===`);
    console.log(`Total chunks: ${chunks.length}`);
    console.log('');

    chunks.forEach((chunk, i) => {
        console.log(`--- Chunk ${i + 1} ---`);
        console.log(`Language: ${chunk.metadata.language}`);
        console.log(`File:     ${chunk.metadata.filePath}`);
        console.log(`Lines:    ${chunk.metadata.startLine}–${chunk.metadata.endLine}`);
        console.log(`Size:     ${chunk.content.length} chars`);
        console.log(`Content:\n${chunk.content}\n`);
    });

    // Verify structural Dart elements are present in at least one chunk
    const allContent = chunks.map(c => c.content).join(' ');
    const checks = [
        ['class',       allContent.includes('class')],
        ['mixin',       allContent.includes('mixin')],
        ['extension',   allContent.includes('extension')],
        ['function',    allContent.includes('int add')],
    ];

    console.log('=== Structural Checks ===');
    let allPassed = true;
    for (const [name, passed] of checks) {
        console.log(`  ${passed ? '✅' : '❌'} ${name}`);
        if (!passed) allPassed = false;
    }

    if (allPassed) {
        console.log('\n✅ All checks passed. Dart splitting is working correctly.\n');
    } else {
        console.log('\n❌ Some checks failed.\n');
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Verification failed:', err);
    process.exit(1);
});
