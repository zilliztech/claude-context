/**
 * Sample TypeScript file with all AST splitter features
 * This file contains all node types that the AST splitter recognizes for TypeScript:
 * - function_declaration
 * - arrow_function  
 * - class_declaration
 * - method_definition
 * - export_statement
 * - interface_declaration
 * - type_alias_declaration
 */

// Interface declaration - basic interface
interface User {
    id: number;
    name: string;
    email: string;
    createdAt: Date;
    updatedAt: Date;
    isActive: boolean;
}

// Interface declaration - extending interface
interface AdminUser extends User {
    permissions: string[];
    lastLogin?: Date;
    accessLevel: AccessLevel;
}

// Interface declaration - generic interface
interface Repository<T, K = number> {
    findById(id: K): Promise<T | null>;
    create(data: Omit<T, 'id' | 'createdAt' | 'updatedAt'>): Promise<T>;
    update(id: K, data: Partial<T>): Promise<T>;
    delete(id: K): Promise<boolean>;
    findAll(filter?: FilterOptions<T>): Promise<T[]>;
}

// Interface declaration - function interface
interface EventListener<T = any> {
    (event: T): void | Promise<void>;
}

// Interface declaration - complex interface
interface DatabaseConnection {
    readonly isConnected: boolean;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    query<T>(sql: string, params?: any[]): Promise<T[]>;
    transaction<T>(callback: (trx: Transaction) => Promise<T>): Promise<T>;
}

// Type alias declaration - union type
type AccessLevel = 'read' | 'write' | 'admin' | 'super_admin';

// Type alias declaration - object type
type ApiResponse<T> = {
    data: T;
    success: boolean;
    message?: string;
    errors?: string[];
    meta?: {
        page?: number;
        limit?: number;
        total?: number;
    };
};

// Type alias declaration - function type
type ValidationRule<T> = (value: T) => boolean | string;

// Type alias declaration - complex conditional type
type FilterOptions<T> = {
    [K in keyof T]?: T[K] | { $in: T[K][] } | { $gt: T[K] } | { $lt: T[K] };
} & {
    $or?: FilterOptions<T>[];
    $and?: FilterOptions<T>[];
};

// Type alias declaration - mapped type
type Partial<T> = {
    [P in keyof T]?: T[P];
};

// Type alias declaration - utility type
type EventMap = {
    'user:created': { user: User };
    'user:updated': { user: User; changes: Partial<User> };
    'user:deleted': { userId: number };
    'error': { error: Error; context?: any };
};

// Function declaration - generic function with constraints
function createValidator<T extends Record<string, any>>(
    rules: { [K in keyof T]: ValidationRule<T[K]>[] }
): (data: T) => { isValid: boolean; errors: Partial<Record<keyof T, string[]>> } {
    return (data: T) => {
        const errors: Partial<Record<keyof T, string[]>> = {};
        
        for (const [field, fieldRules] of Object.entries(rules) as [keyof T, ValidationRule<T[keyof T]>[]][]) {
            const value = data[field];
            
            for (const rule of fieldRules) {
                const result = rule(value);
                if (result !== true) {
                    if (!errors[field]) errors[field] = [];
                    errors[field]!.push(typeof result === 'string' ? result : 'Validation failed');
                }
            }
        }
        
        return {
            isValid: Object.keys(errors).length === 0,
            errors
        };
    };
}

// Function declaration - async function with overloads
function fetchData(url: string): Promise<any>;
function fetchData(url: string, options: RequestInit): Promise<any>;
function fetchData<T>(url: string, parser: (response: Response) => Promise<T>): Promise<T>;
async function fetchData<T>(
    url: string, 
    optionsOrParser?: RequestInit | ((response: Response) => Promise<T>)
): Promise<T | any> {
    try {
        const response = await fetch(url, typeof optionsOrParser === 'function' ? undefined : optionsOrParser);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        if (typeof optionsOrParser === 'function') {
            return await optionsOrParser(response);
        }

        return await response.json();
    } catch (error) {
        console.error('Fetch error:', error);
        throw error;
    }
}

// Arrow function - typed arrow function
const debounce = <T extends (...args: any[]) => any>(
    func: T,
    wait: number,
    immediate: boolean = false
): ((...args: Parameters<T>) => void) => {
    let timeout: NodeJS.Timeout | null = null;
    
    return (...args: Parameters<T>) => {
        const later = () => {
            timeout = null;
            if (!immediate) func(...args);
        };
        
        const callNow = immediate && !timeout;
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow) func(...args);
    };
};

// Arrow function - complex generic arrow function
const createRepository = <T extends { id: number }, K = number>(
    connection: DatabaseConnection,
    tableName: string
): Repository<T, K> => {
    return {
        async findById(id: K): Promise<T | null> {
            const results = await connection.query<T>(
                `SELECT * FROM ${tableName} WHERE id = ?`,
                [id]
            );
            return results[0] || null;
        },

        async create(data: Omit<T, 'id' | 'createdAt' | 'updatedAt'>): Promise<T> {
            const fields = Object.keys(data).join(', ');
            const placeholders = Object.keys(data).map(() => '?').join(', ');
            
            const results = await connection.query<T>(
                `INSERT INTO ${tableName} (${fields}) VALUES (${placeholders}) RETURNING *`,
                Object.values(data)
            );
            
            return results[0];
        },

        async update(id: K, data: Partial<T>): Promise<T> {
            const updates = Object.keys(data).map(key => `${key} = ?`).join(', ');
            
            const results = await connection.query<T>(
                `UPDATE ${tableName} SET ${updates} WHERE id = ? RETURNING *`,
                [...Object.values(data), id]
            );
            
            return results[0];
        },

        async delete(id: K): Promise<boolean> {
            const results = await connection.query(
                `DELETE FROM ${tableName} WHERE id = ?`,
                [id]
            );
            return results.length > 0;
        },

        async findAll(filter?: FilterOptions<T>): Promise<T[]> {
            if (!filter) {
                return connection.query<T>(`SELECT * FROM ${tableName}`);
            }
            
            // Simple filter implementation for demo
            const conditions: string[] = [];
            const params: any[] = [];
            
            for (const [key, value] of Object.entries(filter)) {
                if (key.startsWith('$')) continue; // Skip special operators
                
                conditions.push(`${key} = ?`);
                params.push(value);
            }
            
            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
            return connection.query<T>(`SELECT * FROM ${tableName} ${whereClause}`, params);
        }
    };
};

// Class declaration - generic class implementing interface
class EventEmitter<T extends EventMap = EventMap> {
    private events = new Map<keyof T, EventListener<T[keyof T]>[]>();
    private maxListeners = 10;

    // Method definition - on method
    on<K extends keyof T>(event: K, listener: EventListener<T[K]>): this {
        if (!this.events.has(event)) {
            this.events.set(event, []);
        }
        
        const listeners = this.events.get(event)!;
        if (listeners.length >= this.maxListeners) {
            console.warn(`Max listeners (${this.maxListeners}) exceeded for event: ${String(event)}`);
        }
        
        listeners.push(listener as EventListener<T[keyof T]>);
        return this;
    }

    // Method definition - emit method
    async emit<K extends keyof T>(event: K, data: T[K]): Promise<boolean> {
        const listeners = this.events.get(event);
        if (!listeners || listeners.length === 0) {
            return false;
        }

        const promises = listeners.map(async (listener) => {
            try {
                await listener(data);
            } catch (error) {
                console.error(`Error in event listener for ${String(event)}:`, error);
            }
        });

        await Promise.all(promises);
        return true;
    }

    // Method definition - off method
    off<K extends keyof T>(event: K, listener?: EventListener<T[K]>): this {
        const listeners = this.events.get(event);
        if (!listeners) return this;

        if (!listener) {
            this.events.delete(event);
        } else {
            const index = listeners.indexOf(listener as EventListener<T[keyof T]>);
            if (index > -1) {
                listeners.splice(index, 1);
                if (listeners.length === 0) {
                    this.events.delete(event);
                }
            }
        }

        return this;
    }

    // Method definition - once method
    once<K extends keyof T>(event: K, listener: EventListener<T[K]>): this {
        const onceWrapper: EventListener<T[K]> = async (data) => {
            this.off(event, onceWrapper);
            await listener(data);
        };
        
        return this.on(event, onceWrapper);
    }

    // Method definition - listenerCount method  
    listenerCount<K extends keyof T>(event: K): number {
        const listeners = this.events.get(event);
        return listeners ? listeners.length : 0;
    }

    // Method definition - setMaxListeners method
    setMaxListeners(n: number): this {
        this.maxListeners = n;
        return this;
    }
}

// Class declaration - extending generic class
class UserService extends EventEmitter<EventMap> {
    private repository: Repository<User>;
    private validator: ReturnType<typeof createValidator<Omit<User, 'id' | 'createdAt' | 'updatedAt'>>>;

    constructor(repository: Repository<User>) {
        super();
        this.repository = repository;
        this.validator = createValidator<Omit<User, 'id' | 'createdAt' | 'updatedAt'>>({
            name: [(value) => value.length >= 2 || 'Name must be at least 2 characters'],
            email: [(value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || 'Invalid email format'],
            isActive: [(value) => typeof value === 'boolean' || 'isActive must be a boolean']
        });
    }

    // Method definition - async method
    async createUser(userData: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
        const validation = this.validator(userData);
        if (!validation.isValid) {
            throw new Error(`Validation failed: ${JSON.stringify(validation.errors)}`);
        }

        try {
            const user = await this.repository.create(userData);
            await this.emit('user:created', { user });
            return user;
        } catch (error) {
            await this.emit('error', { error: error as Error, context: 'createUser' });
            throw error;
        }
    }

    // Method definition - async method with complex logic
    async updateUser(id: number, updates: Partial<Omit<User, 'id' | 'createdAt' | 'updatedAt'>>): Promise<User> {
        const existingUser = await this.repository.findById(id);
        if (!existingUser) {
            throw new Error(`User with id ${id} not found`);
        }

        try {
            const updatedUser = await this.repository.update(id, updates);
            await this.emit('user:updated', { user: updatedUser, changes: updates });
            return updatedUser;
        } catch (error) {
            await this.emit('error', { error: error as Error, context: 'updateUser' });
            throw error;
        }
    }

    // Method definition - async method
    async deleteUser(id: number): Promise<boolean> {
        const existingUser = await this.repository.findById(id);
        if (!existingUser) {
            return false;
        }

        try {
            const deleted = await this.repository.delete(id);
            if (deleted) {
                await this.emit('user:deleted', { userId: id });
            }
            return deleted;
        } catch (error) {
            await this.emit('error', { error: error as Error, context: 'deleteUser' });
            throw error;
        }
    }

    // Method definition - async method
    async getUser(id: number): Promise<User | null> {
        try {
            return await this.repository.findById(id);
        } catch (error) {
            await this.emit('error', { error: error as Error, context: 'getUser' });
            throw error;
        }
    }

    // Method definition - async method
    async getAllUsers(filter?: FilterOptions<User>): Promise<User[]> {
        try {
            return await this.repository.findAll(filter);
        } catch (error) {
            await this.emit('error', { error: error as Error, context: 'getAllUsers' });
            throw error;
        }
    }
}

// Interface declaration - for abstract class
interface Transaction {
    query<T>(sql: string, params?: any[]): Promise<T[]>;
    commit(): Promise<void>;
    rollback(): Promise<void>;
}

// Abstract class declaration
abstract class BaseConnection implements DatabaseConnection {
    protected _isConnected = false;

    get isConnected(): boolean {
        return this._isConnected;
    }

    // Method definition - abstract method
    abstract connect(): Promise<void>;
    abstract disconnect(): Promise<void>;
    abstract query<T>(sql: string, params?: any[]): Promise<T[]>;

    // Method definition - concrete method in abstract class
    async transaction<T>(callback: (trx: Transaction) => Promise<T>): Promise<T> {
        // Mock transaction implementation
        const trx: Transaction = {
            query: this.query.bind(this),
            commit: async () => console.log('Transaction committed'),
            rollback: async () => console.log('Transaction rolled back')
        };

        try {
            const result = await callback(trx);
            await trx.commit();
            return result;
        } catch (error) {
            await trx.rollback();
            throw error;
        }
    }
}

// Function declaration - higher-order function
function withLogging<T extends (...args: any[]) => any>(fn: T): T {
    return ((...args: Parameters<T>) => {
        console.log(`Calling ${fn.name} with args:`, args);
        const start = Date.now();
        
        try {
            const result = fn(...args);
            
            if (result instanceof Promise) {
                return result
                    .then(value => {
                        console.log(`${fn.name} completed in ${Date.now() - start}ms`);
                        return value;
                    })
                    .catch(error => {
                        console.log(`${fn.name} failed in ${Date.now() - start}ms:`, error);
                        throw error;
                    });
            }
            
            console.log(`${fn.name} completed in ${Date.now() - start}ms`);
            return result;
        } catch (error) {
            console.log(`${fn.name} failed in ${Date.now() - start}ms:`, error);
            throw error;
        }
    }) as T;
}

// Export statement - named exports with types
export {
    type User,
    type AdminUser,
    type Repository,
    type EventListener,
    type DatabaseConnection,
    type AccessLevel,
    type ApiResponse,
    type ValidationRule,
    type FilterOptions,
    type EventMap,
    createValidator,
    fetchData,
    debounce,
    createRepository,
    EventEmitter,
    UserService,
    BaseConnection,
    withLogging
};

// Export statement - type-only export
export type { Transaction };

// Export statement - default export
export default class ApiClient {
    private baseUrl: string;
    private headers: Record<string, string>;

    constructor(baseUrl: string, defaultHeaders: Record<string, string> = {}) {
        this.baseUrl = baseUrl;
        this.headers = {
            'Content-Type': 'application/json',
            ...defaultHeaders
        };
    }

    // Method definition - generic method
    async request<T>(
        endpoint: string,
        options: RequestInit = {}
    ): Promise<ApiResponse<T>> {
        const url = `${this.baseUrl}${endpoint}`;
        const response = await fetch(url, {
            ...options,
            headers: {
                ...this.headers,
                ...options.headers
            }
        });

        const data = await response.json() as T;
        
        return {
            data,
            success: response.ok,
            message: response.ok ? undefined : `HTTP ${response.status}: ${response.statusText}`
        };
    }

    // Method definition - typed method
    async get<T>(endpoint: string): Promise<ApiResponse<T>> {
        return this.request<T>(endpoint, { method: 'GET' });
    }

    // Method definition - typed method
    async post<T>(endpoint: string, data: any): Promise<ApiResponse<T>> {
        return this.request<T>(endpoint, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    // Method definition - typed method  
    async put<T>(endpoint: string, data: any): Promise<ApiResponse<T>> {
        return this.request<T>(endpoint, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }

    // Method definition - typed method
    async delete<T>(endpoint: string): Promise<ApiResponse<T>> {
        return this.request<T>(endpoint, { method: 'DELETE' });
    }
}