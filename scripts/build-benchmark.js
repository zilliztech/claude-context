#!/usr/bin/env node

/**
 * Build performance benchmarking script
 * Measures and reports build times for all packages
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BENCHMARK_FILE = 'build-benchmark.json';

function measureBuildTime(command, description) {
    console.log(`\n🔄 ${description}...`);
    const startTime = Date.now();
    
    try {
        execSync(command, { stdio: 'inherit' });
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        console.log(`✅ ${description} completed in ${duration}ms`);
        return { success: true, duration, command, description };
    } catch (error) {
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        console.error(`❌ ${description} failed after ${duration}ms`);
        return { success: false, duration, command, description, error: error.message };
    }
}

function saveBenchmark(results) {
    const benchmark = {
        timestamp: new Date().toISOString(),
        platform: process.platform,
        nodeVersion: process.version,
        results
    };
    
    let history = [];
    if (fs.existsSync(BENCHMARK_FILE)) {
        try {
            history = JSON.parse(fs.readFileSync(BENCHMARK_FILE, 'utf8'));
        } catch (e) {
            console.warn('Could not read existing benchmark file');
        }
    }
    
    history.push(benchmark);
    
    // Keep only last 10 benchmarks
    if (history.length > 10) {
        history = history.slice(-10);
    }
    
    fs.writeFileSync(BENCHMARK_FILE, JSON.stringify(history, null, 2));
    console.log(`\n📊 Benchmark saved to ${BENCHMARK_FILE}`);
}

function main() {
    console.log('🚀 Starting build performance benchmark...');
    
    const results = [];
    
    // Clean first
    results.push(measureBuildTime('pnpm clean', 'Clean all packages'));
    
    // Build individual packages
    results.push(measureBuildTime('pnpm build:core', 'Build core package'));
    results.push(measureBuildTime('pnpm build:mcp', 'Build MCP package'));
    results.push(measureBuildTime('pnpm build:vscode', 'Build VSCode extension'));
    
    // Full build
    results.push(measureBuildTime('pnpm -r --filter="./packages/chrome-extension" build', 'Build Chrome extension'));
    
    const totalTime = results.reduce((sum, result) => sum + result.duration, 0);
    const successCount = results.filter(r => r.success).length;
    
    console.log(`\n📈 Benchmark Summary:`);
    console.log(`   Total time: ${totalTime}ms`);
    console.log(`   Successful builds: ${successCount}/${results.length}`);
    console.log(`   Platform: ${process.platform}`);
    console.log(`   Node version: ${process.version}`);
    
    saveBenchmark(results);
}

if (require.main === module) {
    main();
}

module.exports = { measureBuildTime, saveBenchmark };
