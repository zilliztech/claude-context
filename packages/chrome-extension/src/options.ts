// Updated options script with Milvus configuration support

// Helper function to add debug info
function addDebugInfo(message: string) {
    const debugContent = document.getElementById('debug-content');
    if (debugContent) {
        const timestamp = new Date().toLocaleTimeString();
        const entry = document.createElement('div');
        entry.textContent = `[${timestamp}] ${message}`;
        debugContent.appendChild(entry);
    }
    console.log(message);
}

function saveOptions() {
    const tokenInput = document.getElementById('github-token') as HTMLInputElement;
    const openaiInput = document.getElementById('openai-token') as HTMLInputElement;
    
    // Milvus configuration inputs
    const milvusAddressInput = document.getElementById('milvus-address') as HTMLInputElement;
    const milvusTokenInput = document.getElementById('milvus-token') as HTMLInputElement;
    const milvusDatabaseInput = document.getElementById('milvus-database') as HTMLInputElement;
    
    if (tokenInput) {
        const token = tokenInput.value;
        const openaiToken = openaiInput.value;
        
        // Milvus configuration
        const milvusAddress = milvusAddressInput.value;
        const milvusToken = milvusTokenInput.value;
        const milvusDatabase = milvusDatabaseInput.value || 'default';
        
        // Validate Milvus address format if provided
        if (milvusAddress && !isValidUrl(milvusAddress)) {
            alert('Please enter a valid Milvus server address (e.g., http://localhost:19530)');
            return;
        }
        
        addDebugInfo(`Saving settings: githubToken=${token ? '***' : 'empty'}, openaiToken=${openaiToken ? '***' : 'empty'}, milvusAddress=${milvusAddress}`);
        
        chrome.storage.sync.set({
            githubToken: token,
            openaiToken: openaiToken,
            milvusAddress: milvusAddress,
            milvusToken: milvusToken,
            milvusDatabase: milvusDatabase
        }, () => {
            if (chrome.runtime.lastError) {
                const errorMsg = `Error saving settings: ${chrome.runtime.lastError.message}`;
                addDebugInfo(errorMsg);
                
                // Show error message
                const errorFlash = document.getElementById('save-error');
                if (errorFlash) {
                    errorFlash.textContent = errorMsg;
                    errorFlash.style.display = 'block';
                    setTimeout(() => {
                        errorFlash.style.display = 'none';
                    }, 5000);
                }
                return;
            }
            
            addDebugInfo('Settings saved successfully');
            
            // Show success message
            const successFlash = document.getElementById('save-success');
            if (successFlash) {
                successFlash.style.display = 'block';
                setTimeout(() => {
                    successFlash.style.display = 'none';
                }, 3000);
            }
            
            // Verify the settings were saved
            chrome.storage.sync.get(['githubToken', 'openaiToken', 'milvusAddress'], (items) => {
                addDebugInfo(`Verified tokens saved: githubToken=${items.githubToken ? '***' : 'empty'}, openaiToken=${items.openaiToken ? '***' : 'empty'}, milvusAddress=${items.milvusAddress || 'empty'}`);
            });
        });
    }
}

function restoreOptions() {
    addDebugInfo('Restoring options...');
    
    // Check if chrome.storage is available
    if (!chrome.storage || !chrome.storage.sync) {
        addDebugInfo('ERROR: chrome.storage.sync is not available!');
        return;
    }
    
    chrome.storage.sync.get({
        githubToken: '',
        openaiToken: '',
        milvusAddress: '',
        milvusToken: '',
        milvusDatabase: 'default'
    }, (items) => {
        if (chrome.runtime.lastError) {
            addDebugInfo(`Error loading settings: ${chrome.runtime.lastError.message}`);
            return;
        }
        
        addDebugInfo(`Restoring options: githubToken=${items.githubToken ? '***' : 'empty'}, openaiToken=${items.openaiToken ? '***' : 'empty'}, milvusAddress=${items.milvusAddress || 'empty'}`);
        
        // Set basic configuration
        const githubTokenInput = document.getElementById('github-token') as HTMLInputElement;
        const openaiTokenInput = document.getElementById('openai-token') as HTMLInputElement;
        
        // Set Milvus configuration
        const milvusAddressInput = document.getElementById('milvus-address') as HTMLInputElement;
        const milvusTokenInput = document.getElementById('milvus-token') as HTMLInputElement;
        const milvusDatabaseInput = document.getElementById('milvus-database') as HTMLInputElement;
        
        if (githubTokenInput) githubTokenInput.value = items.githubToken || '';
        if (openaiTokenInput) openaiTokenInput.value = items.openaiToken || '';
        
        if (milvusAddressInput) milvusAddressInput.value = items.milvusAddress || '';
        if (milvusTokenInput) milvusTokenInput.value = items.milvusToken || '';
        if (milvusDatabaseInput) milvusDatabaseInput.value = items.milvusDatabase || 'default';
    });
}

function testMilvusConnection() {
    addDebugInfo('Testing Milvus connection...');
    
    const resultSpan = document.getElementById('milvus-test-result');
    const testButton = document.getElementById('test-milvus') as HTMLButtonElement;
    
    if (resultSpan) {
        resultSpan.textContent = 'Testing connection...';
        resultSpan.className = 'color-fg-muted text-small connection-status';
    }
    
    if (testButton) {
        testButton.disabled = true;
        testButton.textContent = 'Testing...';
    }
    
    // Get current form values
    const milvusAddressInput = document.getElementById('milvus-address') as HTMLInputElement;
    const milvusTokenInput = document.getElementById('milvus-token') as HTMLInputElement;
    const milvusDatabaseInput = document.getElementById('milvus-database') as HTMLInputElement;
    
    const address = milvusAddressInput.value;
    const token = milvusTokenInput.value;
    const database = milvusDatabaseInput.value || 'default';
    
    if (!address) {
        if (resultSpan) {
            resultSpan.textContent = 'Please enter a Milvus server address';
            resultSpan.className = 'color-fg-danger text-small connection-status';
        }
        if (testButton) {
            testButton.disabled = false;
            testButton.textContent = 'Test Milvus Connection';
        }
        return;
    }
    
    // Save temporary configuration and test
    chrome.storage.sync.set({
        milvusAddress: address,
        milvusToken: token,
        milvusDatabase: database
    }, () => {
        // Send message to background script to test connection
        chrome.runtime.sendMessage({
            action: 'testMilvusConnection'
        }, (response) => {
            if (testButton) {
                testButton.disabled = false;
                testButton.textContent = 'Test Milvus Connection';
            }
            
            if (chrome.runtime.lastError) {
                const errorMsg = `Connection test failed: ${chrome.runtime.lastError.message}`;
                addDebugInfo(errorMsg);
                if (resultSpan) {
                    resultSpan.textContent = errorMsg;
                    resultSpan.className = 'color-fg-danger text-small connection-status';
                }
                return;
            }
            
            if (response && response.success) {
                if (response.connected) {
                    addDebugInfo('Milvus connection successful');
                    if (resultSpan) {
                        resultSpan.textContent = 'Connection successful';
                        resultSpan.className = 'color-fg-success text-small connection-status';
                    }
                } else {
                    addDebugInfo('Milvus connection failed');
                    if (resultSpan) {
                        resultSpan.textContent = 'Connection failed';
                        resultSpan.className = 'color-fg-danger text-small connection-status';
                    }
                }
            } else {
                const errorMsg = response ? (response.error || 'Unknown error') : 'No response from background script';
                addDebugInfo(`Connection test error: ${errorMsg}`);
                if (resultSpan) {
                    resultSpan.textContent = `Error: ${errorMsg}`;
                    resultSpan.className = 'color-fg-danger text-small connection-status';
                }
            }
        });
    });
}

function isValidUrl(string: string): boolean {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}

function toggleDebug() {
    const debugArea = document.getElementById('debug-area');
    const toggleButton = document.getElementById('toggle-debug') as HTMLButtonElement;
    
    if (debugArea && toggleButton) {
        if (debugArea.style.display === 'none' || debugArea.style.display === '') {
            debugArea.style.display = 'block';
            toggleButton.textContent = 'Hide Debug Info';
            addDebugInfo('Debug area shown');
        } else {
            debugArea.style.display = 'none';
            toggleButton.textContent = 'Show Debug Info';
        }
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
    addDebugInfo('Options page loaded');
    restoreOptions();
    
    const saveButton = document.getElementById('save');
    const toggleButton = document.getElementById('toggle-debug');
    const testMilvusButton = document.getElementById('test-milvus');
    
    if (saveButton) {
        saveButton.addEventListener('click', saveOptions);
    }
    
    if (toggleButton) {
        toggleButton.addEventListener('click', toggleDebug);
    }
    
    if (testMilvusButton) {
        testMilvusButton.addEventListener('click', testMilvusConnection);
    }
    
    // Auto-save on form changes (debounced)
    let saveTimeout: number;
    const inputs = document.querySelectorAll('input');
    inputs.forEach(input => {
        input.addEventListener('input', () => {
            clearTimeout(saveTimeout);
            saveTimeout = window.setTimeout(() => {
                addDebugInfo(`Auto-saving due to change in ${input.id}`);
                // Note: We don't auto-save because user might be in the middle of editing
            }, 1000);
        });
    });
});
