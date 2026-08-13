export { };

function isRepoHomePage() {
    // Don't show on GitHub settings pages
    if (window.location.pathname.startsWith('/settings/')) {
        return false;
    }

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
                                <button id="show-recent-btn" class="btn btn-sm Link--muted" ${!hasToken ? 'disabled' : ''}>
                                    Recent Repos
                                </button>
                            </div>
                        </div>
                        <div id="recent-repos" class="Box mt-2" style="display:none;">
                            <div class="Box-header">
                                <h3 class="Box-title">Recently Indexed Repositories</h3>
                                <button id="close-recent-btn" class="btn-octicon float-right">
                                    <svg class="octicon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
                                        <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"></path>
                                    </svg>
                                </button>
                            </div>
                            <div id="recent-repos-list" class="Box-body">
                                Loading...
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
            document.getElementById('show-recent-btn')?.addEventListener('click', showRecentRepos);
            document.getElementById('close-recent-btn')?.addEventListener('click', hideRecentRepos);
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

            // Check if repository is already indexed automatically
            checkIndexStatus();
        });
    }
}

function startIndexing() {
    const [owner, repo] = window.location.pathname.slice(1).split('/');
    console.log('Start indexing for:', owner, repo);
    const statusEl = document.getElementById('indexing-status');
    if (statusEl) {
        statusEl.textContent = '🚀 Starting indexing with Milvus...';
        statusEl.style.color = '#3b82f6';
    }

    const indexBtn = document.getElementById('index-repo-btn') as HTMLButtonElement;
    const clearBtn = document.getElementById('clear-index-btn') as HTMLButtonElement;
    const searchBtn = document.getElementById('search-btn') as HTMLButtonElement;
    const searchInput = document.getElementById('search-input') as HTMLInputElement;

    if (indexBtn) {
        indexBtn.disabled = true;
        indexBtn.textContent = '⏳ Indexing...';
    }
    if (clearBtn) clearBtn.disabled = true;
    if (searchBtn) searchBtn.disabled = true;
    if (searchInput) searchInput.disabled = true;

    chrome.runtime.sendMessage({ action: 'indexRepo', owner, repo });
}

async function checkIndexStatus() {
    const [owner, repo] = window.location.pathname.slice(1).split('/');
    if (!owner || !repo) return;

    const repoId = `${owner}/${repo}`;

    const statusEl = document.getElementById('indexing-status');
    if (statusEl) statusEl.textContent = 'Checking repository index status...';

    try {
        chrome.runtime.sendMessage(
            { action: 'checkIndexStatus', owner, repo },
            (response) => {
                if (chrome.runtime.lastError) {
                    console.error('Error checking index status:', chrome.runtime.lastError);
                    updateUIState(false);
                    if (statusEl) statusEl.textContent = 'Repository needs to be indexed before searching';
                    return;
                }

                if (response && response.success) {
                    const isIndexed = response.isIndexed;
                    updateUIState(isIndexed, response.indexInfo);

                    if (isIndexed && response.indexInfo) {
                        const indexedDate = new Date(response.indexInfo.indexedAt).toLocaleDateString();
                        const lastSearchText = response.indexInfo.lastSearchAt
                            ? ` • Last searched: ${new Date(response.indexInfo.lastSearchAt).toLocaleDateString()}`
                            : '';
                        if (statusEl) {
                            statusEl.textContent = `✅ Repository indexed on ${indexedDate} (${response.indexInfo.totalFiles} files, ${response.indexInfo.totalChunks} chunks)${lastSearchText}`;
                            statusEl.style.color = '#22c55e';
                        }
                    } else {
                        if (statusEl) {
                            statusEl.textContent = '❌ Repository needs to be indexed before searching';
                            statusEl.style.color = '#ef4444';
                        }
                    }
                } else {
                    console.error('Check index status failed:', response?.error);
                    updateUIState(false);
                    if (statusEl) {
                        statusEl.textContent = '❌ Repository needs to be indexed before searching';
                        statusEl.style.color = '#ef4444';
                    }
                }
            }
        );
    } catch (error) {
        console.error('Error checking index status:', error);
        updateUIState(false);
        if (statusEl) {
            statusEl.textContent = '❌ Repository needs to be indexed before searching';
            statusEl.style.color = '#ef4444';
        }
    }
}

function updateUIState(isIndexed: boolean, indexInfo?: any) {
    const indexBtn = document.getElementById('index-repo-btn') as HTMLButtonElement;
    const clearBtn = document.getElementById('clear-index-btn') as HTMLButtonElement;
    const searchBtn = document.getElementById('search-btn') as HTMLButtonElement;
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    const statusEl = document.getElementById('indexing-status');

    if (isIndexed) {
        if (indexBtn) {
            indexBtn.textContent = '🔄 Re-Index Repository';
            indexBtn.title = 'Re-index the repository to update the search index';
            indexBtn.disabled = false;
            indexBtn.style.backgroundColor = '#fbbf24';
            indexBtn.style.color = '#1f2937';
        }
        if (clearBtn) {
            clearBtn.disabled = false;
            clearBtn.style.backgroundColor = '#ef4444';
            clearBtn.style.color = 'white';
        }
        if (searchBtn) {
            searchBtn.disabled = false;
            searchBtn.style.backgroundColor = '#10b981';
            searchBtn.style.color = 'white';
        }
        if (searchInput) {
            searchInput.disabled = false;
            searchInput.style.borderColor = '#10b981';
        }

        if (statusEl && !indexInfo) {
            statusEl.textContent = '✅ Repository is indexed and ready for search';
            statusEl.style.color = '#22c55e';
        }
    } else {
        if (indexBtn) {
            indexBtn.textContent = '📚 Index Repository';
            indexBtn.title = 'Index the repository to enable code search';
            indexBtn.disabled = false;
            indexBtn.style.backgroundColor = '#3b82f6';
            indexBtn.style.color = 'white';
        }
        if (clearBtn) {
            clearBtn.disabled = true;
            clearBtn.style.backgroundColor = '#9ca3af';
            clearBtn.style.color = '#6b7280';
        }
        if (searchBtn) {
            searchBtn.disabled = true;
            searchBtn.style.backgroundColor = '#9ca3af';
            searchBtn.style.color = '#6b7280';
        }
        if (searchInput) {
            searchInput.disabled = true;
            searchInput.style.borderColor = '#d1d5db';
            searchInput.style.backgroundColor = '#f9fafb';
        }

        if (statusEl && !indexInfo) {
            statusEl.textContent = '❌ Repository needs to be indexed before searching';
            statusEl.style.color = '#ef4444';
        }
    }
}

function handleSearch() {
    const inputElement = document.getElementById('search-input') as HTMLInputElement;
    const query = inputElement.value.trim();
    const resultsContainer = document.getElementById('search-results');
    const searchButton = document.getElementById('search-btn') as HTMLButtonElement;

    if (!query || query.length < 3) {
        if (resultsContainer) resultsContainer.style.display = 'none';
        return;
    }

    if (searchButton) searchButton.disabled = true;

    const [owner, repo] = window.location.pathname.slice(1).split('/');
    const statusEl = document.getElementById('indexing-status');
    if (statusEl) {
        statusEl.textContent = '🔍 Searching with Milvus...';
        statusEl.style.color = '#3b82f6';
    }

    try {
        chrome.runtime.sendMessage({ action: 'searchCode', owner, repo, query }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('Search error:', chrome.runtime.lastError);
                if (searchButton) searchButton.disabled = false;
                if (statusEl) {
                    statusEl.textContent = '❌ Search failed: ' + chrome.runtime.lastError.message;
                    statusEl.style.color = '#ef4444';
                }
                return;
            }

            if (response && response.success) {
                displayResults(response.results || []);
                if (statusEl) {
                    statusEl.textContent = `✅ Found ${response.results?.length || 0} results`;
                    statusEl.style.color = '#22c55e';
                }
            } else {
                console.error('Search failed:', response?.error);
                if (statusEl) {
                    statusEl.textContent = '❌ Search failed: ' + (response?.error || 'Unknown error');
                    statusEl.style.color = '#ef4444';
                }
            }

            if (searchButton) searchButton.disabled = false;
        });
    } catch (error) {
        console.error('Error sending search message:', error);
        if (searchButton) searchButton.disabled = false;
        if (statusEl) {
            statusEl.textContent = '❌ Search failed: ' + error;
            statusEl.style.color = '#ef4444';
        }
    }
}

function displayResults(results: any[]) {
    const resultsContainer = document.getElementById('search-results');
    if (!resultsContainer) return;

    if (!results || results.length === 0) {
        resultsContainer.style.display = 'none';
        return;
    }

    // Ensure results are sorted by score in descending order (highest similarity first)
    const sortedResults = [...results].sort((a, b) => {
        const scoreA = a.score !== undefined && a.score !== null ? a.score : 0;
        const scoreB = b.score !== undefined && b.score !== null ? b.score : 0;
        return scoreB - scoreA;
    });

    resultsContainer.innerHTML = '';
    resultsContainer.style.display = 'block';

    const list = document.createElement('ul');
    list.className = 'list-style-none';

    sortedResults.forEach(result => {
        const item = document.createElement('li');

        // Extract owner/repo from current URL
        const [owner, repo] = window.location.pathname.slice(1).split('/');

        // Format the file path to show it nicely
        const filePath = result.relativePath;
        const fileExt = filePath.split('.').pop();

        // Calculate match percentage and determine CSS class
        const matchPercentage = result.score !== undefined && result.score !== null ? (result.score * 100) : 0;
        let matchClass = 'low';
        if (matchPercentage >= 80) {
            matchClass = 'high';
        } else if (matchPercentage >= 60) {
            matchClass = 'medium';
        }

        item.innerHTML = `
            <div class="d-flex flex-items-center">
                <svg class="octicon mr-2 color-fg-muted" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
                    <path fill-rule="evenodd" d="M3.75 1.5a.25.25 0 00-.25.25v11.5c0 .138.112.25.25.25h8.5a.25.25 0 00.25-.25V6H9.75A1.75 1.75 0 018 4.25V1.5H3.75zm5.75.56v2.19c0 .138.112.25.25.25h2.19L9.5 2.06zM2 1.75C2 .784 2.784 0 3.75 0h5.086c.464 0 .909.184 1.237.513l3.414 3.414c.329.328.513.773.513 1.237v8.086A1.75 1.75 0 0112.25 15h-8.5A1.75 1.75 0 012 13.25V1.75z"></path>
                </svg>
                <a href="https://github.com/${owner}/${repo}/blob/main/${result.relativePath}#L${result.startLine}" class="Link--primary flex-auto" style="font-weight: 600;">
                    ${result.relativePath}
                </a>
                <span class="Label Label--secondary ml-1">${fileExt}</span>
                <span class="color-fg-muted text-small ml-2">Lines ${result.startLine}-${result.endLine}</span>
                <span class="match-score ${matchClass}">${matchPercentage.toFixed(1)}%</span>
            </div>
            <div class="color-fg-muted text-small mt-2">
                <pre class="text-small p-3" style="background-color: #f6f8fa; border-radius: 6px; overflow-x: auto; white-space: pre-wrap; font-size: 13px; line-height: 1.5; border: 1px solid #e1e4e8;">${escapeHtml(result.content.substring(0, 300))}${result.content.length > 300 ? '...' : ''}</pre>
            </div>
        `;

        item.className = 'border-bottom py-2 search-result-item';
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

    const statusEl = document.getElementById('indexing-status');
    if (statusEl) {
        statusEl.textContent = '🗑️ Clearing Milvus index...';
        statusEl.style.color = '#f59e0b';
    }

    try {
        chrome.runtime.sendMessage({ action: 'clearIndex', owner, repo }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('Error clearing index:', chrome.runtime.lastError);
                if (clearBtn) clearBtn.disabled = false;
                if (statusEl) {
                    statusEl.textContent = '❌ Failed to clear index: ' + chrome.runtime.lastError.message;
                    statusEl.style.color = '#ef4444';
                }
                return;
            }

            if (response && response.success) {
                updateUIState(false);
                if (statusEl) {
                    statusEl.textContent = '✅ Index cleared. Repository needs to be indexed before searching';
                    statusEl.style.color = '#22c55e';
                }

                // Hide search results if visible
                const resultsContainer = document.getElementById('search-results');
                if (resultsContainer) resultsContainer.style.display = 'none';

                // Clear search input
                const searchInput = document.getElementById('search-input') as HTMLInputElement;
                if (searchInput) searchInput.value = '';
            } else {
                if (clearBtn) clearBtn.disabled = false;
                if (statusEl) {
                    statusEl.textContent = '❌ Failed to clear index: ' + (response?.error || 'Unknown error');
                    statusEl.style.color = '#ef4444';
                }
            }
        });
    } catch (error) {
        console.error('Error sending clear index message:', error);
        if (clearBtn) clearBtn.disabled = false;
        if (statusEl) {
            statusEl.textContent = '❌ Failed to clear index: ' + error;
            statusEl.style.color = '#ef4444';
        }
    }
}

function showRecentRepos() {
    const recentReposContainer = document.getElementById('recent-repos');
    const recentReposList = document.getElementById('recent-repos-list');

    if (!recentReposContainer || !recentReposList) return;

    recentReposContainer.style.display = 'block';
    recentReposList.innerHTML = 'Loading...';

    chrome.runtime.sendMessage({ action: 'getIndexedRepos' }, (response) => {
        if (chrome.runtime.lastError) {
            console.error('Error getting indexed repos:', chrome.runtime.lastError);
            recentReposList.innerHTML = 'Error loading recent repositories';
            return;
        }

        if (response && response.success) {
            displayRecentRepos(response.repos || []);
        } else {
            recentReposList.innerHTML = 'Error loading recent repositories: ' + (response?.error || 'Unknown error');
        }
    });
}

function hideRecentRepos() {
    const recentReposContainer = document.getElementById('recent-repos');
    if (recentReposContainer) {
        recentReposContainer.style.display = 'none';
    }
}

function displayRecentRepos(repos: any[]) {
    const recentReposList = document.getElementById('recent-repos-list');
    if (!recentReposList) return;

    if (!repos || repos.length === 0) {
        recentReposList.innerHTML = '<div class="color-fg-muted text-center py-3">No recently indexed repositories</div>';
        return;
    }

    const list = document.createElement('ul');
    list.className = 'list-style-none';

    repos.forEach(repo => {
        const item = document.createElement('li');
        item.className = 'border-bottom py-2';

        const indexedDate = new Date(repo.indexedAt).toLocaleDateString();
        const lastSearchDate = repo.lastSearchAt ? new Date(repo.lastSearchAt).toLocaleDateString() : 'Never';

        item.innerHTML = `
            <div class="d-flex flex-items-center justify-content-between">
                <div class="flex-auto">
                    <a href="https://github.com/${repo.id}" class="Link--primary font-weight-bold">
                        ${repo.id}
                    </a>
                    <div class="color-fg-muted text-small">
                        Indexed: ${indexedDate} • ${repo.totalFiles} files, ${repo.totalChunks} chunks
                    </div>
                    <div class="color-fg-muted text-small">
                        Last search: ${lastSearchDate}
                    </div>
                </div>
                <button class="btn btn-sm go-to-repo-btn" data-repo-url="https://github.com/${repo.id}">
                    Visit
                </button>
            </div>
        `;

        list.appendChild(item);
    });

    recentReposList.innerHTML = '';
    recentReposList.appendChild(list);

    list.querySelectorAll('.go-to-repo-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const url = (e.target as HTMLElement).getAttribute('data-repo-url');
            if (url) {
                window.location.href = url;
            }
        });
    });
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const statusEl = document.getElementById('indexing-status');

    if (message.action === 'indexProgress') {
        if (statusEl) {
            statusEl.textContent = `🔄 ${message.progress}`;
            statusEl.style.color = '#3b82f6';
        }
    } else if (message.action === 'indexComplete') {
        if (statusEl) {
            statusEl.textContent = `✅ Indexing complete! ${message.stats.indexedFiles} files, ${message.stats.totalChunks} chunks`;
            statusEl.style.color = '#22c55e';
        }
        updateUIState(true);

        // Auto-refresh index status after a short delay to get updated info
        setTimeout(() => {
            checkIndexStatus();
        }, 1000);
    } else if (message.action === 'indexError') {
        if (statusEl) {
            statusEl.textContent = `❌ Indexing failed: ${message.error}`;
            statusEl.style.color = '#ef4444';
        }
        updateUIState(false);
    }
});

// Inject UI when the page is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectUI);
} else {
    injectUI();
}

// Handle dynamic page loads in GitHub (SPA navigation)
let lastUrl = window.location.href;
new MutationObserver((mutations, observer) => {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        // URL changed, re-inject UI and check index status
        setTimeout(() => {
            injectUI();
        }, 100); // Small delay to ensure DOM is updated
    } else {
        // Just check if UI needs to be injected (for dynamic content)
        injectUI();
    }
}).observe(document.body, { childList: true, subtree: true }); 