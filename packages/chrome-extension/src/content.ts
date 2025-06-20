export {};

function isRepoHomePage() {
    // Matches /user/repo or /user/repo/tree/branch but not /user/repo/issues etc.
    return /^\/[^/]+\/[^/]+(\/tree\/[^/]+)?\/?$/.test(window.location.pathname);
}

function injectUI() {
    if (!isRepoHomePage()) {
        const existingContainer = document.getElementById('code-search-container');
        if (existingContainer) {
            existingContainer.remove();
        }
        return;
    }

    // Attempt to locate GitHub's sidebar first so the search UI aligns with the "About" section
    const sidebar = document.querySelector('.Layout-sidebar') as HTMLElement | null;
    // Fallback to repository navigation bar ("Code", "Issues", etc.) if sidebar is not present
    const repoNav = document.querySelector('nav.UnderlineNav') as HTMLElement | null;
    const existingContainer = document.getElementById('code-search-container');

    if ((sidebar || repoNav) && !existingContainer) {
        // Check if GitHub token is set
        chrome.storage.sync.get('githubToken', (data) => {
            const hasToken = !!data.githubToken;
            
            // Prevent duplicate insertion in case multiple async callbacks race
            if (document.getElementById('code-search-container')) {
                return;
            }

            const container = document.createElement('div');
            container.id = 'code-search-container';
            container.className = 'Box color-border-muted mb-3';
            container.innerHTML = `
                <div class="Box-header color-bg-subtle d-flex flex-items-center">
                    <h2 class="Box-title flex-auto">Code Search</h2>
                    <a href="#" id="open-settings-link" class="Link--muted">
                        <svg class="octicon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
                            <path d="M8 0a8.2 8.2 0 0 1 .701.031C9.444.095 9.99.645 10.16 1.29l.288 1.107c.018.066.079.158.212.224.231.114.454.243.668.386.123.082.233.09.299.071l1.103-.303c.644-.176 1.392.021 1.82.63.27.385.506.792.704 1.218.315.675.111 1.422-.364 1.891l-.814.806c-.049.048-.098.147-.088.294.016.257.016.515 0 .772-.01.147.038.246.088.294l.814.806c.475.469.679 1.216.364 1.891a7.977 7.977 0 0 1-.704 1.217c-.428.61-1.176.807-1.82.63l-1.102-.302c-.067-.019-.177-.011-.3.071a5.909 5.909 0 0 1-.668.386c-.133.066-.194.158-.211.224l-.29 1.106c-.168.646-.715 1.196-1.458 1.26a8.006 8.006 0 0 1-1.402 0c-.743-.064-1.289-.614-1.458-1.26l-.289-1.106c-.018-.066-.079-.158-.212-.224a5.738 5.738 0 0 1-.668-.386c-.123-.082-.233-.09-.299-.071l-1.103.303c-.644.176-1.392-.021-1.82-.63a8.12 8.12 0 0 1-.704-1.218c-.315-.675-.111-1.422.363-1.891l.815-.806c.05-.048.098-.147.088-.294a6.214 6.214 0 0 1 0-.772c.01-.147-.038-.246-.088-.294l-.815-.806C.635 6.045.431 5.298.746 4.623a7.92 7.92 0 0 1 .704-1.217c.428-.61 1.176-.807 1.82-.63l1.102.302c.067.019.177.011.3-.071.214-.143.437-.272.668-.386.133-.066.194-.158.211-.224l.29-1.106C6.009.645 6.556.095 7.299.03 7.53.01 7.764 0 8 0Zm-.571 1.525c-.036.003-.108.036-.137.146l-.289 1.105c-.147.561-.549.967-.998 1.189-.173.086-.34.183-.5.29-.417.278-.97.423-1.529.27l-1.103-.303c-.109-.03-.175.016-.195.045-.22.312-.412.644-.573.99-.014.031-.021.11.059.19l.815.806c.411.406.562.957.53 1.456a4.709 4.709 0 0 0 0 .582c.032.499-.119 1.05-.53 1.456l-.815.806c-.081.08-.073.159-.059.19.162.346.353.677.573.989.02.03.085.076.195.046l1.102-.303c.56-.153 1.113-.008 1.53.27.161.107.328.204.501.29.447.222.85.629.997 1.189l.289 1.105c.029.109.101.143.137.146a6.6 6.6 0 0 0 1.142 0c.036-.003.108-.036.137-.146l.289-1.105c.147-.561.549-.967.998-1.189.173-.086.34-.183.5-.29.417-.278.97-.423 1.529-.27l1.103.303c.109.03.175-.016.195-.045.22-.313.411-.644.573-.99.014-.031.021-.11-.059-.19l-.815-.806c-.411-.406-.562-.957-.53-1.456a4.709 4.709 0 0 0 0-.582c-.032-.499.119-1.05.53-1.456l.815-.806c.081-.08.073-.159.059-.19a6.464 6.464 0 0 0-.573-.989c-.02-.03-.085-.076-.195-.046l-1.102.303c-.56.153-1.113.008-1.53-.27a4.44 4.44 0 0 0-.501-.29c-.447-.222-.85-.629-.997-1.189l-.289-1.105c-.029-.11-.101-.143-.137-.146a6.6 6.6 0 0 0-1.142 0ZM11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM9.5 8a1.5 1.5 0 1 0-3.001.001A1.5 1.5 0 0 0 9.5 8Z"></path>
                        </svg>
                    </a>
                </div>
                <div class="Box-body">
                    ${!hasToken ? `
                        <div class="flash flash-warn mb-2">
                            GitHub token not set. 
                            <a href="#" id="open-settings-link-warning" class="settings-link">Configure settings</a>
                        </div>
                    ` : ''}
                    <div class="d-flex flex-column">
                        <div class="form-group">
                            <div class="d-flex flex-items-center mb-2" id="search-row">
                                <input type="text" id="search-input" class="form-control input-sm flex-1" placeholder="Search code..." ${!hasToken ? 'disabled' : ''}>
                                <button id="search-btn" class="btn btn-sm ml-2" ${!hasToken ? 'disabled' : ''}>
                                    Search
                                </button>
                            </div>
                            <div class="buttons-container">
                                <button id="index-repo-btn" class="btn btn-sm" ${!hasToken ? 'disabled' : ''}>
                                    Index Repository
                                </button>
                                <button id="clear-index-btn" class="btn btn-sm" ${!hasToken ? 'disabled' : ''}>
                                    Clear Index
                                </button>
                            </div>
                        </div>
                        <div id="search-results" class="Box mt-2" style="display:none;"></div>
                        <div id="indexing-status" class="color-fg-muted text-small mt-2"></div>
                    </div>
                </div>
            `;

            // If sidebar is available, place container at the top; otherwise fallback to below nav bar
            if (sidebar) {
                sidebar.prepend(container);
            } else if (repoNav) {
                repoNav.parentElement?.insertBefore(container, repoNav.nextSibling);
            }

            document.getElementById('index-repo-btn')?.addEventListener('click', startIndexing);
            document.getElementById('clear-index-btn')?.addEventListener('click', clearIndex);
            document.getElementById('search-btn')?.addEventListener('click', handleSearch);
            document.getElementById('search-input')?.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    handleSearch();
                }
            });
            
            // Add event listeners for settings links
            document.getElementById('open-settings-link')?.addEventListener('click', (e) => {
                e.preventDefault();
                const optionsUrl = chrome.runtime.getURL('options.html');
                window.open(optionsUrl, '_blank');
            });
            
            document.getElementById('open-settings-link-warning')?.addEventListener('click', (e) => {
                e.preventDefault();
                const optionsUrl = chrome.runtime.getURL('options.html');
                window.open(optionsUrl, '_blank');
            });

            // Check if repository is already indexed
            checkIndexStatus();
        });
    }
}

function startIndexing() {
    const [owner, repo] = window.location.pathname.slice(1).split('/');
    console.log('Start indexing for:', owner, repo);
    const statusEl = document.getElementById('indexing-status');
    if(statusEl) statusEl.textContent = 'Starting indexing...';
    
    const indexBtn = document.getElementById('index-repo-btn') as HTMLButtonElement;
    const clearBtn = document.getElementById('clear-index-btn') as HTMLButtonElement;
    const searchBtn = document.getElementById('search-btn') as HTMLButtonElement;
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    
    if(indexBtn) indexBtn.disabled = true;
    if(clearBtn) clearBtn.disabled = true;
    if(searchBtn) searchBtn.disabled = true;
    if(searchInput) searchInput.disabled = true;
    
    chrome.runtime.sendMessage({ type: 'START_INDEXING', owner, repo });
}

async function checkIndexStatus() {
    const [owner, repo] = window.location.pathname.slice(1).split('/');
    const repoId = `${owner}/${repo}`;
    
    try {
        chrome.runtime.sendMessage({ type: 'CHECK_INDEX_STATUS', repoId }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('Error checking index status:', chrome.runtime.lastError);
                updateUIState(false);
                return;
            }
            updateUIState(response);
        });
    } catch (error) {
        console.error('Error sending check index status message:', error);
        updateUIState(false);
    }
}

function updateUIState(isIndexed: boolean) {
    const indexBtn = document.getElementById('index-repo-btn') as HTMLButtonElement;
    const clearBtn = document.getElementById('clear-index-btn') as HTMLButtonElement;
    const searchBtn = document.getElementById('search-btn') as HTMLButtonElement;
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    
    if (isIndexed) {
        if (indexBtn) {
            indexBtn.textContent = 'Re-Index Repository';
            indexBtn.title = 'Re-index the repository to update the search index';
            indexBtn.disabled = false;
        }
        if (clearBtn) {
            clearBtn.disabled = false;
        }
        if (searchBtn) searchBtn.disabled = false;
        if (searchInput) searchInput.disabled = false;
        
        const statusEl = document.getElementById('indexing-status');
        if (statusEl) statusEl.textContent = 'Repository is indexed and ready for search';
    } else {
        if (indexBtn) {
            indexBtn.textContent = 'Index Repository';
            indexBtn.title = 'Index the repository to enable code search';
            indexBtn.disabled = false;
        }
        if (clearBtn) {
            clearBtn.disabled = true;
        }
        if (searchBtn) searchBtn.disabled = true;
        if (searchInput) searchInput.disabled = true;
        
        const statusEl = document.getElementById('indexing-status');
        if (statusEl) statusEl.textContent = 'Repository needs to be indexed before searching';
    }
}

function handleSearch() {
    const inputElement = document.getElementById('search-input') as HTMLInputElement;
    const query = inputElement.value.trim();
    const resultsContainer = document.getElementById('search-results');
    const searchButton = document.getElementById('search-btn') as HTMLButtonElement;

    if (!query || query.length < 3) {
        if(resultsContainer) resultsContainer.style.display = 'none';
        return;
    }

    if(searchButton) searchButton.disabled = true;
    
    const [owner, repo] = window.location.pathname.slice(1).split('/');
    try {
        chrome.runtime.sendMessage({ type: 'SEARCH', owner, repo, query }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('Search error:', chrome.runtime.lastError);
                if(searchButton) searchButton.disabled = false;
                const statusEl = document.getElementById('indexing-status');
                if (statusEl) statusEl.textContent = 'Search failed: ' + chrome.runtime.lastError.message;
                return;
            }
            
            displayResults(response || []);
            if(searchButton) searchButton.disabled = false;
        });
    } catch (error) {
        console.error('Error sending search message:', error);
        if(searchButton) searchButton.disabled = false;
        const statusEl = document.getElementById('indexing-status');
        if (statusEl) statusEl.textContent = 'Search failed: ' + error;
    }
}

function displayResults(results: any[]) {
    const resultsContainer = document.getElementById('search-results');
    if (!resultsContainer) return;

    if (!results || results.length === 0) {
        resultsContainer.style.display = 'none';
        return;
    }

    resultsContainer.innerHTML = '';
    resultsContainer.style.display = 'block';
    
    const list = document.createElement('ul');
    list.className = 'list-style-none';

    results.forEach(result => {
        const item = document.createElement('li');
        
        // Format the file path to show it nicely
        const filePath = result.file_path;
        const fileExt = filePath.split('.').pop();
        
        item.innerHTML = `
            <div class="d-flex flex-items-center">
                <svg class="octicon mr-2 color-fg-muted" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
                    <path fill-rule="evenodd" d="M3.75 1.5a.25.25 0 00-.25.25v11.5c0 .138.112.25.25.25h8.5a.25.25 0 00.25-.25V6H9.75A1.75 1.75 0 018 4.25V1.5H3.75zm5.75.56v2.19c0 .138.112.25.25.25h2.19L9.5 2.06zM2 1.75C2 .784 2.784 0 3.75 0h5.086c.464 0 .909.184 1.237.513l3.414 3.414c.329.328.513.773.513 1.237v8.086A1.75 1.75 0 0112.25 15h-8.5A1.75 1.75 0 012 13.25V1.75z"></path>
                </svg>
                <a href="https://github.com/${result.repoId}/blob/main/${result.file_path}" class="Link--primary flex-auto">
                    ${result.file_path}
                </a>
                <span class="Label Label--secondary ml-1">${fileExt}</span>
            </div>
            <div class="mt-2 color-bg-subtle rounded-2 position-relative">
                <div class="position-absolute right-0 top-0 pr-2 pt-1">
                    <span class="Label" title="Similarity score">
                        ${(result.similarity * 100).toFixed(1)}%
                    </span>
                </div>
                <div class="p-2">
                    <code class="f6">${escapeHtml(result.chunk)}</code>
                </div>
            </div>
        `;
        list.appendChild(item);
    });

    resultsContainer.appendChild(list);
}

function escapeHtml(unsafe: string) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function clearIndex() {
    const [owner, repo] = window.location.pathname.slice(1).split('/');
    const repoId = `${owner}/${repo}`;
    
    const clearBtn = document.getElementById('clear-index-btn') as HTMLButtonElement;
    if (clearBtn) clearBtn.disabled = true;
    
    try {
        chrome.runtime.sendMessage({ type: 'CLEAR_INDEX', repoId }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('Error clearing index:', chrome.runtime.lastError);
                if (clearBtn) clearBtn.disabled = false;
                const statusEl = document.getElementById('indexing-status');
                if (statusEl) statusEl.textContent = 'Failed to clear index: ' + chrome.runtime.lastError.message;
                return;
            }
            
            if (response) {
                updateUIState(false);
                const statusEl = document.getElementById('indexing-status');
                if (statusEl) statusEl.textContent = 'Index cleared. Repository needs to be indexed before searching';
            } else {
                if (clearBtn) clearBtn.disabled = false;
                const statusEl = document.getElementById('indexing-status');
                if (statusEl) statusEl.textContent = 'Failed to clear index';
            }
        });
    } catch (error) {
        console.error('Error sending clear index message:', error);
        if (clearBtn) clearBtn.disabled = false;
        const statusEl = document.getElementById('indexing-status');
        if (statusEl) statusEl.textContent = 'Failed to clear index: ' + error;
    }
}

// Inject UI when the page is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectUI);
} else {
    injectUI();
}

// Also handle dynamic page loads in GitHub
new MutationObserver((mutations, observer) => {
    injectUI();
}).observe(document.body, { childList: true, subtree: true }); 