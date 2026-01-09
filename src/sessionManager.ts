/**
 * Manage Claude CLI sessions - spawning, resuming, forking
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { ClaudeSession, AVAILABLE_FLAGS, FlagOption } from './types';
import { MetadataManager } from './metadataManager';

interface ActiveTerminal {
    terminal: vscode.Terminal;
    sessionId: string;
}

export class SessionManager {
    private context: vscode.ExtensionContext;
    private metadataManager: MetadataManager;
    private activeTerminals: Map<string, ActiveTerminal> = new Map();
    private terminalListener: vscode.Disposable | undefined;

    constructor(context: vscode.ExtensionContext, metadataManager: MetadataManager) {
        this.context = context;
        this.metadataManager = metadataManager;
        this.setupTerminalListener();
    }

    /**
     * Track terminal lifecycle
     */
    private setupTerminalListener(): void {
        this.terminalListener = vscode.window.onDidCloseTerminal(terminal => {
            // Remove from our tracking
            for (const [key, active] of this.activeTerminals) {
                if (active.terminal === terminal) {
                    this.activeTerminals.delete(key);
                    break;
                }
            }
        });
    }

    /**
     * Get the claude command path
     */
    private getClaudeCommand(): string {
        const config = vscode.workspace.getConfiguration('claudeSessions');
        return config.get<string>('claudeCommand') || 'claude';
    }

    /**
     * Check if SpecStory wrapping is enabled
     */
    private useSpecStory(): boolean {
        const config = vscode.workspace.getConfiguration('claudeSessions');
        return config.get<boolean>('useSpecStory') || false;
    }

    /**
     * Get the specstory command path
     */
    private getSpecStoryCommand(): string {
        const config = vscode.workspace.getConfiguration('claudeSessions');
        return config.get<string>('specStoryCommand') || 'specstory';
    }

    /**
     * Build the final command string, optionally wrapped with SpecStory
     */
    private buildCommand(claudeCmd: string, flags: string[]): string {
        const claudeWithFlags = [claudeCmd, ...flags].join(' ');

        if (this.useSpecStory()) {
            const specstoryCmd = this.getSpecStoryCommand();
            // Use -c to pass the full claude command with flags
            return `${specstoryCmd} run -c "${claudeWithFlags}"`;
        }

        return claudeWithFlags;
    }

    /**
     * Get default flags from settings
     */
    private getDefaultFlagsFromSettings(): string[] {
        const config = vscode.workspace.getConfiguration('claudeSessions');
        const flags: string[] = [];

        // Model
        const model = config.get<string>('defaultModel');
        if (model && model !== 'sonnet') {  // sonnet is default, no need to specify
            flags.push('--model', model);
        }

        // Permission mode
        const permissionMode = config.get<string>('defaultPermissionMode');
        if (permissionMode && permissionMode !== 'default') {
            flags.push('--permission-mode', permissionMode);
        }

        // Dangerously skip permissions
        if (config.get<boolean>('dangerouslySkipPermissions')) {
            flags.push('--dangerously-skip-permissions');
        }

        // Append system prompt
        const appendPrompt = config.get<string>('appendSystemPrompt');
        if (appendPrompt && appendPrompt.trim()) {
            flags.push('--append-system-prompt', appendPrompt);
        }

        // Allowed tools
        const allowedTools = config.get<string>('allowedTools');
        if (allowedTools && allowedTools.trim()) {
            flags.push('--allowedTools', allowedTools);
        }

        // Disallowed tools
        const disallowedTools = config.get<string>('disallowedTools');
        if (disallowedTools && disallowedTools.trim()) {
            flags.push('--disallowedTools', disallowedTools);
        }

        // Verbose
        if (config.get<boolean>('verbose')) {
            flags.push('--verbose');
        }

        // Build settings JSON for --settings flag
        const settingsObj: Record<string, unknown> = {};

        // Auto compact (default false in our settings)
        const autoCompact = config.get<boolean>('autoCompact');
        if (autoCompact !== undefined) {
            settingsObj.autoCompact = autoCompact;
        }

        // Always thinking
        const alwaysThinking = config.get<boolean>('alwaysThinking');
        if (alwaysThinking !== undefined) {
            settingsObj.alwaysThinkingEnabled = alwaysThinking;
        }

        // Custom settings - merge with our built settings
        const customSettings = config.get<string>('customSettings');
        if (customSettings && customSettings.trim()) {
            try {
                const custom = JSON.parse(customSettings);
                Object.assign(settingsObj, custom);
            } catch (e) {
                // Invalid JSON, ignore
            }
        }

        // Add --settings flag if we have any settings
        // Note: JSON needs to be single-quoted for shell
        if (Object.keys(settingsObj).length > 0) {
            flags.push('--settings', `'${JSON.stringify(settingsObj)}'`);
        }

        return flags;
    }

    /**
     * Get the default project path for new sessions
     */
    private getDefaultProjectPath(): string {
        const config = vscode.workspace.getConfiguration('claudeSessions');
        const configPath = config.get<string>('defaultProjectPath');

        if (configPath && configPath.trim()) {
            return configPath;
        }

        // Fall back to workspace folder
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        return workspaceFolder?.uri.fsPath || process.env.HOME || '/';
    }

    /**
     * Build flags array from user selections
     */
    buildFlagsArray(flagSelections: Record<string, string | boolean>): string[] {
        const flags: string[] = [];

        for (const [flag, value] of Object.entries(flagSelections)) {
            if (value === true) {
                flags.push(flag);
            } else if (typeof value === 'string' && value.trim()) {
                flags.push(flag, value);
            }
        }

        return flags;
    }

    /**
     * Start a new Claude session
     */
    async startNewSession(flags: string[] = [], projectPath?: string): Promise<string> {
        const cwd = projectPath || this.getDefaultProjectPath();
        const claudeCmd = this.getClaudeCommand();

        // Get default flags from settings and merge with provided flags
        const defaultFlags = this.getDefaultFlagsFromSettings();
        const allFlags = [...defaultFlags, ...flags];

        // Build command (with optional SpecStory wrapping)
        const cmdString = this.buildCommand(claudeCmd, allFlags);

        // Create terminal with a descriptive name
        const terminalName = this.useSpecStory() ? `Claude (SpecStory): New Session` : `Claude: New Session`;
        const terminal = vscode.window.createTerminal({
            name: terminalName,
            cwd: cwd
        });

        terminal.show();
        terminal.sendText(cmdString);

        // We don't know the session ID until it's created
        // Store with a temporary key
        const tempKey = `new-${Date.now()}`;
        this.activeTerminals.set(tempKey, { terminal, sessionId: tempKey });

        return tempKey;
    }

    /**
     * Resume an existing session
     */
    async resumeSession(session: ClaudeSession): Promise<void> {
        const claudeCmd = this.getClaudeCommand();
        const flags = ['--resume', session.id];

        const cwd = session.projectPath || this.getDefaultProjectPath();

        // Get display name
        const displayName = this.metadataManager.getSessionName(session.id) ||
                           `Session ${session.id.slice(0, 8)}`;

        const terminalPrefix = this.useSpecStory() ? 'Claude (SpecStory)' : 'Claude';
        const terminal = vscode.window.createTerminal({
            name: `${terminalPrefix}: ${displayName}`,
            cwd: cwd
        });

        terminal.show();
        terminal.sendText(this.buildCommand(claudeCmd, flags));

        this.activeTerminals.set(session.id, { terminal, sessionId: session.id });
    }

    /**
     * Fork a session
     * Creates a new session that branches from the parent
     * Uses --resume with --fork-session to create a new session ID
     */
    async forkSession(parentSession: ClaudeSession): Promise<string> {
        const claudeCmd = this.getClaudeCommand();

        // Use --resume with --fork-session to create a new branching session
        const flags = ['--resume', parentSession.id, '--fork-session'];

        const cwd = parentSession.projectPath || this.getDefaultProjectPath();

        // Get parent name
        const parentName = this.metadataManager.getSessionName(parentSession.id) ||
                          `Session ${parentSession.id.slice(0, 8)}`;

        const terminalPrefix = this.useSpecStory() ? 'Claude (SpecStory)' : 'Claude';
        const terminal = vscode.window.createTerminal({
            name: `${terminalPrefix}: Fork of ${parentName}`,
            cwd: cwd
        });

        terminal.show();
        terminal.sendText(this.buildCommand(claudeCmd, flags));

        // Store that we forked this session
        // The actual child session ID will be determined when the session starts
        const tempKey = `fork-${parentSession.id}-${Date.now()}`;
        this.activeTerminals.set(tempKey, { terminal, sessionId: tempKey });

        // Note: We'd need to detect the actual new session ID to properly record the fork relationship
        // For now, we'll rely on the user observing the forked session in the list

        vscode.window.showInformationMessage(
            `Forking session "${parentName}". The parent session is now frozen - all new work happens in the fork.`
        );

        return tempKey;
    }

    /**
     * Continue the most recent session
     */
    async continueLastSession(): Promise<void> {
        const claudeCmd = this.getClaudeCommand();
        const cwd = this.getDefaultProjectPath();

        const terminalPrefix = this.useSpecStory() ? 'Claude (SpecStory)' : 'Claude';
        const terminal = vscode.window.createTerminal({
            name: `${terminalPrefix}: Continue`,
            cwd: cwd
        });

        terminal.show();
        terminal.sendText(this.buildCommand(claudeCmd, ['--continue']));
    }

    /**
     * Show flag configuration UI
     * Shows current defaults and allows override for this session
     */
    async showFlagConfiguration(): Promise<string[] | undefined> {
        const config = vscode.workspace.getConfiguration('claudeSessions');
        const currentModel = config.get<string>('defaultModel') || 'sonnet';
        const currentPermMode = config.get<string>('defaultPermissionMode') || 'default';

        // Show current config summary
        const configSummary = `Current: ${currentModel} / ${currentPermMode}`;

        // Quick options for common configurations
        const quickOptions: vscode.QuickPickItem[] = [
            {
                label: '$(play) Start with defaults',
                description: configSummary,
                detail: 'Use settings from Claude Sessions configuration'
            },
            {
                label: '$(rocket) Opus + Bypass Permissions',
                description: '--model opus --dangerously-skip-permissions',
                detail: 'Most capable model with no permission prompts'
            },
            {
                label: '$(beaker) Plan Mode',
                description: '--permission-mode plan',
                detail: 'Research and plan only, no code changes'
            },
            {
                label: '$(edit) Accept Edits Mode',
                description: '--permission-mode acceptEdits',
                detail: 'Auto-accept file edits, ask for other actions'
            },
            {
                label: '$(settings-gear) Custom flags...',
                description: 'Choose from all available flags',
                detail: 'Advanced: select individual flags for this session'
            }
        ];

        const choice = await vscode.window.showQuickPick(quickOptions, {
            placeHolder: 'How do you want to start this session?'
        });

        if (!choice) {
            return undefined;
        }

        // Handle quick options
        if (choice.label.includes('Start with defaults')) {
            return [];  // Empty array means use settings defaults
        }
        if (choice.label.includes('Opus + Bypass')) {
            return ['--model', 'opus', '--dangerously-skip-permissions'];
        }
        if (choice.label.includes('Plan Mode')) {
            return ['--permission-mode', 'plan'];
        }
        if (choice.label.includes('Accept Edits')) {
            return ['--permission-mode', 'acceptEdits'];
        }

        // Custom flags selection
        const items: vscode.QuickPickItem[] = AVAILABLE_FLAGS
            .filter(f => f.flag !== '--continue' && f.flag !== '--resume')  // These are handled separately
            .map(flag => ({
                label: flag.label,
                description: flag.flag,
                detail: `${flag.description}${flag.category ? ` [${flag.category}]` : ''}`,
                picked: false
            }));

        const selected = await vscode.window.showQuickPick(items, {
            canPickMany: true,
            placeHolder: 'Select additional flags for this session'
        });

        if (!selected) {
            return undefined;
        }

        const flags: string[] = [];

        for (const item of selected) {
            const flagDef = AVAILABLE_FLAGS.find(f => f.flag === item.description);
            if (!flagDef) continue;

            if (flagDef.type === 'boolean') {
                flags.push(flagDef.flag);
            } else if (flagDef.type === 'select' && flagDef.options) {
                const choice = await vscode.window.showQuickPick(flagDef.options, {
                    placeHolder: `Select value for ${flagDef.label}`
                });
                if (choice) {
                    flags.push(flagDef.flag, choice);
                }
            } else if (flagDef.type === 'string') {
                const value = await vscode.window.showInputBox({
                    prompt: `Enter value for ${flagDef.label}`,
                    placeHolder: flagDef.description
                });
                if (value) {
                    flags.push(flagDef.flag, value);
                }
            }
        }

        return flags;
    }

    /**
     * Get terminal for a session if it's running
     */
    getTerminalForSession(sessionId: string): vscode.Terminal | undefined {
        return this.activeTerminals.get(sessionId)?.terminal;
    }

    /**
     * Check if a session has an active terminal
     */
    isSessionRunning(sessionId: string): boolean {
        return this.activeTerminals.has(sessionId);
    }

    /**
     * Focus terminal for a session
     */
    focusSession(sessionId: string): boolean {
        const active = this.activeTerminals.get(sessionId);
        if (active) {
            active.terminal.show();
            return true;
        }
        return false;
    }

    dispose(): void {
        this.terminalListener?.dispose();
    }
}
