/**
 * Semantic Search Webview Controller
 * Handles all interactions between the webview and the VSCode extension
 */
class SemanticSearchController {
    constructor() {
        this.vscode = acquireVsCodeApi();
        this.initializeElements();
        this.bindEvents();
        this.checkIndexStatus();
    }

    /**
     * Initialize DOM elements
     */
    initializeElements() {
        // Search view elements
        this.searchInput = document.getElementById('searchInput');
        this.searchButton = document.getElementById('searchButton');
        this.indexButton = document.getElementById('indexButton');
        this.settingsButton = document.getElementById('settingsButton');
        this.resultsContainer = document.getElementById('resultsContainer');
        this.resultsHeader = document.getElementById('resultsHeader');
        this.resultsList = document.getElementById('resultsList');

        // View elements
        this.searchView = document.getElementById('searchView');
        this.settingsView = document.getElementById('settingsView');
        this.backButton = document.getElementById('backButton');

        // Settings elements
        this.providerSelect = document.getElementById('provider');
        this.modelSelect = document.getElementById('model');
        this.apiKeyInput = document.getElementById('apiKey');
        this.baseUrlInput = document.getElementById('baseUrl');
        this.milvusAddressInput = document.getElementById('milvusAddress');
        this.milvusTokenInput = document.getElementById('milvusToken');
        this.testBtn = document.getElementById('testBtn');
        this.saveBtn = document.getElementById('saveBtn');
        this.statusDiv = document.getElementById('status');
        this.modelGroup = document.getElementById('modelGroup');
        this.apiKeyGroup = document.getElementById('apiKeyGroup');
        this.baseUrlGroup = document.getElementById('baseUrlGroup');
        // this.modelDescription = document.getElementById('modelDescription'); // Removed
        this.configForm = document.getElementById('configForm');

        // Current config state
        this.currentConfig = null;
        this.supportedProviders = {};
    }

    /**
     * Bind event listeners
     */
    bindEvents() {
        this.searchButton.addEventListener('click', () => this.performSearch());
        this.indexButton.addEventListener('click', () => this.performIndex());
        this.settingsButton.addEventListener('click', () => this.showSettingsView());
        this.backButton.addEventListener('click', () => this.showSearchView());

        this.searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.performSearch();
            }
        });

        // Settings event listeners
        this.providerSelect.addEventListener('change', () => this.handleProviderChange());
        this.modelSelect.addEventListener('change', () => this.handleModelChange());
        this.apiKeyInput.addEventListener('input', () => this.validateForm());
        this.milvusAddressInput.addEventListener('input', () => this.validateForm());
        this.milvusTokenInput.addEventListener('input', () => this.validateForm());
        this.testBtn.addEventListener('click', () => this.handleTestConnection());
        this.configForm.addEventListener('submit', (e) => this.handleFormSubmit(e));

        // Handle messages from extension
        window.addEventListener('message', (event) => this.handleMessage(event));

        // Check index status on load
        window.addEventListener('load', () => this.checkIndexStatus());
    }

    /**
     * Perform search operation
     */
    performSearch() {
        const text = this.searchInput.value.trim();
        if (text && !this.searchButton.disabled) {
            this.vscode.postMessage({
                command: 'search',
                text: text
            });
        }
    }

    /**
     * Perform index operation
     */
    performIndex() {
        this.indexButton.textContent = 'Indexing...';
        this.indexButton.disabled = true;
        this.vscode.postMessage({
            command: 'index'
        });
    }

    /**
     * Check index status
     */
    checkIndexStatus() {
        this.vscode.postMessage({
            command: 'checkIndex'
        });
    }

    /**
     * Show settings view
     */
    showSettingsView() {
        this.searchView.style.display = 'none';
        this.settingsView.style.display = 'block';
        this.requestConfig();
    }

    /**
     * Show search view
     */
    showSearchView() {
        this.settingsView.style.display = 'none';
        this.searchView.style.display = 'block';
    }

    /**
     * Request config from extension
     */
    requestConfig() {
        this.vscode.postMessage({
            command: 'getConfig'
        });
    }

    /**
     * Update search button state based on index availability
     * @param {boolean} hasIndex - Whether index exists
     */
    updateSearchButtonState(hasIndex) {
        this.searchButton.disabled = !hasIndex;
        if (hasIndex) {
            this.searchButton.title = 'Search the indexed codebase';
        } else {
            this.searchButton.title = 'Please click "Index Current Codebase" first to create an index';
        }
    }

    /**
     * Display search results
     * @param {Array} results - Search results
     * @param {string} query - Search query
     */
    showResults(results, query) {
        if (results.length === 0) {
            this.resultsHeader.textContent = `No results found for "${query}"`;
            this.resultsList.innerHTML = '<div class="no-results">No matches found</div>';
        } else {
            this.resultsHeader.textContent = `${results.length} result${results.length === 1 ? '' : 's'} for "${query}"`;
            this.resultsList.innerHTML = results.map(result => this.createResultHTML(result)).join('');
        }
        this.resultsContainer.style.display = 'block';
    }

    /**
     * Create HTML for a single result item
     * @param {Object} result - Result object
     * @returns {string} HTML string
     */
    createResultHTML(result) {
        return `
            <div class="result-item" onclick="searchController.openFile('${result.filePath}', ${result.line}, ${result.startLine}, ${result.endLine})">
                <div class="result-file">
                    <span class="result-filename">${result.file}</span>
                    <span class="result-line">Lines ${result.startLine || result.line}-${result.endLine || result.line}</span>
                </div>
                <div class="result-preview">${result.preview}</div>
                <div class="result-context">${result.context}</div>
                ${result.score ? `<div class="result-score" style="margin-top: 8px; text-align: right;">Similarity: ${(result.score * 100).toFixed(1)}%</div>` : ''}
            </div>
        `;
    }

    /**
     * Open file in VSCode editor
     * @param {string} filePath - File path
     * @param {number} line - Line number
     * @param {number} startLine - Start line
     * @param {number} endLine - End line
     */
    openFile(filePath, line, startLine, endLine) {
        this.vscode.postMessage({
            command: 'openFile',
            filePath: filePath,
            line: line,
            startLine: startLine,
            endLine: endLine
        });
    }

    /**
     * Handle messages from the extension
     * @param {MessageEvent} event - Message event
     */
    handleMessage(event) {
        const message = event.data;

        switch (message.command) {
            case 'showResults':
                this.showResults(message.results, message.query);
                break;

            case 'indexComplete':
                this.indexButton.textContent = 'Index Current Codebase';
                this.indexButton.disabled = false;
                break;

            case 'updateIndexStatus':
                this.updateSearchButtonState(message.hasIndex);
                break;

            case 'configData':
                this.loadConfig(message.config, message.supportedProviders, message.milvusConfig);
                break;

            case 'saveResult':
                this.saveBtn.disabled = false;
                this.saveBtn.textContent = 'Save Configuration';

                if (message.success) {
                    this.showStatus(message.message, 'success');
                    // Auto return to search view after successful save
                    setTimeout(() => this.showSearchView(), 1500);
                } else {
                    this.showStatus(message.message, 'error');
                }
                break;

            case 'testResult':
                this.testBtn.disabled = false;
                this.testBtn.textContent = 'Test Connection';

                if (message.success) {
                    this.showStatus(message.message, 'success');
                } else {
                    this.showStatus(message.message, 'error');
                }
                break;

            default:
                console.warn('Unknown message command:', message.command);
        }
    }

    // Settings methods
    handleProviderChange() {
        const selectedProvider = this.providerSelect.value;

        if (selectedProvider && this.supportedProviders[selectedProvider]) {
            this.modelGroup.style.display = 'block';
            this.populateModels(selectedProvider);
            this.apiKeyGroup.style.display = 'block';
            this.baseUrlGroup.style.display = 'block';

            if (selectedProvider === 'OpenAI') {
                this.baseUrlInput.placeholder = 'https://api.openai.com/v1';
            } else if (selectedProvider === 'VoyageAI') {
                this.baseUrlInput.placeholder = 'https://api.voyageai.com/v1';
            }
        } else {
            this.modelGroup.style.display = 'none';
            this.apiKeyGroup.style.display = 'none';
            this.baseUrlGroup.style.display = 'none';
        }

        this.validateForm();
    }

    populateModels(provider) {
        const models = this.supportedProviders[provider]?.models || {};

        this.modelSelect.innerHTML = '<option value="">Please select...</option>';

        Object.entries(models).forEach(([modelId, modelInfo]) => {
            const option = document.createElement('option');
            option.value = modelId;
            option.textContent = modelId;
            this.modelSelect.appendChild(option);
        });

        if (this.currentConfig && this.currentConfig.provider === provider && this.currentConfig.config) {
            this.modelSelect.value = this.currentConfig.config.model;
            this.handleModelChange();
        }
    }

    handleModelChange() {
        this.validateForm();
    }

    validateForm() {
        const hasProvider = !!this.providerSelect.value;
        const hasModel = !!this.modelSelect.value;
        const hasApiKey = !!this.apiKeyInput.value.trim();
        const hasMilvusAddress = !!this.milvusAddressInput.value.trim();

        // Test button only needs embedding config
        const canTestEmbedding = hasProvider && hasModel && hasApiKey;
        // Save button needs all config
        const canSave = hasProvider && hasModel && hasApiKey && hasMilvusAddress;

        this.testBtn.disabled = !canTestEmbedding;
        this.saveBtn.disabled = !canSave;
    }

    handleTestConnection() {
        const hasProvider = !!this.providerSelect.value;
        const hasModel = !!this.modelSelect.value;
        const hasApiKey = !!this.apiKeyInput.value.trim();

        if (!hasProvider || !hasModel || !hasApiKey) {
            this.showStatus('Please complete Embedding configuration first', 'error');
            return;
        }

        const embeddingConfig = {
            provider: this.providerSelect.value,
            config: {
                model: this.modelSelect.value,
                apiKey: this.apiKeyInput.value.trim()
            }
        };

        // Add baseURL if provided
        const baseURL = this.baseUrlInput.value.trim();
        if (baseURL) {
            embeddingConfig.config.baseURL = baseURL;
        }

        this.showStatus('Testing Embedding connection...', 'info');
        this.testBtn.disabled = true;
        this.testBtn.textContent = 'Testing...';

        this.vscode.postMessage({
            command: 'testEmbedding',
            config: embeddingConfig
        });
    }

    handleFormSubmit(event) {
        event.preventDefault();

        if (!this.validateCurrentForm()) return;

        const config = this.getCurrentFormConfig();
        this.showStatus('Saving configuration...', 'info');
        this.saveBtn.disabled = true;
        this.saveBtn.textContent = 'Saving...';

        this.vscode.postMessage({
            command: 'saveConfig',
            config: config
        });
    }

    getCurrentFormConfig() {
        const provider = this.providerSelect.value;
        const configData = {
            model: this.modelSelect.value,
            apiKey: this.apiKeyInput.value.trim()
        };

        // Only add baseURL if it's provided and not empty
        const baseURL = this.baseUrlInput.value.trim();
        if (baseURL) {
            configData.baseURL = baseURL;
        }

        const milvusConfig = {
            address: this.milvusAddressInput.value.trim()
        };

        // Only add token if it's provided and not empty
        const milvusToken = this.milvusTokenInput.value.trim();
        if (milvusToken) {
            milvusConfig.token = milvusToken;
        }

        return {
            provider: provider,
            config: configData,
            milvusConfig: milvusConfig
        };
    }

    validateCurrentForm() {
        const config = this.getCurrentFormConfig();

        if (!config.provider) {
            this.showStatus('Please select Embedding Provider', 'error');
            return false;
        }

        if (!config.config || !config.config.model) {
            this.showStatus('Please select a model', 'error');
            return false;
        }

        if (!config.config.apiKey) {
            this.showStatus('Please enter API Key', 'error');
            return false;
        }

        if (!config.milvusConfig || !config.milvusConfig.address) {
            this.showStatus('Please enter Milvus Address', 'error');
            return false;
        }

        return true;
    }

    showStatus(message, type) {
        this.statusDiv.textContent = message;
        this.statusDiv.className = `status-message ${type}`;
        this.statusDiv.style.display = 'block';

        if (type === 'success' || type === 'info') {
            setTimeout(() => {
                this.statusDiv.style.display = 'none';
            }, 3000);
        }
    }

    loadConfig(config, providers, milvusConfig) {
        this.currentConfig = config;
        this.supportedProviders = providers;

        this.providerSelect.innerHTML = '<option value="">Please select...</option>';
        Object.entries(providers).forEach(([providerId, providerInfo]) => {
            const option = document.createElement('option');
            option.value = providerId;
            option.textContent = providerInfo.name;
            this.providerSelect.appendChild(option);
        });

        if (config) {
            this.providerSelect.value = config.provider;
            this.handleProviderChange();

            setTimeout(() => {
                if (config.config) {
                    this.modelSelect.value = config.config.model;
                    this.apiKeyInput.value = config.config.apiKey;
                    if (config.config.baseURL) {
                        this.baseUrlInput.value = config.config.baseURL;
                    }
                }
                this.handleModelChange();
            }, 50);
        }

        // Load Milvus config
        if (milvusConfig) {
            this.milvusAddressInput.value = milvusConfig.address || '';
            this.milvusTokenInput.value = milvusConfig.token || '';
        }

        this.validateForm();
    }
}

// Initialize the controller when the DOM is loaded
let searchController;
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        searchController = new SemanticSearchController();
    });
} else {
    searchController = new SemanticSearchController();
} 