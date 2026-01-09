/**
 * TreeDataProvider for the Claude Sessions sidebar
 * Supports folder grouping by project/task focus with drag-and-drop
 */

import * as vscode from 'vscode';
import { ClaudeSession } from './types';
import { HistoryParser } from './historyParser';
import { MetadataManager } from './metadataManager';
import { SessionManager } from './sessionManager';

/**
 * Base class for tree items
 */
export type SessionTreeItem = SessionItem | FolderItem;

/**
 * MIME type for drag and drop
 */
const SESSION_MIME_TYPE = 'application/vnd.code.tree.claudesessionlist';

/**
 * Folder item for grouping sessions
 */
export class FolderItem extends vscode.TreeItem {
    constructor(
        public readonly folderName: string,
        public readonly folderType: 'project' | 'archived',
        public readonly sessionCount: number,
        public readonly icon: string,
        public readonly color?: string
    ) {
        super(folderName, vscode.TreeItemCollapsibleState.Collapsed);

        this.contextValue = folderType === 'archived' ? 'archivedFolder' : 'projectFolder';
        this.iconPath = new vscode.ThemeIcon(icon, color ? new vscode.ThemeColor(color) : undefined);
        this.description = `${sessionCount} session${sessionCount !== 1 ? 's' : ''}`;

        const tooltip = new vscode.MarkdownString();
        if (folderType === 'archived') {
            tooltip.appendMarkdown(`### Archived Sessions\n\n${sessionCount} archived session${sessionCount !== 1 ? 's' : ''}\n\nRight-click sessions to unarchive them.`);
        } else {
            tooltip.appendMarkdown(`### ${folderName}\n\n${sessionCount} session${sessionCount !== 1 ? 's' : ''}\n\nDrag sessions here to organize.`);
        }
        this.tooltip = tooltip;
    }
}

/**
 * Session item representing a single Claude session
 */
export class SessionItem extends vscode.TreeItem {
    constructor(
        public readonly session: ClaudeSession,
        public readonly displayName: string,
        public readonly summaryText: string | null,
        public readonly taskFocus: string,
        public readonly isActive: boolean,
        public readonly isFork: boolean,
        public readonly isArchived: boolean,
        public readonly parentName?: string
    ) {
        super(displayName, vscode.TreeItemCollapsibleState.None);

        // Set context for menu commands
        this.contextValue = isArchived ? 'archivedSession' : 'session';

        // Icon and color based on task focus category
        const { icon, color } = this.getIconForTaskFocus(taskFocus, isActive, isFork, isArchived);
        this.iconPath = new vscode.ThemeIcon(icon, color ? new vscode.ThemeColor(color) : undefined);

        // Description: show Claude's summary if available, otherwise time ago
        if (summaryText) {
            this.description = summaryText.length > 60
                ? summaryText.slice(0, 57) + '...'
                : summaryText;
        } else {
            this.description = this.getTimeAgo(session.lastActivityTime);
        }

        // Tooltip with full details
        const tooltipParts: string[] = [];
        tooltipParts.push(`## ${displayName}`, '');
        if (summaryText) {
            tooltipParts.push(`> ${summaryText}`, '');
        }
        const timeAgo = this.getTimeAgo(session.lastActivityTime);
        tooltipParts.push(`**${timeAgo}** · ${session.messageCount} messages`, '');
        tooltipParts.push('---', '');
        tooltipParts.push(`**Started:** ${session.startTime.toLocaleString()}`);
        tooltipParts.push(`**Last active:** ${session.lastActivityTime.toLocaleString()}`);
        tooltipParts.push(`**Path:** \`${session.projectPath || 'Unknown'}\``);
        tooltipParts.push(`**Session ID:** \`${session.id}\``);
        if (isActive) {
            tooltipParts.push('', '🟢 **Currently running**');
        }
        if (isFork && parentName) {
            tooltipParts.push('', `🔀 Forked from: ${parentName}`);
        }
        if (isArchived) {
            tooltipParts.push('', '📦 **Archived** - right-click to unarchive');
        }
        const tooltip = new vscode.MarkdownString(tooltipParts.join('\n'));
        tooltip.isTrusted = true;
        this.tooltip = tooltip;

        // Command to open session on click
        this.command = {
            command: 'claudeSessions.openSession',
            title: 'Open Session',
            arguments: [this]
        };
    }

    /**
     * Get icon and color based on task focus
     */
    private getIconForTaskFocus(taskFocus: string, isActive: boolean, isFork: boolean, isArchived: boolean): { icon: string; color?: string } {
        // Archived sessions get dimmed icon
        if (isArchived) {
            return { icon: 'archive', color: 'disabledForeground' };
        }

        // Active sessions always get green terminal
        if (isActive) {
            return { icon: 'terminal', color: 'terminal.ansiGreen' };
        }

        // Forked sessions
        if (isFork) {
            return { icon: 'git-branch', color: 'terminal.ansiMagenta' };
        }

        // Color by task focus category
        const focusLower = taskFocus.toLowerCase();

        // Research projects - blue tones
        if (focusLower.includes('hiring') || focusLower.includes('jhu')) {
            return { icon: 'mortar-board', color: 'terminal.ansiBlue' };
        }
        if (focusLower.includes('corpus') || focusLower.includes('search')) {
            return { icon: 'search', color: 'terminal.ansiCyan' };
        }
        if (focusLower.includes('blame') || focusLower.includes('kira') ||
            focusLower.includes('claims') || focusLower.includes('compliant') ||
            focusLower.includes('deceptive') || focusLower.includes('egonormous')) {
            return { icon: 'beaker', color: 'terminal.ansiBlue' };
        }

        // Infrastructure/tools - yellow/orange
        if (focusLower.includes('drone') || focusLower.includes('dji')) {
            return { icon: 'radio-tower', color: 'terminal.ansiYellow' };
        }
        if (focusLower.includes('notion') || focusLower.includes('slack') ||
            focusLower.includes('email') || focusLower.includes('session-manager')) {
            return { icon: 'tools', color: 'terminal.ansiYellow' };
        }

        // Meta categories - merged Global and Self-improvement
        if (focusLower === 'self-improvement' || focusLower === 'global' || focusLower === 'meta') {
            return { icon: 'lightbulb', color: 'terminal.ansiMagenta' };
        }
        if (focusLower === 'iaseai' || focusLower.includes('workshop')) {
            return { icon: 'calendar', color: 'terminal.ansiGreen' };
        }
        if (focusLower === 'minty') {
            return { icon: 'hubot', color: 'terminal.ansiGreen' };
        }

        // Default
        return { icon: 'comment-discussion', color: undefined };
    }

    private getTimeAgo(date: Date): string {
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString();
    }
}

/**
 * Normalize folder names - merge similar categories
 */
function normalizeFolderName(taskFocus: string): string {
    const lower = taskFocus.toLowerCase();
    // Merge Global and Self-improvement into "Meta"
    if (lower === 'global' || lower === 'self-improvement') {
        return 'Meta';
    }
    return taskFocus;
}

/**
 * Get folder icon and color for a task focus
 */
function getFolderIconForTaskFocus(taskFocus: string): { icon: string; color?: string } {
    const focusLower = taskFocus.toLowerCase();

    if (focusLower.includes('hiring') || focusLower.includes('jhu')) {
        return { icon: 'mortar-board', color: 'terminal.ansiBlue' };
    }
    if (focusLower.includes('corpus') || focusLower.includes('search')) {
        return { icon: 'search', color: 'terminal.ansiCyan' };
    }
    if (focusLower.includes('blame') || focusLower.includes('kira') ||
        focusLower.includes('claims') || focusLower.includes('compliant') ||
        focusLower.includes('deceptive') || focusLower.includes('egonormous')) {
        return { icon: 'beaker', color: 'terminal.ansiBlue' };
    }
    if (focusLower.includes('drone') || focusLower.includes('dji')) {
        return { icon: 'radio-tower', color: 'terminal.ansiYellow' };
    }
    if (focusLower.includes('notion') || focusLower.includes('slack') ||
        focusLower.includes('email') || focusLower.includes('session-manager')) {
        return { icon: 'tools', color: 'terminal.ansiYellow' };
    }
    if (focusLower === 'meta' || focusLower === 'self-improvement' || focusLower === 'global') {
        return { icon: 'lightbulb', color: 'terminal.ansiMagenta' };
    }
    if (focusLower === 'iaseai' || focusLower.includes('workshop')) {
        return { icon: 'calendar', color: 'terminal.ansiGreen' };
    }
    if (focusLower === 'minty') {
        return { icon: 'hubot', color: 'terminal.ansiGreen' };
    }

    return { icon: 'folder', color: undefined };
}

/**
 * Drag and drop controller for sessions
 */
export class SessionDragAndDropController implements vscode.TreeDragAndDropController<SessionTreeItem> {
    readonly dragMimeTypes = [SESSION_MIME_TYPE];
    readonly dropMimeTypes = [SESSION_MIME_TYPE];

    private metadataManager: MetadataManager;
    private refreshCallback: () => void;

    constructor(metadataManager: MetadataManager, refreshCallback: () => void) {
        this.metadataManager = metadataManager;
        this.refreshCallback = refreshCallback;
    }

    handleDrag(source: readonly SessionTreeItem[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): void | Thenable<void> {
        // Only allow dragging sessions, not folders
        const sessions = source.filter(item => item instanceof SessionItem) as SessionItem[];
        if (sessions.length > 0) {
            dataTransfer.set(SESSION_MIME_TYPE, new vscode.DataTransferItem(sessions.map(s => s.session.id)));
        }
    }

    handleDrop(target: SessionTreeItem | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): void | Thenable<void> {
        // Only allow dropping on folders
        if (!(target instanceof FolderItem)) {
            return;
        }

        // Don't allow dropping on archived folder (use archive command instead)
        if (target.folderType === 'archived') {
            vscode.window.showInformationMessage('Use right-click > Archive to archive sessions');
            return;
        }

        const transferItem = dataTransfer.get(SESSION_MIME_TYPE);
        if (!transferItem) {
            return;
        }

        return (async () => {
            const sessionIds: string[] = transferItem.value;
            const folderName = target.folderName;

            for (const sessionId of sessionIds) {
                await this.metadataManager.setCustomFolder(sessionId, folderName);
            }

            this.refreshCallback();
            const msg = sessionIds.length === 1
                ? `Session moved to ${folderName}`
                : `${sessionIds.length} sessions moved to ${folderName}`;
            vscode.window.showInformationMessage(msg);
        })();
    }
}

export class SessionProvider implements vscode.TreeDataProvider<SessionTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<SessionTreeItem | undefined | null | void> =
        new vscode.EventEmitter<SessionTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<SessionTreeItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    private historyParser: HistoryParser;
    private metadataManager: MetadataManager;
    private sessionManager: SessionManager;
    private cachedSessions: Map<string, SessionItem[]> = new Map(); // taskFocus -> sessions
    private cachedArchivedSessions: SessionItem[] = [];
    private refreshInterval: NodeJS.Timeout | undefined;

    // Drag and drop controller
    readonly dragAndDropController: SessionDragAndDropController;

    constructor(
        historyParser: HistoryParser,
        metadataManager: MetadataManager,
        sessionManager: SessionManager
    ) {
        this.historyParser = historyParser;
        this.metadataManager = metadataManager;
        this.sessionManager = sessionManager;
        this.dragAndDropController = new SessionDragAndDropController(metadataManager, () => this.refresh());

        // Auto-refresh every 30 seconds
        this.refreshInterval = setInterval(() => {
            this.refresh();
        }, 30000);
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: SessionTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: SessionTreeItem): Promise<SessionTreeItem[]> {
        // If element is a folder, return its children
        if (element instanceof FolderItem) {
            if (element.folderType === 'archived') {
                return this.cachedArchivedSessions;
            } else {
                return this.cachedSessions.get(element.folderName) || [];
            }
        }

        // If element is a session, no children
        if (element instanceof SessionItem) {
            return [];
        }

        // Root level - build folders
        const config = vscode.workspace.getConfiguration('claudeSessions');
        const maxSessions = config.get<number>('maxSessionsToShow') || 50;
        const showHistorical = config.get<boolean>('showHistoricalSessions') ?? true;

        // Fetch sessions
        const sessions = await this.historyParser.getSessions(maxSessions);

        // Group sessions by task focus (or custom folder)
        const sessionsByFolder: Map<string, SessionItem[]> = new Map();
        const archivedSessions: SessionItem[] = [];

        for (const session of sessions) {
            const isActive = this.sessionManager.isSessionRunning(session.id) ||
                            this.historyParser.isSessionActive(session);

            // Skip historical if config says so
            if (!showHistorical && !isActive) {
                continue;
            }

            // Get display name and task focus
            const defaultName = this.historyParser.generateDefaultName(session);
            const autoTaskFocus = defaultName.split(' • ')[0];

            // Check for custom folder assignment, otherwise use auto-detected (normalized)
            const customFolder = this.metadataManager.getCustomFolder(session.id);
            const taskFocus = customFolder || normalizeFolderName(autoTaskFocus);

            const displayName = this.metadataManager.getSessionName(session.id) || defaultName;

            // Get Claude's summary
            const summary = session.autoGeneratedName ||
                           await this.historyParser.getSessionSummary(session.id);

            // Check fork status
            const parentId = this.metadataManager.getParentSession(session.id);
            const isFork = !!parentId;
            let parentName: string | undefined;
            if (parentId) {
                parentName = this.metadataManager.getSessionName(parentId) ||
                            this.historyParser.generateDefaultName(session);
            }

            const isArchived = this.metadataManager.isArchived(session.id);
            const item = new SessionItem(session, displayName, summary, taskFocus, isActive, isFork, isArchived, parentName);

            if (isArchived) {
                archivedSessions.push(item);
            } else {
                if (!sessionsByFolder.has(taskFocus)) {
                    sessionsByFolder.set(taskFocus, []);
                }
                sessionsByFolder.get(taskFocus)!.push(item);
            }
        }

        // Cache for folder expansion
        this.cachedSessions = sessionsByFolder;
        this.cachedArchivedSessions = archivedSessions;

        // Build folder items
        const folders: FolderItem[] = [];

        // Sort folders: active sessions first, then alphabetically
        const sortedFolders = Array.from(sessionsByFolder.entries()).sort((a, b) => {
            // Check if either has active sessions
            const aHasActive = a[1].some(s => s.isActive);
            const bHasActive = b[1].some(s => s.isActive);
            if (aHasActive && !bHasActive) return -1;
            if (!aHasActive && bHasActive) return 1;
            // Then by name
            return a[0].localeCompare(b[0]);
        });

        for (const [taskFocus, items] of sortedFolders) {
            const { icon, color } = getFolderIconForTaskFocus(taskFocus);
            folders.push(new FolderItem(taskFocus, 'project', items.length, icon, color));
        }

        // Add archived folder at the end if there are archived sessions
        if (archivedSessions.length > 0) {
            folders.push(new FolderItem('Archived', 'archived', archivedSessions.length, 'archive', 'disabledForeground'));
        }

        return folders;
    }

    /**
     * Get a session item by ID
     */
    getSessionById(sessionId: string): SessionItem | undefined {
        for (const sessions of this.cachedSessions.values()) {
            const found = sessions.find(item => item.session.id === sessionId);
            if (found) return found;
        }
        return this.cachedArchivedSessions.find(item => item.session.id === sessionId);
    }

    dispose(): void {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
    }
}
