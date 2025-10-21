Run build performance benchmarks.

This measures the build time for all packages and saves the results to benchmark history.

The benchmark:
- Builds all packages from scratch
- Measures time for each package
- Saves results to scripts/.benchmark-history.json
- Tracks the last 10 runs
- Shows platform and Node version info

Use this to track build performance improvements or regressions.
