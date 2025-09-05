import * as fs from 'fs';
import * as path from 'path';
import { FSWatcher, watch } from 'chokidar';
import { Context } from '@suoshengzhang/claude-context-core';
import { matchesIgnorePattern } from '@suoshengzhang/claude-context-core';

// Simple semaphore implementation for thread safety
class Semaphore {
  private permits: number;
  private waitingQueue: Array<() => void> = [];

  constructor(permits: number = 1) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    return new Promise((resolve) => {
      if (this.permits > 0) {
        this.permits--;
        resolve();
      } else {
        this.waitingQueue.push(resolve);
      }
    });
  }

  release(): void {
    if (this.waitingQueue.length > 0) {
      const next = this.waitingQueue.shift()!;
      next();
    } else {
      this.permits++;
    }
  }
}

export interface FileChangeEvent {
  type: 'add' | 'change';
  filename: string;
  fullPath: string;
  timestamp: Date;
  stats?: fs.Stats;
}

export interface MonitorOptions {
  usePolling?: boolean;
  pollingInterval?: number;
  queueProcessInterval?: number; // Interval for processing the queue (in ms)
}

export class ProjectFileMonitor {
  private options: MonitorOptions;
  private watcher: FSWatcher | null = null;
  private isWatching = false;
  private context: Context;
  private codebasePath: string;
  private isProcessRunning = false;
  
  // Queue-based file change tracking
  private fileChangeQueue: Set<string> = new Set(); // Using Set for automatic deduplication
  private queueSemaphore: Semaphore = new Semaphore(1);
  private queueProcessorInterval: NodeJS.Timeout | null = null;

  constructor(options: MonitorOptions, context: Context, codebasePath: string) {
    this.options = {
      queueProcessInterval: 3000, // Default 2 seconds
      ...options
    };
    this.context = context;
    this.codebasePath = codebasePath;
  }

  /**
   * Add file path to the queue (thread-safe with deduplication)
   */
  private async addToQueue(filePath: string): Promise<void> {
    await this.queueSemaphore.acquire();
    try {
      this.fileChangeQueue.add(filePath);
    } finally {
      this.queueSemaphore.release();
    }
  }

  /**
   * Process all items in the queue and clear it
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessRunning) {
      console.log(`[FileMonitor] Process is already running. Skipping.`);
      return;
    }

    this.isProcessRunning = true;
    let changedFiles: string[] = [];
    await this.queueSemaphore.acquire();
    try {
      if (this.fileChangeQueue.size === 0) {
        this.isProcessRunning = false;
        return;
      }

      changedFiles = Array.from(this.fileChangeQueue);
      // Clear the queue after processing
      this.fileChangeQueue.clear();
      console.log(`[FileMonitor] Queue cleared. Processed ${changedFiles.length} files.`);
    } finally {
      this.queueSemaphore.release();
    }

    if (changedFiles.length === 0) {
      this.isProcessRunning = false;
      return;
    }

    // update the file hash in snapshot manager to avoid re-indexing
    try {
      await this.context.getSynchronizer(this.codebasePath)?.updateFileHashes(changedFiles);
    } catch (error) {
      console.error(`[FileMonitor] Failed to update file hashes:`, error);
    }

    try {
      const collectionName = this.context.getCollectionName(this.codebasePath);
      if (!await this.context.getVectorDatabase().hasCollection(collectionName)) {
        console.log(`[FileMonitor] Index does not exist for ${collectionName}`);
        return;
      }

      for (const filePath of changedFiles) {
        const relativePath = path.relative(this.codebasePath, filePath);
        const normalizedPath = relativePath.replace(/\//g, '\\');
        console.log(`[FileMonitor] Deleting file chunks for ${normalizedPath}`);
        this.context.deleteFileChunks(collectionName, normalizedPath);
      }

      await this.context.processFileList(
        changedFiles,
        this.codebasePath,
        (filePath, fileIndex, totalFiles) => {
            console.log(`[FileMonitor] Indexed ${filePath} (${fileIndex}/${totalFiles})`);
        }
      );
    } finally {
      this.isProcessRunning = false;
    }
  }

  /**
   * Start the periodic queue processor
   */
  private startQueueProcessor(): void {
    if (this.queueProcessorInterval) {
      return; // Already running
    }

    const interval = this.options.queueProcessInterval || 3000;
    this.queueProcessorInterval = setInterval(async () => {
      await this.processQueue();
    }, interval);

    console.log(`[FileMonitor] Queue processor started with ${interval}ms interval`);
  }

  /**
   * Stop the periodic queue processor
   */
  private stopQueueProcessor(): void {
    if (this.queueProcessorInterval) {
      clearInterval(this.queueProcessorInterval);
      this.queueProcessorInterval = null;
      console.log('[FileMonitor] Queue processor stopped');
    }
  }

  /**
   * Debounced file change handler - now adds to queue instead of immediate callback
   */
  private handleFileChange(eventType: 'add' | 'change', filePath: string, stats?: fs.Stats): void {
    this.addToQueue(filePath);
  }

  private ignoreFile(filePath: string): boolean {
    // Ignore files that don't match configured source extensions
    // Skip if path is not a file
    try {
        const stats = fs.statSync(filePath);
        if (stats.isFile()) {
            const ext = path.extname(filePath);
            if (!this.context.getSupportedExtensions().includes(ext)) {
                return true;
            }
        }
    } catch (err) {
        // If we can't stat the path, ignore it
        return true;
    }
    return matchesIgnorePattern(filePath, this.codebasePath, this.context.getIgnorePatterns());
  }

  /**
   * Start monitoring the project folder
   */
  start(): void {
    if (this.isWatching) {
      console.warn('[FileMonitor] File monitor is already running');
      return;
    }

    try {
      // Verify project path exists and is accessible
      if (!fs.existsSync(this.codebasePath)) {
        throw new Error(`Project path does not exist: ${this.codebasePath}`);
      }

      const stats = fs.statSync(this.codebasePath);
      if (!stats.isDirectory()) {
        throw new Error(`Project path is not a directory: ${this.codebasePath}`);
      }

      console.log(`[FileMonitor] Starting file monitor for: ${this.codebasePath}`);
      console.log(`[FileMonitor] Watching for source files with extensions: ${this.context.getSupportedExtensions().join(', ')}`);
      console.log(`[FileMonitor] Ignoring patterns: ${this.context.getIgnorePatterns().length} patterns configured`);

      // Create chokidar watcher with optimized settings
      this.watcher = watch(this.codebasePath, {
        ignored: [(val: string, stats?: fs.Stats): boolean => {return this.ignoreFile(val);}],
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
        ignorePermissionErrors: true, // Ignore permission errors
        atomic: true, // Handle atomic writes properly
      });

      // Set up event handlers
      this.watcher
        .on('add', (filePath, stats) => {
          this.handleFileChange('add', filePath, stats);
        })
        .on('change', (filePath, stats) => {
          this.handleFileChange('change', filePath, stats);
        })
        .on('error', (error) => {
          console.error('[FileMonitor] File watcher error:', error);
        })
        .on('ready', () => {
          console.log('[FileMonitor] File monitor is ready and watching for changes');
        });

      // Start the queue processor
      this.startQueueProcessor();
      this.isWatching = true;

      console.log('[FileMonitor] File monitor started successfully');

    } catch (error) {
      console.error('[FileMonitor] Failed to start file monitor:', error);
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

    // Stop the queue processor first
    this.stopQueueProcessor();

    // Stop the watcher
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    // Clear the queue
    this.fileChangeQueue.clear();

    this.isWatching = false;
    console.log('[FileMonitor] File monitor stopped');
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

  /**
   * Get current queue status (for debugging)
   */
  async getQueueStatus(): Promise<{ size: number; files: string[] }> {
    await this.queueSemaphore.acquire();
    try {
      return {
        size: this.fileChangeQueue.size,
        files: Array.from(this.fileChangeQueue)
      };
    } finally {
      this.queueSemaphore.release();
    }
  }
}
