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
    const chunkSizeInput = document.getElementById('chunk-size') as HTMLInputElement;
    const chunkOverlapInput = document.getElementById('chunk-overlap') as HTMLInputElement;
    
    if (tokenInput && chunkSizeInput && chunkOverlapInput) {
        const token = tokenInput.value;
        const openaiToken = openaiInput.value;
        const chunkSize = parseInt(chunkSizeInput.value) || 512;
        const chunkOverlap = parseInt(chunkOverlapInput.value) || 128;
        
        // Validate chunk size and overlap
        if (chunkSize < 128 || chunkSize > 1024) {
            alert('Chunk size must be between 128 and 1024');
            return;
        }
        
        if (chunkOverlap < 0 || chunkOverlap > 256) {
            alert('Chunk overlap must be between 0 and 256');
            return;
        }
        
        if (chunkOverlap >= chunkSize) {
            alert('Chunk overlap must be less than chunk size');
            return;
        }
        
        addDebugInfo(`Saving settings: githubToken=${token ? '***' : 'empty'}, openaiToken=${openaiToken ? '***' : 'empty'}, chunkSize=${chunkSize}, chunkOverlap=${chunkOverlap}`);
        
        chrome.storage.sync.set({
            githubToken: token,
            openaiToken: openaiToken,
            chunkSize: chunkSize,
            chunkOverlap: chunkOverlap
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
            chrome.storage.sync.get(['githubToken', 'openaiToken'], (items) => {
                addDebugInfo(`Verified tokens saved: githubToken=${items.githubToken ? '***' : 'empty'}, openaiToken=${items.openaiToken ? '***' : 'empty'}`);
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
        chunkSize: 512,
        chunkOverlap: 128
    }, (items) => {
        if (chrome.runtime.lastError) {
            addDebugInfo(`Error loading settings: ${chrome.runtime.lastError.message}`);
            return;
        }
        
        addDebugInfo(`Settings loaded: token=${items.githubToken ? '***' : 'empty'}, openaiToken=${items.openaiToken ? '***' : 'empty'}, chunkSize=${items.chunkSize}, chunkOverlap=${items.chunkOverlap}`);
        
        const tokenInput = document.getElementById('github-token') as HTMLInputElement;
        const openaiInput = document.getElementById('openai-token') as HTMLInputElement;
        const chunkSizeInput = document.getElementById('chunk-size') as HTMLInputElement;
        const chunkOverlapInput = document.getElementById('chunk-overlap') as HTMLInputElement;
        
        if (tokenInput) {
            tokenInput.value = items.githubToken;
        }
        
        if (openaiInput) {
            openaiInput.value = items.openaiToken;
        }
        
        if (chunkSizeInput) {
            chunkSizeInput.value = items.chunkSize.toString();
        }
        
        if (chunkOverlapInput) {
            chunkOverlapInput.value = items.chunkOverlap.toString();
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    addDebugInfo('Options page loaded');
    restoreOptions();
    
    // Add browser info to debug
    const userAgent = navigator.userAgent;
    addDebugInfo(`Browser: ${userAgent}`);
    
    // Check Chrome API availability
    addDebugInfo(`chrome object available: ${typeof chrome !== 'undefined'}`);
    addDebugInfo(`chrome.storage available: ${typeof chrome !== 'undefined' && !!chrome.storage}`);
    addDebugInfo(`chrome.storage.sync available: ${typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.sync}`);
});

document.getElementById('save')?.addEventListener('click', (e) => {
    e.preventDefault();
    saveOptions();
});

document.getElementById('toggle-debug')?.addEventListener('click', () => {
    const debugArea = document.getElementById('debug-area');
    if (debugArea) {
        if (debugArea.style.display === 'none' || !debugArea.style.display) {
            debugArea.style.display = 'block';
        } else {
            debugArea.style.display = 'none';
        }
    }
}); 