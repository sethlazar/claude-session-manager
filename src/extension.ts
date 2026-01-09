/**
 * Claude Session Manager - VS Code Extension
 *
 * Manage multiple Claude Code CLI sessions from VS Code/Cursor
 */

import * as vscode from 'vscode';
import { HistoryParser } from './historyParser';
import { MetadataManager } from './metadataManager';
import { SessionManager } from './sessionManager';
import { SessionProvider, SessionItem, FolderItem } from './sessionProvider';
import { SearchProvider, showSearchInput } from './searchProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('Claude Session Manager is now active');

    // Initialize core components
    const historyParser = new HistoryParser();
    const metadataManager = new MetadataManager(context);
    const sessionManager = new SessionManager(context, metadataManager);

    // Initialize providers
    const sessionProvider = new SessionProvider(historyParser, metadataManager, sessionManager);
    const searchProvider = new SearchProvider(historyParser, metadataManager);

    // Register tree view for sessions with multi-select and drag-and-drop
    const sessionTreeView = vscode.window.createTreeView('claudeSessionList', {
        treeDataProvider: sessionProvider,
        showCollapseAll: true,
        canSelectMany: true,
        dragAndDropController: sessionProvider.dragAndDropController
    });

    // Register webview view for search
    const searchViewProvider = vscode.window.registerWebviewViewProvider(
        SearchProvider.viewType,
        searchProvider
    );

    // Register commands
    const commands: { command: string; callback: (...args: any[]) => any }[] = [
        {
            command: 'claudeSessions.newSession',
            callback: async () => {
                const flags = await sessionManager.showFlagConfiguration();
                if (flags !== undefined) {
                    await sessionManager.startNewSession(flags);
                    // Refresh list after a short delay
                    setTimeout(() => sessionProvider.refresh(), 2000);
                }
            }
        },
        {
            command: 'claudeSessions.openSession',
            callback: async (item: SessionItem) => {
                if (!item || !item.session) {
                    vscode.window.showErrorMessage('No session selected');
                    return;
                }

                // Check if already running
                if (sessionManager.focusSession(item.session.id)) {
                    return; // Already focused
                }

                // Resume the session
                await sessionManager.resumeSession(item.session);
                sessionProvider.refresh();
            }
        },
        {
            command: 'claudeSessions.forkSession',
            callback: async (item: SessionItem) => {
                if (!item || !item.session) {
                    vscode.window.showErrorMessage('No session selected');
                    return;
                }

                // Confirm fork
                const confirm = await vscode.window.showInformationMessage(
                    `Fork session "${item.displayName}"? The parent session will be frozen.`,
                    'Fork',
                    'Cancel'
                );

                if (confirm !== 'Fork') {
                    return;
                }

                await sessionManager.forkSession(item.session);
                setTimeout(() => sessionProvider.refresh(), 2000);
            }
        },
        {
            command: 'claudeSessions.renameSession',
            callback: async (item: SessionItem) => {
                if (!item || !item.session) {
                    vscode.window.showErrorMessage('No session selected');
                    return;
                }

                const newName = await vscode.window.showInputBox({
                    prompt: 'Enter new name for session',
                    value: item.displayName,
                    validateInput: (value) => {
                        if (!value.trim()) {
                            return 'Name cannot be empty';
                        }
                        return null;
                    }
                });

                if (newName && newName.trim()) {
                    await metadataManager.setCustomName(item.session.id, newName.trim());
                    sessionProvider.refresh();
                    vscode.window.showInformationMessage(`Session renamed to "${newName}"`);
                }
            }
        },
        {
            command: 'claudeSessions.archiveSession',
            callback: async (item: SessionItem, selectedItems?: SessionItem[]) => {
                // Handle multi-select: use selectedItems if available, otherwise single item
                const items = selectedItems && selectedItems.length > 0
                    ? selectedItems.filter(i => i instanceof SessionItem && i.session)
                    : (item && item.session ? [item] : []);

                if (items.length === 0) {
                    vscode.window.showErrorMessage('No sessions selected');
                    return;
                }

                for (const sessionItem of items) {
                    await metadataManager.archiveSession(sessionItem.session.id);
                }
                sessionProvider.refresh();
                const msg = items.length === 1
                    ? 'Session archived'
                    : `${items.length} sessions archived`;
                vscode.window.showInformationMessage(msg);
            }
        },
        {
            command: 'claudeSessions.unarchiveSession',
            callback: async (item: SessionItem, selectedItems?: SessionItem[]) => {
                // Handle multi-select
                const items = selectedItems && selectedItems.length > 0
                    ? selectedItems.filter(i => i instanceof SessionItem && i.session)
                    : (item && item.session ? [item] : []);

                if (items.length === 0) {
                    vscode.window.showErrorMessage('No sessions selected');
                    return;
                }

                for (const sessionItem of items) {
                    await metadataManager.unarchiveSession(sessionItem.session.id);
                }
                sessionProvider.refresh();
                const msg = items.length === 1
                    ? 'Session restored from archive'
                    : `${items.length} sessions restored from archive`;
                vscode.window.showInformationMessage(msg);
            }
        },
        {
            command: 'claudeSessions.refresh',
            callback: () => {
                sessionProvider.refresh();
            }
        },
        {
            command: 'claudeSessions.searchTranscripts',
            callback: async () => {
                await showSearchInput(searchProvider);
            }
        },
        {
            command: 'claudeSessions.configureFlags',
            callback: async () => {
                // Open settings
                await vscode.commands.executeCommand(
                    'workbench.action.openSettings',
                    'claudeSessions'
                );
            }
        },
        {
            command: 'claudeSessions.openSessionById',
            callback: async (sessionId: string) => {
                if (!sessionId) {
                    return;
                }

                // Get sessions and find the one with this ID
                const sessions = await historyParser.getSessions(100);
                const session = sessions.find(s => s.id === sessionId);

                if (!session) {
                    vscode.window.showErrorMessage('Session not found');
                    return;
                }

                // Check if already running
                if (sessionManager.focusSession(sessionId)) {
                    return;
                }

                // Resume the session
                await sessionManager.resumeSession(session);
                sessionProvider.refresh();
            }
        }
    ];

    // Register all commands
    for (const cmd of commands) {
        context.subscriptions.push(
            vscode.commands.registerCommand(cmd.command, cmd.callback)
        );
    }

    // Register tree views and providers
    context.subscriptions.push(sessionTreeView);
    context.subscriptions.push(searchViewProvider);

    // Cleanup on deactivation
    context.subscriptions.push({
        dispose: () => {
            sessionProvider.dispose();
            sessionManager.dispose();
        }
    });

    // Show welcome message on first activation
    const hasShownWelcome = context.globalState.get<boolean>('hasShownWelcome');
    if (!hasShownWelcome) {
        vscode.window.showInformationMessage(
            'Claude Session Manager is ready! Click the Claude icon in the activity bar to manage sessions.',
            'Got it'
        );
        context.globalState.update('hasShownWelcome', true);
    }
}

export function deactivate() {
    console.log('Claude Session Manager is now deactivated');
}
