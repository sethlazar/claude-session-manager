/**
 * Search provider with embedded search bar using WebviewView
 */

import * as vscode from 'vscode';
import { HistoryParser } from './historyParser';
import { MetadataManager } from './metadataManager';
import { ClaudeSession, ClaudeMessage } from './types';

interface SearchResult {
    session: ClaudeSession;
    message: ClaudeMessage;
    matchContext: string;
}

export class SearchProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'claudeSessionSearch';

    private _view?: vscode.WebviewView;
    private historyParser: HistoryParser;
    private metadataManager: MetadataManager;
    private currentQuery: string = '';
    private searchResults: SearchResult[] = [];
    private isSearching: boolean = false;

    constructor(historyParser: HistoryParser, metadataManager: MetadataManager) {
        this.historyParser = historyParser;
        this.metadataManager = metadataManager;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'search':
                    await this.search(data.query);
                    break;
                case 'openSession':
                    const sessionId = data.sessionId;
                    // Find the session and open it
                    vscode.commands.executeCommand('claudeSessions.openSessionById', sessionId);
                    break;
                case 'clear':
                    this.clear();
                    break;
            }
        });
    }

    /**
     * Perform a search
     */
    async search(query: string): Promise<void> {
        if (this.isSearching) {
            return;
        }

        if (!query.trim()) {
            this.clear();
            return;
        }

        this.currentQuery = query;
        this.isSearching = true;

        // Update UI to show searching state
        this._view?.webview.postMessage({
            type: 'searching',
            query: query
        });

        try {
            const results = await this.historyParser.searchTranscripts(query);
            this.searchResults = results;

            // Build results with session names
            const resultsWithNames = results.map(result => {
                const defaultName = this.historyParser.generateDefaultName(result.session);
                const sessionName = this.metadataManager.getSessionName(result.session.id) || defaultName;
                return {
                    ...result,
                    sessionName,
                    sessionId: result.session.id
                };
            });

            this._view?.webview.postMessage({
                type: 'results',
                query: query,
                results: resultsWithNames.map(r => ({
                    sessionId: r.sessionId,
                    sessionName: r.sessionName,
                    role: r.message.role,
                    context: r.matchContext,
                    timestamp: r.message.timestamp.toISOString()
                }))
            });
        } finally {
            this.isSearching = false;
        }
    }

    /**
     * Clear search results
     */
    clear(): void {
        this.currentQuery = '';
        this.searchResults = [];
        this._view?.webview.postMessage({
            type: 'clear'
        });
    }

    /**
     * Get current query
     */
    getCurrentQuery(): string {
        return this.currentQuery;
    }

    /**
     * Focus the search input
     */
    focus(): void {
        this._view?.webview.postMessage({
            type: 'focus'
        });
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-sideBar-background);
            padding: 8px;
        }
        .search-container {
            position: relative;
            margin-bottom: 8px;
        }
        .search-input {
            width: 100%;
            padding: 6px 30px 6px 8px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            outline: none;
            font-size: 13px;
        }
        .search-input:focus {
            border-color: var(--vscode-focusBorder);
        }
        .search-input::placeholder {
            color: var(--vscode-input-placeholderForeground);
        }
        .clear-btn {
            position: absolute;
            right: 6px;
            top: 50%;
            transform: translateY(-50%);
            background: none;
            border: none;
            color: var(--vscode-input-foreground);
            cursor: pointer;
            opacity: 0.6;
            font-size: 14px;
            padding: 2px;
        }
        .clear-btn:hover {
            opacity: 1;
        }
        .clear-btn.hidden {
            display: none;
        }
        .status {
            color: var(--vscode-descriptionForeground);
            font-size: 11px;
            margin-bottom: 8px;
            padding: 0 4px;
        }
        .results {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .result-item {
            padding: 8px;
            background: var(--vscode-list-hoverBackground);
            border-radius: 4px;
            cursor: pointer;
            border: 1px solid transparent;
        }
        .result-item:hover {
            background: var(--vscode-list-activeSelectionBackground);
            border-color: var(--vscode-focusBorder);
        }
        .result-header {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 4px;
        }
        .result-icon {
            font-size: 14px;
        }
        .result-session {
            font-weight: 500;
            color: var(--vscode-foreground);
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .result-time {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }
        .result-context {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            line-height: 1.4;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }
        .result-context mark {
            background: var(--vscode-editor-findMatchHighlightBackground);
            color: inherit;
            padding: 0 2px;
            border-radius: 2px;
        }
        .empty-state {
            text-align: center;
            padding: 20px;
            color: var(--vscode-descriptionForeground);
        }
        .empty-state .icon {
            font-size: 32px;
            margin-bottom: 8px;
            opacity: 0.5;
        }
    </style>
</head>
<body>
    <div class="search-container">
        <input type="text" class="search-input" id="searchInput" placeholder="Search sessions..." />
        <button class="clear-btn hidden" id="clearBtn" title="Clear">✕</button>
    </div>
    <div class="status" id="status"></div>
    <div class="results" id="results">
        <div class="empty-state">
            <div class="icon">🔍</div>
            <div>Search session transcripts</div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const searchInput = document.getElementById('searchInput');
        const clearBtn = document.getElementById('clearBtn');
        const status = document.getElementById('status');
        const results = document.getElementById('results');

        let debounceTimer;

        searchInput.addEventListener('input', (e) => {
            const query = e.target.value;
            clearBtn.classList.toggle('hidden', !query);

            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                if (query.trim().length >= 2) {
                    vscode.postMessage({ type: 'search', query: query.trim() });
                } else if (!query.trim()) {
                    vscode.postMessage({ type: 'clear' });
                }
            }, 300);
        });

        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                searchInput.value = '';
                clearBtn.classList.add('hidden');
                vscode.postMessage({ type: 'clear' });
            }
        });

        clearBtn.addEventListener('click', () => {
            searchInput.value = '';
            clearBtn.classList.add('hidden');
            vscode.postMessage({ type: 'clear' });
            searchInput.focus();
        });

        function formatTime(isoString) {
            const date = new Date(isoString);
            const now = new Date();
            const diffMs = now - date;
            const diffDays = Math.floor(diffMs / 86400000);

            if (diffDays === 0) {
                return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            } else if (diffDays === 1) {
                return 'Yesterday';
            } else if (diffDays < 7) {
                return diffDays + 'd ago';
            } else {
                return date.toLocaleDateString();
            }
        }

        function highlightMatch(text, query) {
            if (!query) return text;
            const escaped = query.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\$&');
            const regex = new RegExp('(' + escaped + ')', 'gi');
            return text.replace(regex, '<mark>$1</mark>');
        }

        function renderResults(data) {
            if (data.results.length === 0) {
                results.innerHTML = '<div class="empty-state"><div class="icon">🔍</div><div>No results found</div></div>';
                status.textContent = 'No matches for "' + data.query + '"';
                return;
            }

            status.textContent = data.results.length + ' result' + (data.results.length !== 1 ? 's' : '') + ' for "' + data.query + '"';

            results.innerHTML = data.results.map(r => {
                const icon = r.role === 'user' ? '👤' : '🤖';
                const context = highlightMatch(r.context.replace(/\\n/g, ' ').substring(0, 200), data.query);
                return '<div class="result-item" data-session-id="' + r.sessionId + '">' +
                    '<div class="result-header">' +
                        '<span class="result-icon">' + icon + '</span>' +
                        '<span class="result-session">' + r.sessionName + '</span>' +
                        '<span class="result-time">' + formatTime(r.timestamp) + '</span>' +
                    '</div>' +
                    '<div class="result-context">' + context + '</div>' +
                '</div>';
            }).join('');

            // Add click handlers
            document.querySelectorAll('.result-item').forEach(item => {
                item.addEventListener('click', () => {
                    const sessionId = item.dataset.sessionId;
                    vscode.postMessage({ type: 'openSession', sessionId: sessionId });
                });
            });
        }

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'searching':
                    status.textContent = 'Searching...';
                    break;
                case 'results':
                    renderResults(message);
                    break;
                case 'clear':
                    status.textContent = '';
                    results.innerHTML = '<div class="empty-state"><div class="icon">🔍</div><div>Search session transcripts</div></div>';
                    break;
                case 'focus':
                    searchInput.focus();
                    break;
            }
        });

        // Focus input on load
        searchInput.focus();
    </script>
</body>
</html>`;
    }
}

// Legacy exports for backward compatibility
export class SearchResultItem extends vscode.TreeItem {
    constructor(
        public readonly result: { session: ClaudeSession; message: ClaudeMessage; matchContext: string },
        public readonly sessionName: string
    ) {
        super(sessionName, vscode.TreeItemCollapsibleState.None);
    }
}

export async function showSearchInput(searchProvider: SearchProvider): Promise<void> {
    searchProvider.focus();
}
