import { spawn, ChildProcess, exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { get } from 'https';

export class ChromaManager {
    private chromaProcess: ChildProcess | null = null;
    private isRunning: boolean = false;
    private restartInterval: NodeJS.Timeout | null = null;
    private healthCheckInterval: NodeJS.Timeout | null = null;
    private restartAttempts: number = 0;
    private maxRestartAttempts: number = 5;
    private restartDelay: number = 5000; // 5 seconds

    constructor(
        private readonly chromaWorkingDir: string,
        private readonly healthCheckIntervalMs: number = 30000 // 30 seconds
    ) { }

    /**
     * Start the Chroma process
     */
    public async start(): Promise<void> {
        if (this.isRunning) {
            console.log('[CHROMA] Chroma process is already running');
            return;
        }

        console.log('[CHROMA] Starting Chroma process...');
        console.log(`[CHROMA] Working directory: ${this.chromaWorkingDir}`);

        try {
            // First, check for and terminate any existing chroma_starter.exe processes
            await this.terminateExistingChromaProcesses();
            await this.spawnChromaProcess();
            this.startHealthCheck();
            this.isRunning = true;
            console.log('[CHROMA] Chroma process started successfully');
        } catch (error) {
            console.error('[CHROMA] Failed to start Chroma process:', error);
            throw error;
        }
    }

    /**
     * Stop the Chroma process
     */
    public async stop(): Promise<void> {
        console.log('[CHROMA] Stopping Chroma process...');

        this.isRunning = false;

        // Clear intervals
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }

        if (this.restartInterval) {
            clearTimeout(this.restartInterval);
            this.restartInterval = null;
        }

        // Kill the process
        if (this.chromaProcess) {
            try {
                this.chromaProcess.kill('SIGTERM');

                // Give it a moment to terminate gracefully
                await new Promise(resolve => setTimeout(resolve, 2000));

                // Force kill if still running
                if (!this.chromaProcess.killed) {
                    this.chromaProcess.kill('SIGKILL');
                }
            } catch (error) {
                console.error('[CHROMA] Error stopping Chroma process:', error);
            }

            this.chromaProcess = null;
        }

        console.log('[CHROMA] Chroma process stopped');
    }

    /**
     * Terminate any existing chroma_starter.exe processes
     */
    private async terminateExistingChromaProcesses(): Promise<void> {
        console.log('[CHROMA] Checking for existing chroma_starter.exe processes...');

        try {
            const processes = await this.findChromaProcesses();

            if (processes.length === 0) {
                console.log('[CHROMA] No existing chroma_starter.exe processes found');
                return;
            }

            console.log(`[CHROMA] Found ${processes.length} existing chroma_starter.exe process(es): ${processes.map(p => p.pid).join(', ')}`);

            // Terminate each process
            for (const process of processes) {
                await this.terminateProcess(process.pid);
            }

            // Wait a moment for processes to terminate
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Verify all processes are terminated
            const remainingProcesses = await this.findChromaProcesses();
            if (remainingProcesses.length > 0) {
                console.warn(`[CHROMA] Warning: ${remainingProcesses.length} chroma_starter.exe process(es) still running after termination attempt`);
            } else {
                console.log('[CHROMA] All existing chroma_starter.exe processes terminated successfully');
            }

        } catch (error) {
            console.error('[CHROMA] Error while terminating existing processes:', error);
            // Continue anyway - don't fail the startup
        }
    }

    /**
     * Find all running chroma_starter.exe processes
     */
    private async findChromaProcesses(): Promise<Array<{ pid: number, command: string }>> {
        return new Promise((resolve, reject) => {
            const platform = process.platform;
            let command: string;

            if (platform === 'win32') {
                // Windows: use tasklist to find processes
                command = 'tasklist /FI "IMAGENAME eq chroma_starter.exe" /FO CSV /NH';
            } else {
                // Unix-like: use ps to find processes
                command = 'ps aux | grep chroma_starter.exe | grep -v grep';
            }

            exec(command, (error, stdout, stderr) => {
                if (error) {
                    // If no processes found, that's fine
                    if (error.code === 1 && platform === 'win32') {
                        resolve([]);
                        return;
                    }
                    reject(error);
                    return;
                }

                const processes: Array<{ pid: number, command: string }> = [];

                if (platform === 'win32') {
                    // Parse Windows tasklist output
                    const lines = stdout.trim().split('\n');
                    for (const line of lines) {
                        if (line.includes('chroma_starter.exe')) {
                            const parts = line.split(',');
                            if (parts.length >= 2) {
                                const pidStr = parts[1].replace(/"/g, '').trim();
                                const pid = parseInt(pidStr);
                                if (!isNaN(pid)) {
                                    processes.push({ pid, command: 'chroma_starter.exe' });
                                }
                            }
                        }
                    }
                } else {
                    // Parse Unix ps output
                    const lines = stdout.trim().split('\n');
                    for (const line of lines) {
                        const parts = line.trim().split(/\s+/);
                        if (parts.length >= 2) {
                            const pid = parseInt(parts[1]);
                            if (!isNaN(pid)) {
                                processes.push({ pid, command: parts[10] || 'chroma_starter.exe' });
                            }
                        }
                    }
                }

                resolve(processes);
            });
        });
    }

    /**
     * Terminate a process by PID
     */
    private async terminateProcess(pid: number): Promise<void> {
        return new Promise((resolve, reject) => {
            const platform = process.platform;
            let command: string;

            if (platform === 'win32') {
                // Windows: use taskkill
                command = `taskkill /PID ${pid} /F`;
            } else {
                // Unix-like: use kill
                command = `kill -9 ${pid}`;
            }

            exec(command, (error, stdout, stderr) => {
                if (error) {
                    console.warn(`[CHROMA] Warning: Failed to terminate process ${pid}:`, error.message);
                    // Don't reject - just log the warning
                } else {
                    console.log(`[CHROMA] Successfully terminated process ${pid}`);
                }
                resolve();
            });
        });
    }

    /**
     * Check if the Chroma process is alive
     */
    public isAlive(): boolean {
        return this.chromaProcess !== null &&
            !this.chromaProcess.killed &&
            this.chromaProcess.exitCode === null;
    }

    /**
     * Get the current status of the Chroma process
     */
    public getStatus(): { isRunning: boolean; isAlive: boolean; restartAttempts: number } {
        return {
            isRunning: this.isRunning,
            isAlive: this.isAlive(),
            restartAttempts: this.restartAttempts
        };
    }

    /**
     * Spawn the Chroma process
     */
    private async spawnChromaProcess(): Promise<void> {
        if (this.chromaProcess && !this.chromaProcess.killed) {
            console.log('[CHROMA] Chroma process already exists, killing it first');
            this.chromaProcess.kill('SIGTERM');
        }

        console.log('[CHROMA] Spawning new Chroma process...');

        // Get the executable path from user's home directory
        const chromaExePath = await ChromaManager.getChromaExePath();
        console.log(`[CHROMA] Executable command: ${chromaExePath} run --path ${this.chromaWorkingDir}`);

        this.chromaProcess = spawn(chromaExePath, ['run', '--path', this.chromaWorkingDir], {
            // cwd: this.chromaWorkingDir,
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: false
        });

        // Handle process events
        this.chromaProcess.on('error', (error) => {
            console.error('[CHROMA] Process error:', error);
            this.handleProcessDeath();
        });

        this.chromaProcess.on('exit', (code, signal) => {
            console.log(`[CHROMA] Process exited with code ${code} and signal ${signal}`);
            this.handleProcessDeath();
        });

        // Handle stdout and stderr
        if (this.chromaProcess.stdout) {
            this.chromaProcess.stdout.on('data', (data) => {
                console.log(`[CHROMA-STDOUT] ${data.toString().trim()}`);
            });
        }

        if (this.chromaProcess.stderr) {
            this.chromaProcess.stderr.on('data', (data) => {
                console.error(`[CHROMA-STDERR] ${data.toString().trim()}`);
            });
        }

        console.log(`[CHROMA] Process spawned with PID: ${this.chromaProcess.pid}`);
    }

    /**
     * Handle process death and restart if needed
     */
    private handleProcessDeath(): void {
        if (!this.isRunning) {
            console.log('[CHROMA] Process died but manager is not running, not restarting');
            return;
        }

        if (this.restartAttempts >= this.maxRestartAttempts) {
            console.error(`[CHROMA] Max restart attempts (${this.maxRestartAttempts}) reached, not restarting`);
            this.isRunning = false;
            return;
        }

        this.restartAttempts++;
        console.log(`[CHROMA] Process died, attempting restart ${this.restartAttempts}/${this.maxRestartAttempts} in ${this.restartDelay}ms`);

        this.restartInterval = setTimeout(() => {
            try {
                this.spawnChromaProcess();
                console.log('[CHROMA] Process restarted successfully');
            } catch (error) {
                console.error('[CHROMA] Failed to restart process:', error);
                this.handleProcessDeath(); // Try again
            }
        }, this.restartDelay);
    }

    /**
     * Start periodic health check
     */
    private startHealthCheck(): void {
        this.healthCheckInterval = setInterval(() => {
            if (!this.isRunning) {
                return;
            }

            if (!this.isAlive()) {
                console.log('[CHROMA] Health check failed - process is not alive');
                this.handleProcessDeath();
            } else {
                console.log('[CHROMA] Health check passed - process is alive');
                // Reset restart attempts on successful health check
                this.restartAttempts = 0;
            }
        }, this.healthCheckIntervalMs);
    }

    /**
     * Get the Chroma executable path, downloading it if necessary
     */
    public static async getChromaExePath(): Promise<string> {
        // If not found in node_modules, check user's .context directory
        const userContextDir = path.join(os.homedir(), '.context');
        const userContextExePath = path.join(userContextDir, 'chroma_starter.exe');

        try {
            if (fs.existsSync(userContextExePath)) {
                console.log(`[CHROMA] Found chroma_starter.exe in user context: ${userContextExePath}`);
                return userContextExePath;
            }
        } catch (error) {
            console.warn(`[CHROMA] Error checking user context directory:`, error);
        }

        // If not found anywhere, download it
        console.log(`[CHROMA] chroma_starter.exe not found, downloading to user context directory...`);
        await ChromaManager.downloadChromaStarter(userContextExePath);

        return userContextExePath;
    }

    /**
     * Download chroma_starter.exe from GitHub releases
     */
    private static async downloadChromaStarter(targetPath: string): Promise<void> {
        const targetDir = path.dirname(targetPath);
        console.log(`[CHROMA] Creating directory: ${targetDir}`);

        // Ensure the target directory exists
        try {
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }
        } catch (error) {
            throw new Error(`Failed to create directory ${targetDir}: ${error}`);
        }

        let downloadUrl = `https://raw.githubusercontent.com/zhangsuosheng9/code-agent/refs/heads/master/chroma_starter/chroma_starter.exe`;

        console.log(`[CHROMA] Downloading from: ${downloadUrl}`);
        console.log(`[CHROMA] Target path: ${targetPath}`);

        try {
            await ChromaManager.downloadFile(downloadUrl, targetPath);
            console.log(`[CHROMA] Successfully downloaded chroma_starter.exe to: ${targetPath}`);
        } catch (error) {
            throw new Error(`Failed to download chroma_starter.exe: ${error}`);
        }
    }

    /**
     * Download a file from URL to local path
     */
    private static async downloadFile(url: string, targetPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const fileStream = createWriteStream(targetPath);

            get(url, (response) => {
                if (response.statusCode === 302 || response.statusCode === 301) {
                    // Handle redirects
                    const newUrl = response.headers.location;
                    if (newUrl) {
                        console.log(`[CHROMA] Following redirect to: ${newUrl}`);
                        ChromaManager.downloadFile(newUrl, targetPath).then(resolve).catch(reject);
                        return;
                    }
                }

                if (response.statusCode !== 200) {
                    reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                    return;
                }

                response.pipe(fileStream);

                fileStream.on('finish', () => {
                    fileStream.close();
                    resolve();
                });

                fileStream.on('error', (error) => {
                    fs.unlink(targetPath, () => { }); // Delete the file if download failed
                    reject(error);
                });
            }).on('error', (error) => {
                reject(error);
            });
        });
    }
}
