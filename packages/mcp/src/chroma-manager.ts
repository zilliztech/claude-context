import { spawn, exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { get } from 'https';

export class ChromaManager {
    private isRunning: boolean = false;
    private healthCheckInterval: NodeJS.Timeout | null = null;
    private healthCheckIntervalMs: number = 30000; // 30 seconds

    constructor(
        private readonly chromaWorkingDir: string,
        healthCheckIntervalMs: number = 30000 // 30 seconds
    ) {
        this.healthCheckIntervalMs = healthCheckIntervalMs;
    }

    /**
     * Start the Chroma process
     */
    public async start(): Promise<void> {
        if (this.isRunning) {
            console.log('[CHROMA] Chroma manager is already running');
            return;
        }

        console.log('[CHROMA] Starting Chroma manager...');
        console.log(`[CHROMA] Working directory: ${this.chromaWorkingDir}`);

        try {
            if (!fs.existsSync(this.chromaWorkingDir)) {
                fs.mkdirSync(this.chromaWorkingDir, { recursive: true });
                console.log(`[CHROMA] Created working directory: ${this.chromaWorkingDir}`);
            }
        } catch (error) {
            throw new Error(`Failed to create directory ${this.chromaWorkingDir}: ${error}`);
        }

        try {
            // Check if there's already a chroma_starter.exe process running
            const existingProcesses = await this.findChromaProcesses();
            
            if (existingProcesses.length > 0) {
                console.log(`[CHROMA] Found existing chroma_starter.exe process(es): ${existingProcesses.map(p => p.pid).join(', ')}`);
                console.log('[CHROMA] Reusing existing Chroma process');
            } else {
                console.log('[CHROMA] No existing chroma_starter.exe process found, starting new one...');
                await this.spawnChromaProcess();
            }

            this.startHealthCheck();
            this.isRunning = true;
            console.log('[CHROMA] Chroma manager started successfully');
        } catch (error) {
            console.error('[CHROMA] Failed to start Chroma manager:', error);
            throw error;
        }
    }

    /**
     * Stop the Chroma manager
     */
    public async stop(): Promise<void> {
        console.log('[CHROMA] Stopping Chroma manager...');

        this.isRunning = false;

        // Clear health check interval
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }

        console.log('[CHROMA] Chroma manager stopped');
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
     * Check if there are any chroma_starter.exe processes running
     */
    public async isAlive(): Promise<boolean> {
        try {
            const processes = await this.findChromaProcesses();
            return processes.length > 0;
        } catch (error) {
            console.error('[CHROMA] Error checking if Chroma is alive:', error);
            return false;
        }
    }

    /**
     * Get the current status of the Chroma manager
     */
    public async getStatus(): Promise<{ isRunning: boolean; isAlive: boolean }> {
        return {
            isRunning: this.isRunning,
            isAlive: await this.isAlive()
        };
    }

    /**
     * Spawn the Chroma process
     */
    private async spawnChromaProcess(): Promise<void> {
        console.log('[CHROMA] Spawning new Chroma process...');

        // Get the executable path from user's home directory
        const chromaExePath = await ChromaManager.getChromaExePath();
        console.log(`[CHROMA] Executable command: ${chromaExePath} run --port 19801 --path ${this.chromaWorkingDir}`);

        const chromaProcess = spawn(chromaExePath, ['run', '--port', '19801', '--path', this.chromaWorkingDir], {
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: false
        });

        // Handle process events
        chromaProcess.on('error', (error) => {
            console.error('[CHROMA] Process error:', error);
        });

        chromaProcess.on('exit', (code, signal) => {
            console.log(`[CHROMA] Process exited with code ${code} and signal ${signal}`);
        });

        // Handle stdout and stderr
        if (chromaProcess.stdout) {
            chromaProcess.stdout.on('data', (data) => {
                console.log(`[CHROMA-STDOUT] ${data.toString().trim()}`);
            });
        }

        if (chromaProcess.stderr) {
            chromaProcess.stderr.on('data', (data) => {
                console.error(`[CHROMA-STDERR] ${data.toString().trim()}`);
            });
        }

        console.log(`[CHROMA] Process spawned with PID: ${chromaProcess.pid}`);
    }

    /**
     * Start periodic health check
     */
    private startHealthCheck(): void {
        this.healthCheckInterval = setInterval(async () => {
            if (!this.isRunning) {
                return;
            }

            const isAlive = await this.isAlive();
            if (!isAlive) {
                console.log('[CHROMA] Health check failed - no chroma_starter.exe process found, starting new one...');
                try {
                    await this.spawnChromaProcess();
                    console.log('[CHROMA] New Chroma process started successfully');
                } catch (error) {
                    console.error('[CHROMA] Failed to start new Chroma process:', error);
                }
            } else {
                console.log('[CHROMA] Health check passed - chroma_starter.exe process is running');
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

        let downloadUrl = `https://github.com/tiantiaw/chroma_starter/releases/download/v1.0.0/chroma_starter.exe`;

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
            const fileStream = fs.createWriteStream(targetPath);

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
