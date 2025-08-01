/**
 * Semantic Search Webview Controller
 * Handles all interactions between the webview and the VSCode extension
 */
class SemanticSearchController {
    constructor() {
        this.vscode = acquireVsCodeApi();
        this.initializeElements();
        this.bindEvents();
        this.initializeDefaultProviders(); // Ensure providers are available
        this.checkIndexStatus();

        // Request config immediately to get proper provider data
        setTimeout(() => {
            this.requestConfig();
        }, 100);
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
        this.dynamicFields = document.getElementById('dynamicFields');
        this.splitterTypeSelect = document.getElementById('splitterType');
        this.chunkSizeInput = document.getElementById('chunkSize');
        this.chunkOverlapInput = document.getElementById('chunkOverlap');
        this.milvusAddressInput = document.getElementById('milvusAddress');
        this.milvusTokenInput = document.getElementById('milvusToken');
        this.testBtn = document.getElementById('testBtn');
        this.saveBtn = document.getElementById('saveBtn');
        this.statusDiv = document.getElementById('status');
        this.configForm = document.getElementById('configForm');

        // Current config state
        this.currentConfig = null;
        this.supportedProviders = {};
        this.dynamicFieldElements = new Map(); // Store dynamic field elements
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
        this.splitterTypeSelect.addEventListener('change', () => this.validateForm());
        this.chunkSizeInput.addEventListener('input', () => this.validateForm());
        this.chunkOverlapInput.addEventListener('input', () => this.validateForm());
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

        // Add default providers if not already loaded
        this.initializeDefaultProviders();
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
 * Initialize default providers to ensure they show up even if config loading fails
 */
    initializeDefaultProviders() {
        // Only initialize if providers haven't been loaded yet
        if (this.providerSelect.children.length <= 1) {
            // Clear existing options and add placeholder
            this.providerSelect.innerHTML = '<option value="">Please select...</option>';

            // Add basic provider options (models will be loaded from backend)
            const defaultProviders = [
                { value: 'OpenAI', text: 'OpenAI' },
                { value: 'VoyageAI', text: 'VoyageAI' },
                { value: 'Ollama', text: 'Ollama' },
                { value: 'Gemini', text: 'Gemini' }
            ];

            defaultProviders.forEach(provider => {
                const option = document.createElement('option');
                option.value = provider.value;
                option.textContent = provider.text;
                this.providerSelect.appendChild(option);
            });
        }
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
            <div class="result-item" onclick="searchController.openFile('${result.relativePath}', ${result.line}, ${result.startLine}, ${result.endLine})">
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
     * @param {string} relativePath - File relative path
     * @param {number} line - Line number
     * @param {number} startLine - Start line
     * @param {number} endLine - End line
     */
    openFile(relativePath, line, startLine, endLine) {
        this.vscode.postMessage({
            command: 'openFile',
            relativePath: relativePath,
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
                this.loadConfig(message.config, message.supportedProviders, message.milvusConfig, message.splitterConfig);
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

        // Clear existing dynamic fields
        this.clearDynamicFields();

        if (selectedProvider && this.supportedProviders[selectedProvider]) {
            this.generateDynamicFields(selectedProvider);
        } else if (selectedProvider) {
            // If we have a selected provider but no supportedProviders data, request config
            this.requestConfig();
        }

        this.validateForm();
    }



    /**
     * Clear all dynamic form fields
     */
    clearDynamicFields() {
        this.dynamicFields.innerHTML = '';
        this.dynamicFieldElements.clear();
    }

    /**
     * Generate dynamic form fields based on provider configuration
     */
    generateDynamicFields(provider) {
        const providerInfo = this.supportedProviders[provider];

        if (!providerInfo) {
            return;
        }

        const requiredFields = providerInfo.requiredFields || [];
        const optionalFields = providerInfo.optionalFields || [];
        const allFields = [...requiredFields, ...optionalFields];

        if (allFields.length === 0) {
            return;
        }

        allFields.forEach((field) => {
            try {
                const fieldElement = this.createFormField(field, providerInfo);
                this.dynamicFields.appendChild(fieldElement.container);
                this.dynamicFieldElements.set(field.name, fieldElement);

                // Add event listeners
                if (fieldElement.input) {
                    fieldElement.input.addEventListener('input', () => this.validateForm());
                    fieldElement.input.addEventListener('change', () => this.validateForm());
                }

                // Add event listeners for select-with-custom model inputs
                if (fieldElement.selectElement) {
                    fieldElement.selectElement.addEventListener('change', () => this.validateForm());
                }
                if (fieldElement.customInput) {
                    fieldElement.customInput.addEventListener('input', () => this.validateForm());
                }
            } catch (error) {
                console.error(`Failed to create field ${field.name}:`, error);
            }
        });

        // Load current values if available
        this.loadCurrentValues(provider);
    }

    /**
     * Create a form field element based on field definition
     */
    createFormField(field, providerInfo) {
        const container = document.createElement('div');
        container.className = 'form-group';

        const label = document.createElement('label');
        label.textContent = field.description;
        label.setAttribute('for', field.name);
        container.appendChild(label);

        let input;

        if (field.name === 'model' && field.inputType === 'select') {
            // Special handling for model field with select type - create dropdown
            input = document.createElement('select');
            input.id = field.name;
            input.required = field.required || false;

            // Add default option
            const defaultOption = document.createElement('option');
            defaultOption.value = '';
            defaultOption.textContent = 'Please select...';
            input.appendChild(defaultOption);

            // Populate with models
            const models = providerInfo.models || {};
            Object.entries(models).forEach(([modelId, modelInfo]) => {
                const option = document.createElement('option');
                option.value = modelId;
                option.textContent = modelId;

                // Keep description as tooltip if available
                if (modelInfo && modelInfo.description) {
                    option.title = modelInfo.description;
                }

                input.appendChild(option);
            });
        } else if (field.name === 'model' && field.inputType === 'select-with-custom') {
            // Create a container for both select and custom input
            const inputContainer = document.createElement('div');
            inputContainer.className = 'model-input-container';

            // Create select dropdown
            const selectElement = document.createElement('select');
            selectElement.id = field.name + '_select';
            selectElement.className = 'model-select';

            // Add default option
            const defaultOption = document.createElement('option');
            defaultOption.value = '';
            defaultOption.textContent = 'Please select...';
            selectElement.appendChild(defaultOption);

            // Add custom option
            const customOption = document.createElement('option');
            customOption.value = 'custom';
            customOption.textContent = 'Custom model...';
            selectElement.appendChild(customOption);

            // Populate with predefined models
            const models = providerInfo.models || {};
            Object.entries(models).forEach(([modelId, modelInfo]) => {
                const option = document.createElement('option');
                option.value = modelId;
                option.textContent = modelId;

                if (modelInfo && modelInfo.description) {
                    option.title = modelInfo.description;
                }

                selectElement.appendChild(option);
            });

            // Create custom input field (initially hidden)
            const customInput = document.createElement('input');
            customInput.type = 'text';
            customInput.id = field.name + '_custom';
            customInput.className = 'model-custom-input';
            customInput.placeholder = 'Enter custom model name...';
            customInput.style.display = 'none';
            customInput.style.marginTop = '8px';

            // Create the main input that will hold the final value
            input = document.createElement('input');
            input.type = 'hidden';
            input.id = field.name;
            input.required = field.required || false;

            // Add event listeners
            selectElement.addEventListener('change', (e) => {
                if (e.target.value === 'custom') {
                    customInput.style.display = 'block';
                    customInput.required = field.required || false;
                    customInput.focus();
                    input.value = customInput.value;
                } else {
                    customInput.style.display = 'none';
                    customInput.required = false;
                    input.value = e.target.value;
                }
            });

            customInput.addEventListener('input', (e) => {
                input.value = e.target.value;
            });

            inputContainer.appendChild(selectElement);
            inputContainer.appendChild(customInput);
            inputContainer.appendChild(input);

            container.appendChild(inputContainer);

            return {
                container,
                input,
                field,
                selectElement,
                customInput
            };
        } else {
            // Create input based on inputType
            input = document.createElement('input');
            input.id = field.name;
            input.required = field.required || false;

            switch (field.inputType) {
                case 'password':
                    input.type = 'password';
                    break;
                case 'url':
                    input.type = 'url';
                    break;
                case 'text':
                default:
                    input.type = 'text';
                    break;
            }

            if (field.placeholder) {
                input.placeholder = field.placeholder;
            }
        }

        container.appendChild(input);

        return {
            container,
            input,
            field
        };
    }

    /**
     * Load current values into dynamic fields
     */
    loadCurrentValues(provider) {
        if (this.currentConfig && this.currentConfig.provider === provider && this.currentConfig.config) {
            this.dynamicFieldElements.forEach((fieldElement, fieldName) => {
                const value = this.currentConfig.config[fieldName];
                if (value !== undefined && fieldElement.input) {
                    // Handle select-with-custom model fields
                    if (fieldElement.selectElement && fieldElement.customInput) {
                        // Check if the value matches any predefined option
                        const selectElement = fieldElement.selectElement;
                        let foundMatch = false;

                        for (let option of selectElement.options) {
                            if (option.value === value) {
                                selectElement.value = value;
                                fieldElement.input.value = value;
                                foundMatch = true;
                                break;
                            }
                        }

                        // If no match found, use custom input
                        if (!foundMatch && value) {
                            selectElement.value = 'custom';
                            fieldElement.customInput.value = value;
                            fieldElement.customInput.style.display = 'block';
                            fieldElement.customInput.required = fieldElement.field.required || false;
                            fieldElement.input.value = value;
                        }
                    } else {
                        // Regular input field
                        fieldElement.input.value = value;
                    }
                }
            });
        }
    }

    validateForm() {
        const hasProvider = !!this.providerSelect.value;
        const hasMilvusAddress = !!this.milvusAddressInput.value.trim();

        // Check all required dynamic fields
        let hasAllRequiredFields = true;
        if (hasProvider && this.supportedProviders[this.providerSelect.value]) {
            const providerInfo = this.supportedProviders[this.providerSelect.value];
            for (const field of providerInfo.requiredFields) {
                const fieldElement = this.dynamicFieldElements.get(field.name);
                if (!fieldElement || !fieldElement.input.value.trim()) {
                    hasAllRequiredFields = false;
                    break;
                }
            }
        } else {
            hasAllRequiredFields = false;
        }

        // Test button only needs embedding config
        const canTestEmbedding = hasProvider && hasAllRequiredFields;
        // Save button needs all config
        const canSave = hasProvider && hasAllRequiredFields && hasMilvusAddress;

        this.testBtn.disabled = !canTestEmbedding;
        this.saveBtn.disabled = !canSave;
    }

    handleTestConnection() {
        const provider = this.providerSelect.value;
        if (!provider) {
            this.showStatus('Please select a provider first', 'error');
            return;
        }

        // Collect config from dynamic fields
        const config = this.collectDynamicFieldValues();
        if (!config) {
            this.showStatus('Please complete all required fields', 'error');
            return;
        }

        const embeddingConfig = {
            provider: provider,
            config: config
        };

        this.showStatus('Testing Embedding connection...', 'info');
        this.testBtn.disabled = true;
        this.testBtn.textContent = 'Testing...';

        this.vscode.postMessage({
            command: 'testEmbedding',
            config: embeddingConfig
        });
    }

    /**
     * Collect values from all dynamic fields
     */
    collectDynamicFieldValues() {
        const provider = this.providerSelect.value;
        if (!provider || !this.supportedProviders[provider]) {
            return null;
        }

        const config = {};
        const providerInfo = this.supportedProviders[provider];

        // Check required fields
        for (const field of providerInfo.requiredFields) {
            const fieldElement = this.dynamicFieldElements.get(field.name);
            if (!fieldElement || !fieldElement.input.value.trim()) {
                return null; // Missing required field
            }
            config[field.name] = fieldElement.input.value.trim();
        }

        // Add optional fields if they have values
        for (const field of providerInfo.optionalFields) {
            const fieldElement = this.dynamicFieldElements.get(field.name);
            if (fieldElement && fieldElement.input.value.trim()) {
                config[field.name] = fieldElement.input.value.trim();
            }
        }

        return config;
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
        const configData = this.collectDynamicFieldValues();

        if (!configData) {
            return null;
        }

        const milvusConfig = {
            address: this.milvusAddressInput.value.trim()
        };

        // Only add token if it's provided and not empty
        const milvusToken = this.milvusTokenInput.value.trim();
        if (milvusToken) {
            milvusConfig.token = milvusToken;
        }

        const splitterConfig = {
            type: this.splitterTypeSelect.value,
            chunkSize: parseInt(this.chunkSizeInput.value, 10),
            chunkOverlap: parseInt(this.chunkOverlapInput.value, 10)
        };

        return {
            provider: provider,
            config: configData,
            milvusConfig: milvusConfig,
            splitterConfig: splitterConfig
        };
    }

    validateCurrentForm() {
        const config = this.getCurrentFormConfig();

        if (!config) {
            this.showStatus('Please complete all required fields', 'error');
            return false;
        }

        if (!config.provider) {
            this.showStatus('Please select Embedding Provider', 'error');
            return false;
        }

        if (!config.milvusConfig || !config.milvusConfig.address) {
            this.showStatus('Please enter Milvus Address', 'error');
            return false;
        }

        // Validate splitter configuration
        if (!config.splitterConfig.type) {
            this.showStatus('Please select a splitter type', 'error');
            return false;
        }

        if (config.splitterConfig.chunkSize < 100 || config.splitterConfig.chunkSize > 5000) {
            this.showStatus('Chunk size must be between 100 and 5000', 'error');
            return false;
        }

        if (config.splitterConfig.chunkOverlap < 0 || config.splitterConfig.chunkOverlap > 1000) {
            this.showStatus('Chunk overlap must be between 0 and 1000', 'error');
            return false;
        }

        if (config.splitterConfig.chunkOverlap >= config.splitterConfig.chunkSize) {
            this.showStatus('Chunk overlap must be less than chunk size', 'error');
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

    loadConfig(config, providers, milvusConfig, splitterConfig) {
        this.currentConfig = config;

        // Only update providers if we actually received them from backend
        if (providers && Object.keys(providers).length > 0) {
            this.supportedProviders = providers;

            // Update provider select with backend data
            this.providerSelect.innerHTML = '<option value="">Please select...</option>';
            Object.entries(providers).forEach(([providerId, providerInfo]) => {
                const option = document.createElement('option');
                option.value = providerId;
                option.textContent = providerInfo.name;
                this.providerSelect.appendChild(option);
            });
        } else {
            // Request config again if we don't have provider data
            setTimeout(() => this.requestConfig(), 100);
        }

        if (config) {
            this.providerSelect.value = config.provider;
            this.handleProviderChange();
        }

        // Load Milvus config
        if (milvusConfig) {
            this.milvusAddressInput.value = milvusConfig.address || '';
            this.milvusTokenInput.value = milvusConfig.token || '';
        }

        // Load splitter config
        if (splitterConfig) {
            this.splitterTypeSelect.value = splitterConfig.type || 'langchain';
            this.chunkSizeInput.value = splitterConfig.chunkSize || 1000;
            this.chunkOverlapInput.value = splitterConfig.chunkOverlap || 200;
        } else {
            // Set default values
            this.splitterTypeSelect.value = 'langchain';
            this.chunkSizeInput.value = 1000;
            this.chunkOverlapInput.value = 200;
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