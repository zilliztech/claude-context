/**
 * Dart AST Split Verification Script
 * Run: npx ts-node examples/dart-split-verify.ts
 *
 * Verifies that Dart code is split correctly using the AstCodeSplitter.
 * Falls back gracefully to LangChain splitter if tree-sitter-dart native
 * binding is unavailable.
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

async function verify() {
    const splitter = new AstCodeSplitter(1000, 200);

    console.log('=== Dart AST Split Verification ===\n');
    console.log('Input Dart code:\n', DART_SAMPLE);

    const chunks = await splitter.split(DART_SAMPLE, 'dart', 'sample.dart');

    console.log(`\nProduced ${chunks.length} chunk(s):`);
    chunks.forEach((chunk, i) => {
        console.log(`\n--- Chunk ${i + 1} (lines ${chunk.metadata.startLine}-${chunk.metadata.endLine}) ---`);
        console.log(chunk.content.substring(0, 200) + (chunk.content.length > 200 ? '...' : ''));
    });

    const astSupported = AstCodeSplitter.isLanguageSupported('dart');
    console.log(`\nAST-based Dart splitting: ${astSupported ? '✅ supported' : '⚠️  using LangChain fallback'}`);
}

verify().catch(console.error);
