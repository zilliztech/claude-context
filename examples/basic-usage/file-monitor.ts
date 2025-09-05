import * as fs from 'fs';
import * as path from 'path';
import * as chokidar from 'chokidar';

interface FileChangeEvent {
  type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';
  filename: string;
  fullPath: string;
  timestamp: Date;
  stats?: fs.Stats;
}

interface MonitorOptions {
  projectPath: string;
  ignorePatterns?: string[];
  sourceExtensions?: string[];
  debounceMs?: number;
  onFileChange?: (event: FileChangeEvent) => void;
  usePolling?: boolean;
  pollingInterval?: number;
}

class ProjectFileMonitor {
  private options: MonitorOptions;
  private watcher: chokidar.FSWatcher | null = null;
  private changeBuffer: Map<string, NodeJS.Timeout> = new Map();
  private isWatching = false;

  constructor(options: MonitorOptions) {
    this.options = {
      ignorePatterns: [
        // Common build output and dependency directories
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/obj/**',
        '**/Logs/**',
        '**/QLogs/**',
        '**/QLocal/**',
        '**/objd/**',
        '**/out/**',
        '**/target/**',
        '**/coverage/**',
        '**/packages/',
        '**/corext/**',
        '**.nyc_output/**',
        '**/azuredevops/**',
        '.config/**',

        // IDE and editor files
        '.vscode/**',
        '.idea/**',
        '*.swp',
        '*.swo',

        // Version control
        '.git/**',
        '.svn/**',
        '.hg/**',

        // Cache directories
        '.cache/**',
        '__pycache__/**',
        '.pytest_cache/**',

        // Logs and temporary files
        'logs/**',
        'tmp/**',
        'temp/**',
        '*.log',

        // Environment and config files
        '.env',
        '.env.*',
        '*.local',

        // Minified and bundled files
        '*.min.js',
        '*.min.css',
        '*.min.map',
        '*.bundle.js',
        '*.bundle.css',
        '*.chunk.js',
        '*.vendor.js',
        '*.polyfills.js',
        '*.runtime.js',
        '*.map', // source map files
        'node_modules', '.git', '.svn', '.hg', 'build', 'dist', 'out',
        'target', '.vscode', '.idea', '__pycache__', '.pytest_cache',
        'coverage', '.nyc_output', 'logs', 'tmp', 'temp',
        '.editorconfig',
        '.gitattributes',

        // for AdsSnR Test
        '**/AdsSnR_RocksDB/**',
        '**/AdsSnR_PClick/**',
        '**/AdsSnR_FeatureExtraction/**',
        '**/AdsSnR_Selection/**',
        '**/AdsSnR_Common/**',
        '**/AdsSnR_IdHash/**',
        '**/packages/**',
        '.github/',
        'AI/**',
      ],
      sourceExtensions: [
        // Source code files
        '.js', '.py', '.java', '.cpp', '.cc', '.cxx', '.c', '.h', '.hpp', '.hxx',
        '.cs', '.html', '.htm', '.json', '.xml', '.yaml', '.yml', '.toml', '.ini',
        '.md'
      ],
      debounceMs: 100,
      usePolling: false,
      pollingInterval: 1000,
      ...options
    };
  }

  /**
   * Check if a file should be ignored based on ignore patterns
   */
  private shouldIgnoreFile(filePath: string): boolean {
    const relativePath = path.relative(this.options.projectPath, filePath);
    
    // Check ignore patterns
    for (const pattern of this.options.ignorePatterns!) {
      if (this.matchesPattern(relativePath, pattern)) {
        return true;
      }
    }
    
    // Check if it's a source code file
    const ext = path.extname(filePath).toLowerCase();
    if (!this.options.sourceExtensions!.includes(ext)) {
      return true;
    }
    
    return false;
  }

  /**
   * Simple pattern matching for ignore patterns
   */
  private matchesPattern(filePath: string, pattern: string): boolean {
    // Convert pattern to regex
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]');
    
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(filePath);
  }

  /**
   * Debounced file change handler
   */
  private handleFileChange(eventType: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir', filePath: string, stats?: fs.Stats): void {
    // Check if file should be ignored
    if (this.shouldIgnoreFile(filePath)) {
      return;
    }
    
    // Debounce the event
    const key = `${eventType}:${filePath}`;
    if (this.changeBuffer.has(key)) {
      clearTimeout(this.changeBuffer.get(key)!);
    }
    
    const timeout = setTimeout(() => {
      this.changeBuffer.delete(key);
      
      const filename = path.basename(filePath);
      const event: FileChangeEvent = {
        type: eventType,
        filename,
        fullPath: filePath,
        timestamp: new Date(),
        stats
      };
      
      if (this.options.onFileChange) {
        this.options.onFileChange(event);
      }
      
      console.log(`[${event.timestamp.toISOString()}] ${eventType}: ${filename}`);
      
    }, this.options.debounceMs);
    
    this.changeBuffer.set(key, timeout);
  }

  /**
   * Start monitoring the project folder
   */
  start(): void {
    if (this.isWatching) {
      console.warn('File monitor is already running');
      return;
    }

    try {
      // Verify project path exists and is accessible
      if (!fs.existsSync(this.options.projectPath)) {
        throw new Error(`Project path does not exist: ${this.options.projectPath}`);
      }

      const stats = fs.statSync(this.options.projectPath);
      if (!stats.isDirectory()) {
        throw new Error(`Project path is not a directory: ${this.options.projectPath}`);
      }

      console.log(`Starting file monitor for: ${this.options.projectPath}`);
      console.log(`Watching for source files with extensions: ${this.options.sourceExtensions!.join(', ')}`);
      console.log(`Ignoring patterns: ${this.options.ignorePatterns!.length} patterns configured`);
      console.log(`Using polling: ${this.options.usePolling ? 'Yes' : 'No'}`);

      // Create chokidar watcher with optimized settings
      this.watcher = chokidar.watch(this.options.projectPath, {
        ignored: this.options.ignorePatterns,
        persistent: true,
        ignoreInitial: true, // Don't trigger events for existing files on startup
        awaitWriteFinish: {
          stabilityThreshold: 100, // Wait 100ms after file stops changing
          pollInterval: 100 // Check every 100ms
        },
        usePolling: this.options.usePolling,
        interval: this.options.pollingInterval,
        binaryInterval: 3000, // Check binary files less frequently
        alwaysStat: false, // Only get stats when needed
        depth: 99, // Watch all subdirectories
        followSymlinks: false, // Don't follow symlinks for performance
        //disableGlobbing: false, // Enable globbing for ignore patterns
        ignorePermissionErrors: true, // Ignore permission errors
        atomic: true, // Handle atomic writes properly
        //useFsEvents: !this.options.usePolling, // Use native events when possible
        //useFsEventsOnParentDirectory: true // Watch parent directories for better coverage
      });

      // Set up event handlers
      this.watcher
        .on('add', (filePath, stats) => {
          this.handleFileChange('add', filePath, stats);
        })
        .on('change', (filePath, stats) => {
          this.handleFileChange('change', filePath, stats);
        })
        .on('unlink', (filePath) => {
          this.handleFileChange('unlink', filePath);
        })
        .on('addDir', (dirPath) => {
          this.handleFileChange('addDir', dirPath);
        })
        .on('unlinkDir', (dirPath) => {
          this.handleFileChange('unlinkDir', dirPath);
        })
        .on('error', (error) => {
          console.error('File watcher error:', error);
        })
        .on('ready', () => {
          console.log('File monitor is ready and watching for changes');
        });

      this.isWatching = true;
      console.log('File monitor started successfully');

    } catch (error) {
      console.error('Failed to start file monitor:', error);
      throw error;
    }
  }

  /**
   * Stop monitoring the project folder
   */
  stop(): void {
    if (!this.isWatching) {
      return;
    }

    // Clear all pending timeouts
    for (const timeout of this.changeBuffer.values()) {
      clearTimeout(timeout);
    }
    this.changeBuffer.clear();

    // Stop the watcher
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    this.isWatching = false;
    console.log('File monitor stopped');
  }

  /**
   * Get current monitoring status
   */
  isRunning(): boolean {
    return this.isWatching;
  }

  /**
   * Get current options
   */
  getOptions(): MonitorOptions {
    return { ...this.options };
  }

  /**
   * Get watched paths (for debugging)
   */
  getWatchedPaths(): { [key: string]: string[] } {
    return this.watcher ? this.watcher.getWatched() : {};
  }
}

/**
 * Main function to monitor a project folder for source code changes
 */
async function main(): Promise<void> {
  // Configuration
  const projectPath = "D:/src/AdsSnR";
//   const projectPath = process.argv[2] || process.cwd();
  const options: MonitorOptions = {
    projectPath,
    usePolling: false, // Use native file system events for better performance
    onFileChange: (event) => {
      // Custom handler for file changes
      console.log(`Source code change detected: ${event.filename}`);
      console.log(`Event type: ${event.type}`);
      console.log(`File path: ${event.fullPath}`);
      
      // You can add custom logic here:
      // - Trigger rebuilds
      // - Run tests
      // - Update documentation
      // - Send notifications
      // - etc.
    }
  };

  // Create and start the monitor
  const monitor = new ProjectFileMonitor(options);

  try {
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\nReceived SIGINT, stopping file monitor...');
      monitor.stop();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('\nReceived SIGTERM, stopping file monitor...');
      monitor.stop();
      process.exit(0);
    });

    // Start monitoring
    monitor.start();

    console.log('\nFile monitor is running. Press Ctrl+C to stop.');
    console.log(`Monitoring project: ${projectPath}`);
    console.log('Using chokidar for efficient file watching');
    console.log('Only real file changes will trigger events (not access time changes)');
    
    // Keep the process running
    await new Promise(() => {});

  } catch (error) {
    console.error('Failed to start file monitor:', error);
    process.exit(1);
  }
}

// Export for use as a module
export { ProjectFileMonitor, FileChangeEvent, MonitorOptions, main };

// Run main function if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}
