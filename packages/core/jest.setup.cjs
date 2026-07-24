// Redirect the embedding cache to a throwaway directory during tests so the
// suite never reads from or writes to the developer's real
// `~/.context/embedding-cache`. Individual tests that assert on embedder calls
// can still set EMBEDDING_CACHE=false to bypass the cache entirely.
const os = require('os');
const path = require('path');

process.env.EMBEDDING_CACHE_DIR = path.join(
    os.tmpdir(),
    `claude-context-test-embcache-${process.pid}`
);
