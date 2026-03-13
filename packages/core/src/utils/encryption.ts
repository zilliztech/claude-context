import * as crypto from 'crypto';
import { envManager } from './env-manager';

/**
 * Encryption utility class for content encryption/decryption
 * Uses AES-256-CBC for content encryption
 */
export class EncryptionManager {
    private static readonly ALGORITHM = 'aes-256-cbc';
    private static readonly KEY_LENGTH = 32; // 256 bits
    private static readonly IV_LENGTH = 16; // 128 bits

    private encryptionKey: Buffer | null = null;
    private isEncryptionEnabled: boolean = false;

    constructor(enableEncryption: boolean = true) {
        this.initializeEncryption(enableEncryption);
    }

    /**
     * Initialize encryption based on environment variables and enablement flag
     * @param enableEncryption Whether encryption should be enabled (controlled by caller)
     */
    private initializeEncryption(enableEncryption: boolean): void {
        const encryptionKey = envManager.get('CONTEXT_ENCRYPTION_KEY');

        // If encryption is disabled by caller (e.g., due to hybrid mode), don't enable it
        if (!enableEncryption) {
            this.isEncryptionEnabled = false;
            if (encryptionKey) {
                console.log('[Encryption] ⚠️  Content encryption disabled by system configuration');
            } else {
                console.log('[Encryption] ℹ️  Content encryption disabled');
            }
            return;
        }

        if (encryptionKey) {
            try {
                // If key is provided as hex string, convert to buffer
                if (encryptionKey.length === 64 && /^[0-9a-fA-F]+$/.test(encryptionKey)) {
                    this.encryptionKey = Buffer.from(encryptionKey, 'hex');
                } else {
                    // If key is provided as string, hash it to get consistent 32-byte key
                    this.encryptionKey = crypto.createHash('sha256').update(encryptionKey, 'utf-8').digest();
                }

                this.isEncryptionEnabled = true;
                console.log('[Encryption] ✅ Content encryption enabled');
            } catch (error) {
                console.warn('[Encryption] ⚠️  Failed to initialize encryption key:', error);
                this.isEncryptionEnabled = false;
            }
        } else {
            this.isEncryptionEnabled = false;
            console.log('[Encryption] ℹ️  Content encryption disabled (no CONTEXT_ENCRYPTION_KEY found)');
        }
    }

    /**
     * Check if encryption is enabled
     */
    isEnabled(): boolean {
        return this.isEncryptionEnabled;
    }

    /**
     * Encrypt content using AES-256-CBC
     * @param content Content to encrypt
     * @returns Encrypted content as base64 string with format: iv:encryptedData
     */
    encrypt(content: string): string {
        if (!this.isEncryptionEnabled || !this.encryptionKey) {
            return content; // Return original content if encryption is disabled
        }

        try {
            // Generate random IV for each encryption
            const iv = crypto.randomBytes(EncryptionManager.IV_LENGTH);

            // Create cipher using the modern API
            const cipher = crypto.createCipheriv('aes-256-cbc', this.encryptionKey, iv);

            // Encrypt the content
            let encrypted = cipher.update(content, 'utf8', 'hex');
            encrypted += cipher.final('hex');

            // Combine iv and encrypted data
            const result = iv.toString('hex') + ':' + encrypted;

            return Buffer.from(result).toString('base64');
        } catch (error) {
            console.error('[Encryption] ❌ Failed to encrypt content:', error);
            throw new Error('Failed to encrypt content');
        }
    }

    /**
     * Decrypt content using AES-256-CBC
     * @param encryptedContent Encrypted content as base64 string
     * @returns Decrypted content as string
     */
    decrypt(encryptedContent: string): string {
        if (!this.isEncryptionEnabled || !this.encryptionKey) {
            return encryptedContent; // Return original content if encryption is disabled
        }

        try {
            // Parse the encrypted data
            const data = Buffer.from(encryptedContent, 'base64').toString();
            const parts = data.split(':');

            if (parts.length !== 2) {
                throw new Error('Invalid encrypted data format');
            }

            // Extract IV and encrypted content
            const iv = Buffer.from(parts[0], 'hex');
            const encrypted = parts[1];

            // Create decipher using the modern API
            const decipher = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, iv);

            // Decrypt the content
            let decrypted = decipher.update(encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');

            return decrypted;
        } catch (error) {
            console.error('[Encryption] ❌ Failed to decrypt content:', error);
            throw new Error('Failed to decrypt content');
        }
    }

    /**
     * Generate a new encryption key
     * @returns New encryption key as hex string
     */
    static generateKey(): string {
        return crypto.randomBytes(EncryptionManager.KEY_LENGTH).toString('hex');
    }

    /**
     * Encrypt content in batch for performance
     * @param contents Array of content strings to encrypt
     * @returns Array of encrypted content strings
     */
    encryptBatch(contents: string[]): string[] {
        if (!this.isEncryptionEnabled) {
            return contents; // Return original contents if encryption is disabled
        }

        return contents.map(content => this.encrypt(content));
    }

    /**
     * Decrypt content in batch for performance
     * @param encryptedContents Array of encrypted content strings
     * @returns Array of decrypted content strings
     */
    decryptBatch(encryptedContents: string[]): string[] {
        if (!this.isEncryptionEnabled) {
            return encryptedContents; // Return original contents if encryption is disabled
        }

        return encryptedContents.map(content => this.decrypt(content));
    }
}

// Export a default instance for convenience (backward compatibility)
// Note: In practice, Context class should create its own instance with proper hybrid mode detection
export const encryptionManager = new EncryptionManager();
