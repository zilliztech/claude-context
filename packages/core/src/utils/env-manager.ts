import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class EnvManager {
    private envFilePath: string;

    constructor() {
        const homeDir = os.homedir();
        this.envFilePath = path.join(homeDir, '.context', '.env');
    }

    /**
     * Get environment variable by name
     * Priority: process.env > .env file > undefined
     */
    get(name: string): string | undefined {
        // First try to get from process environment variables
        if (process.env[name]) {
            return process.env[name];
        }

        // If not found in process env, try to read from .env file
        try {
            if (fs.existsSync(this.envFilePath)) {
                const content = fs.readFileSync(this.envFilePath, 'utf-8');
                const lines = content.split('\n');

                for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (trimmedLine.startsWith(`${name}=`)) {
                        return trimmedLine.substring(name.length + 1);
                    }
                }
            }
        } catch (error) {
            // Ignore file read errors
        }

        return undefined;
    }

    /**
     * Set environment variable to the .env file
     */
    set(name: string, value: string): void {
        try {
            // Ensure directory exists
            const envDir = path.dirname(this.envFilePath);
            if (!fs.existsSync(envDir)) {
                fs.mkdirSync(envDir, { recursive: true });
            }

            let content = '';
            let found = false;

            // Read existing content if file exists
            if (fs.existsSync(this.envFilePath)) {
                content = fs.readFileSync(this.envFilePath, 'utf-8');

                // Update existing variable
                const lines = content.split('\n');
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].trim().startsWith(`${name}=`)) {
                        // Replace the existing value
                        lines[i] = `${name}=${value}`;
                        found = true;
                        console.log(`[EnvManager] ✅ Updated ${name} in ${this.envFilePath}`);
                        break;
                    }
                }
                content = lines.join('\n');
            }

            // If variable not found, append it
            if (!found) {
                if (content && !content.endsWith('\n')) {
                    content += '\n';
                }
                content += `${name}=${value}\n`;
                console.log(`[EnvManager] ✅ Added ${name} to ${this.envFilePath}`);
            }

            fs.writeFileSync(this.envFilePath, content, 'utf-8');

        } catch (error) {
            console.error(`[EnvManager] ❌ Failed to write env file: ${error}`);
            throw error;
        }
    }

    /**
     * Get the path to the .env file
     */
    getEnvFilePath(): string {
        return this.envFilePath;
    }
}

// Export a default instance for convenience
export const envManager = new EnvManager(); 