// tree-sitter's JavaScript wrapper patches the prototypes of its native
// classes when it is evaluated, and the native addon is shared by the whole
// process. Jest evaluates modules again for every test file, and a second
// evaluation captures the already patched methods instead of the native ones,
// so parsing stops returning syntax trees in every test file after the first
// one that loads tree-sitter. Load the wrapper through Node's own module
// system instead, so that all test files share the single instance a normal
// process would use. (`process.getBuiltinModule` bypasses Jest's sandboxed
// `module`; it is missing before Node 20.16, where the default loading is
// kept.)
const nodeModule = process.getBuiltinModule?.('module');

module.exports = nodeModule
    ? nodeModule.createRequire(__filename)('tree-sitter')
    : jest.requireActual('tree-sitter');
