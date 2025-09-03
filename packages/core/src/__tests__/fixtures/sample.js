/**
 * Sample JavaScript file with all AST splitter features
 * This file contains all node types that the AST splitter recognizes for JavaScript:
 * - function_declaration
 * - arrow_function
 * - class_declaration
 * - method_definition
 * - export_statement
 */

// Function declaration - regular function
function calculateFactorial(n) {
    if (n <= 1) return 1;
    return n * calculateFactorial(n - 1);
}

// Function declaration with different signature
function debounce(func, wait, immediate) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            timeout = null;
            if (!immediate) func.apply(this, args);
        };
        const callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow) func.apply(this, args);
    };
}

// Arrow function assigned to const
const multiply = (a, b) => a * b;

// Arrow function with block body
const processArray = (arr) => {
    return arr
        .filter(item => item !== null && item !== undefined)
        .map(item => String(item).trim())
        .sort();
};

// Arrow function - more complex
const createValidator = (rules) => {
    return (data) => {
        const errors = {};
        
        for (const [field, fieldRules] of Object.entries(rules)) {
            const value = data[field];
            
            for (const rule of fieldRules) {
                if (rule.required && (!value || value === '')) {
                    errors[field] = errors[field] || [];
                    errors[field].push('Field is required');
                }
                
                if (rule.minLength && value && value.length < rule.minLength) {
                    errors[field] = errors[field] || [];
                    errors[field].push(`Minimum length is ${rule.minLength}`);
                }
                
                if (rule.pattern && value && !rule.pattern.test(value)) {
                    errors[field] = errors[field] || [];
                    errors[field].push('Invalid format');
                }
            }
        }
        
        return {
            isValid: Object.keys(errors).length === 0,
            errors
        };
    };
};

// Class declaration - basic class
class EventEmitter {
    constructor() {
        this.events = new Map();
        this.maxListeners = 10;
    }

    // Method definition - on method
    on(event, listener) {
        if (!this.events.has(event)) {
            this.events.set(event, []);
        }
        
        const listeners = this.events.get(event);
        if (listeners.length >= this.maxListeners) {
            console.warn(`Max listeners (${this.maxListeners}) exceeded for event: ${event}`);
        }
        
        listeners.push(listener);
        return this;
    }

    // Method definition - emit method  
    emit(event, ...args) {
        const listeners = this.events.get(event);
        if (!listeners || listeners.length === 0) {
            return false;
        }

        listeners.forEach(listener => {
            try {
                listener.apply(this, args);
            } catch (error) {
                console.error('Error in event listener:', error);
            }
        });

        return true;
    }

    // Method definition - off method
    off(event, listener) {
        const listeners = this.events.get(event);
        if (!listeners) return this;

        if (!listener) {
            // Remove all listeners for this event
            this.events.delete(event);
        } else {
            // Remove specific listener
            const index = listeners.indexOf(listener);
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
    once(event, listener) {
        const onceWrapper = (...args) => {
            this.off(event, onceWrapper);
            listener.apply(this, args);
        };
        
        return this.on(event, onceWrapper);
    }

    // Method definition - listenerCount method
    listenerCount(event) {
        const listeners = this.events.get(event);
        return listeners ? listeners.length : 0;
    }

    // Method definition - setMaxListeners method
    setMaxListeners(n) {
        this.maxListeners = n;
        return this;
    }
}

// Class declaration - extending EventEmitter
class HttpClient extends EventEmitter {
    constructor(baseURL = '', defaultHeaders = {}) {
        super();
        this.baseURL = baseURL;
        this.defaultHeaders = defaultHeaders;
        this.interceptors = {
            request: [],
            response: []
        };
    }

    // Method definition - request method
    async request(url, options = {}) {
        const fullUrl = this.baseURL + url;
        const requestOptions = {
            ...options,
            headers: {
                ...this.defaultHeaders,
                ...options.headers
            }
        };

        // Apply request interceptors
        for (const interceptor of this.interceptors.request) {
            await interceptor(requestOptions);
        }

        this.emit('request:start', { url: fullUrl, options: requestOptions });

        try {
            const response = await fetch(fullUrl, requestOptions);
            
            // Apply response interceptors
            for (const interceptor of this.interceptors.response) {
                await interceptor(response);
            }

            this.emit('request:success', { url: fullUrl, response });
            return response;
        } catch (error) {
            this.emit('request:error', { url: fullUrl, error });
            throw error;
        }
    }

    // Method definition - get method
    async get(url, options = {}) {
        return this.request(url, { ...options, method: 'GET' });
    }

    // Method definition - post method  
    async post(url, data, options = {}) {
        return this.request(url, {
            ...options,
            method: 'POST',
            body: JSON.stringify(data),
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            }
        });
    }

    // Method definition - addRequestInterceptor
    addRequestInterceptor(interceptor) {
        this.interceptors.request.push(interceptor);
        return () => {
            const index = this.interceptors.request.indexOf(interceptor);
            if (index > -1) {
                this.interceptors.request.splice(index, 1);
            }
        };
    }

    // Method definition - addResponseInterceptor
    addResponseInterceptor(interceptor) {
        this.interceptors.response.push(interceptor);
        return () => {
            const index = this.interceptors.response.indexOf(interceptor);
            if (index > -1) {
                this.interceptors.response.splice(index, 1);
            }
        };
    }
}

// Class declaration - static methods
class MathUtils {
    // Method definition - static method
    static clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    // Method definition - static method  
    static lerp(start, end, factor) {
        return start + (end - start) * factor;
    }

    // Method definition - static method
    static randomBetween(min, max) {
        return Math.random() * (max - min) + min;
    }

    // Method definition - static method
    static roundTo(value, decimals = 2) {
        const multiplier = Math.pow(10, decimals);
        return Math.round(value * multiplier) / multiplier;
    }
}

// Function declaration - async function
async function fetchUserData(userId) {
    const client = new HttpClient('https://api.example.com');
    
    try {
        const response = await client.get(`/users/${userId}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error('Failed to fetch user data:', error);
        throw error;
    }
}

// Function declaration - generator function
function* fibonacciGenerator(max = Infinity) {
    let prev = 0;
    let curr = 1;
    
    while (curr <= max) {
        yield curr;
        [prev, curr] = [curr, prev + curr];
    }
}

// Arrow function - complex processing
const processData = async (data) => {
    const validator = createValidator({
        id: [{ required: true }],
        name: [{ required: true, minLength: 2 }],
        email: [{ 
            required: true, 
            pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ 
        }]
    });

    const validationResult = validator(data);
    if (!validationResult.isValid) {
        throw new Error('Validation failed: ' + JSON.stringify(validationResult.errors));
    }

    return {
        ...data,
        processedAt: new Date().toISOString(),
        valid: true
    };
};

// Export statement - named exports
export {
    calculateFactorial,
    debounce,
    multiply,
    processArray,
    createValidator,
    EventEmitter,
    HttpClient,
    MathUtils,
    fetchUserData,
    fibonacciGenerator,
    processData
};

// Export statement - default export
export default class ApiService {
    constructor(client) {
        this.client = client || new HttpClient();
    }

    // Method definition in default export class
    async getUser(id) {
        return fetchUserData(id);
    }

    // Method definition in default export class
    async createUser(userData) {
        const processedData = await processData(userData);
        const response = await this.client.post('/users', processedData);
        return response.json();
    }

    // Method definition in default export class  
    async updateUser(id, updates) {
        const response = await this.client.request(`/users/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(updates),
            headers: { 'Content-Type': 'application/json' }
        });
        return response.json();
    }

    // Method definition in default export class
    async deleteUser(id) {
        const response = await this.client.request(`/users/${id}`, {
            method: 'DELETE'
        });
        return response.ok;
    }
}

// Additional function declaration for completeness
function memoize(fn) {
    const cache = new Map();
    
    return function memoized(...args) {
        const key = JSON.stringify(args);
        
        if (cache.has(key)) {
            return cache.get(key);
        }
        
        const result = fn.apply(this, args);
        cache.set(key, result);
        return result;
    };
}