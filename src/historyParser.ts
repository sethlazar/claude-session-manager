/**
 * Parse Claude's session files to extract session information
 *
 * Claude stores sessions in:
 * ~/.claude/projects/[encoded-project-path]/[session-uuid].jsonl
 *
 * Where encoded-project-path replaces / with - (e.g., /Users/seth becomes -Users-seth)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ClaudeSession, ClaudeMessage } from './types';

interface SessionEntry {
    type: 'summary' | 'user' | 'assistant' | 'file-history-snapshot' | 'queue-operation';
    sessionId?: string;
    summary?: string;
    timestamp?: string;
    cwd?: string;
    message?: {
        role: string;
        content: string | ContentBlock[];
    };
    uuid?: string;
    parentUuid?: string;
    isSidechain?: boolean;
}

interface ContentBlock {
    type: string;
    text?: string;
    name?: string;
    input?: Record<string, unknown>;
}

export class HistoryParser {
    private claudePath: string;
    private projectsPath: string;

    constructor() {
        this.claudePath = path.join(os.homedir(), '.claude');
        this.projectsPath = path.join(this.claudePath, 'projects');
    }

    /**
     * Get all sessions from all project directories
     */
    async getSessions(maxSessions: number = 50): Promise<ClaudeSession[]> {
        const sessions: ClaudeSession[] = [];

        if (!fs.existsSync(this.projectsPath)) {
            return sessions;
        }

        // Get all project directories
        const projectDirs = fs.readdirSync(this.projectsPath, { withFileTypes: true })
            .filter(d => d.isDirectory() && !d.name.startsWith('.'));

        for (const projectDir of projectDirs) {
            const projectPath = path.join(this.projectsPath, projectDir.name);
            const decodedProjectPath = this.decodeProjectPath(projectDir.name);

            // Get all session files in this project
            // Filter out agent-* files (subagent/warmup sessions)
            const sessionFiles = fs.readdirSync(projectPath)
                .filter(f => f.endsWith('.jsonl') && !f.startsWith('.') && !f.startsWith('agent-'));

            for (const sessionFile of sessionFiles) {
                const sessionId = sessionFile.replace('.jsonl', '');
                const sessionFilePath = path.join(projectPath, sessionFile);

                try {
                    const session = await this.parseSessionFile(sessionFilePath, sessionId, decodedProjectPath);
                    if (session) {
                        sessions.push(session);
                    }
                } catch {
                    // Skip corrupt session files
                    continue;
                }
            }
        }

        // Sort by last activity and limit
        return sessions
            .sort((a, b) => b.lastActivityTime.getTime() - a.lastActivityTime.getTime())
            .slice(0, maxSessions);
    }

    /**
     * Decode a project path from the encoded format
     * e.g., -Volumes-Agents-Active-Research-MINT-Projects becomes /Volumes/Agents/Active-Research/MINT-Projects
     *
     * The challenge: dashes in the encoded string could be:
     * 1. Path separators (originally /)
     * 2. Actual dashes in directory names (like Active-Research)
     *
     * We solve this by trying different interpretations and validating against the filesystem.
     */
    private decodeProjectPath(encoded: string): string {
        // Remove leading dash
        const withoutLeading = encoded.replace(/^-/, '');
        const parts = withoutLeading.split('-');

        // Try to find a valid path by testing different combinations
        const decoded = this.findValidPath(parts, 0, '/');
        return decoded || '/' + parts.join('/'); // Fallback to simple decode
    }

    /**
     * Recursively try different path interpretations to find one that exists
     */
    private findValidPath(parts: string[], index: number, currentPath: string): string | null {
        if (index >= parts.length) {
            // We've used all parts, check if path exists
            if (fs.existsSync(currentPath)) {
                return currentPath;
            }
            return null;
        }

        // Try adding next part as a new path component
        const asNewComponent = path.join(currentPath, parts[index]);
        const resultNew = this.findValidPath(parts, index + 1, asNewComponent);
        if (resultNew) {
            return resultNew;
        }

        // Try joining with previous component using a dash (for names like "Active-Research")
        if (currentPath !== '/') {
            const parentDir = path.dirname(currentPath);
            const currentName = path.basename(currentPath);
            const joinedName = currentName + '-' + parts[index];
            const asJoined = path.join(parentDir, joinedName);
            const resultJoined = this.findValidPath(parts, index + 1, asJoined);
            if (resultJoined) {
                return resultJoined;
            }
        }

        return null;
    }

    /**
     * Encode a project path to the storage format
     */
    private encodeProjectPath(projectPath: string): string {
        return projectPath.replace(/\//g, '-');
    }

    /**
     * Parse a single session file
     */
    private async parseSessionFile(filePath: string, sessionId: string, projectPath: string): Promise<ClaudeSession | null> {
        const stats = fs.statSync(filePath);

        // Skip empty files
        if (stats.size === 0) {
            return null;
        }

        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.trim().split('\n').filter(line => line.trim());

        if (lines.length === 0) {
            return null;
        }

        let summary: string | undefined;
        let messageCount = 0;
        let firstTimestamp: Date | undefined;
        let lastTimestamp: Date | undefined;
        let cwd: string | undefined;
        let firstUserMessage: string | undefined;
        let hasRealContent = false;
        let isSidechain = false;

        for (const line of lines) {
            try {
                const entry: SessionEntry = JSON.parse(line);

                // Check if this is a sidechain (subagent) session
                if (entry.isSidechain) {
                    isSidechain = true;
                }

                // Get summary if available
                if (entry.type === 'summary' && entry.summary) {
                    summary = entry.summary;
                }

                // Track timestamps
                if (entry.timestamp) {
                    const ts = new Date(entry.timestamp);
                    if (!firstTimestamp || ts < firstTimestamp) {
                        firstTimestamp = ts;
                    }
                    if (!lastTimestamp || ts > lastTimestamp) {
                        lastTimestamp = ts;
                    }
                }

                // Count messages and check content
                if (entry.type === 'user' || entry.type === 'assistant') {
                    messageCount++;

                    // Get first user message to check for warmup
                    if (entry.type === 'user' && !firstUserMessage && entry.message) {
                        const msgContent = typeof entry.message.content === 'string'
                            ? entry.message.content
                            : Array.isArray(entry.message.content)
                                ? entry.message.content.map((b: ContentBlock) => b.text || '').join('')
                                : '';
                        firstUserMessage = msgContent.trim();
                    }

                    // Mark as having real content if we have assistant messages
                    if (entry.type === 'assistant') {
                        hasRealContent = true;
                    }
                }

                // Get working directory
                if (entry.cwd && !cwd) {
                    cwd = entry.cwd;
                }
            } catch {
                continue;
            }
        }

        // Skip warmup sessions (first user message is exactly "Warmup")
        if (firstUserMessage === 'Warmup') {
            return null;
        }

        // Skip sidechain sessions (subagent work)
        if (isSidechain) {
            return null;
        }

        // Skip sessions with no real content (just summaries or no assistant responses)
        if (!hasRealContent && messageCount < 2) {
            return null;
        }

        return {
            id: sessionId,
            projectPath: cwd || projectPath,
            startTime: firstTimestamp || stats.birthtime,
            lastActivityTime: lastTimestamp || stats.mtime,
            messageCount,
            isActive: false,
            autoGeneratedName: summary
        };
    }

    /**
     * Get messages for a specific session
     */
    async getSessionMessages(sessionId: string): Promise<ClaudeMessage[]> {
        const messages: ClaudeMessage[] = [];

        // Find the session file
        const sessionFile = await this.findSessionFile(sessionId);
        if (!sessionFile) {
            return messages;
        }

        const content = fs.readFileSync(sessionFile, 'utf-8');
        const lines = content.trim().split('\n').filter(line => line.trim());

        for (const line of lines) {
            try {
                const entry: SessionEntry = JSON.parse(line);

                if ((entry.type === 'user' || entry.type === 'assistant') && entry.message) {
                    messages.push(this.parseMessage(sessionId, entry));
                }
            } catch {
                continue;
            }
        }

        return messages;
    }

    /**
     * Find the session file for a given session ID
     */
    private async findSessionFile(sessionId: string): Promise<string | null> {
        if (!fs.existsSync(this.projectsPath)) {
            return null;
        }

        const projectDirs = fs.readdirSync(this.projectsPath, { withFileTypes: true })
            .filter(d => d.isDirectory() && !d.name.startsWith('.'));

        for (const projectDir of projectDirs) {
            const sessionFile = path.join(this.projectsPath, projectDir.name, `${sessionId}.jsonl`);
            if (fs.existsSync(sessionFile)) {
                return sessionFile;
            }
        }

        return null;
    }

    /**
     * Parse a single message entry
     */
    private parseMessage(sessionId: string, entry: SessionEntry): ClaudeMessage {
        let content = '';
        let toolUse: { name: string; input: Record<string, unknown> }[] = [];

        if (entry.message) {
            if (typeof entry.message.content === 'string') {
                content = entry.message.content;
            } else if (Array.isArray(entry.message.content)) {
                for (const block of entry.message.content as ContentBlock[]) {
                    if (block.type === 'text' && block.text) {
                        content += block.text;
                    } else if (block.type === 'tool_use' && block.name) {
                        toolUse.push({
                            name: block.name,
                            input: block.input || {}
                        });
                    }
                }
            }
        }

        return {
            sessionId,
            role: (entry.message?.role as 'user' | 'assistant') || 'user',
            content,
            timestamp: entry.timestamp ? new Date(entry.timestamp) : new Date(),
            toolUse: toolUse.length > 0 ? toolUse : undefined
        };
    }

    /**
     * Search all session transcripts for a query
     */
    async searchTranscripts(query: string, maxResults: number = 100): Promise<{ session: ClaudeSession; message: ClaudeMessage; matchContext: string }[]> {
        const results: { session: ClaudeSession; message: ClaudeMessage; matchContext: string }[] = [];
        const queryLower = query.toLowerCase();
        const sessions = await this.getSessions(200);

        for (const session of sessions) {
            const messages = await this.getSessionMessages(session.id);

            for (const message of messages) {
                if (message.content.toLowerCase().includes(queryLower)) {
                    // Extract context around match
                    const idx = message.content.toLowerCase().indexOf(queryLower);
                    const start = Math.max(0, idx - 50);
                    const end = Math.min(message.content.length, idx + query.length + 50);
                    const matchContext = (start > 0 ? '...' : '') +
                        message.content.slice(start, end) +
                        (end < message.content.length ? '...' : '');

                    results.push({
                        session,
                        message,
                        matchContext
                    });

                    if (results.length >= maxResults) {
                        return results;
                    }
                }
            }
        }

        return results;
    }

    /**
     * Generate a default name for a session: task-focus + date/time
     * Format: "project-name • Jan 9, 14:30"
     *
     * Task focus is derived from the summary or first task allocation:
     * - Specific project (corpus-search, JHU-hiring, blame-theo, etc.)
     * - "Global" for cross-project management
     * - "Self-improvement" for agent/metacognition work
     * - Falls back to "Session" if unclear
     */
    generateDefaultName(session: ClaudeSession): string {
        // Try to extract task focus from summary
        let taskFocus = this.extractTaskFocus(session.autoGeneratedName);

        // If no clear task focus from summary, try the session ID pattern
        // (Some session IDs contain date info like 20260109-000517-464c)
        if (taskFocus === 'Session' && session.id.match(/^\d{8}-\d{6}-[a-f0-9]+$/)) {
            taskFocus = 'Minty';  // TerMinty session
        }

        // Format date/time
        const date = session.startTime;
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                           'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const month = monthNames[date.getMonth()];
        const day = date.getDate();
        const hours = date.getHours().toString().padStart(2, '0');
        const mins = date.getMinutes().toString().padStart(2, '0');

        return `${taskFocus} • ${month} ${day}, ${hours}:${mins}`;
    }

    /**
     * Extract task focus from session summary
     */
    private extractTaskFocus(summary: string | undefined): string {
        if (!summary) return 'Session';

        const summaryLower = summary.toLowerCase();

        // Check for self-improvement keywords
        const selfImprovementKeywords = [
            'self-improvement', 'metacognition', 'agent capabilities',
            'skill', 'learning', 'claude.md', 'workflow'
        ];
        for (const kw of selfImprovementKeywords) {
            if (summaryLower.includes(kw)) return 'Self-improvement';
        }

        // Check for global/management keywords
        const globalKeywords = [
            'cross-project', 'management', 'organization', 'cleanup',
            'session', 'infrastructure', 'backlog'
        ];
        for (const kw of globalKeywords) {
            if (summaryLower.includes(kw)) return 'Global';
        }

        // Known projects (can be extended)
        const knownProjects: Record<string, string> = {
            'corpus-search': 'corpus-search',
            'corpus search': 'corpus-search',
            'jhu': 'JHU-hiring',
            'hiring': 'JHU-hiring',
            'thompson': 'JHU-hiring',
            'blame': 'blame-theo',
            'kira': 'agent-kira',
            'privacy': 'agent-kira',
            'claims': 'claims-secil',
            'compliant': 'compliant-cameron',
            'deceptive': 'deceptive-iman',
            'egonormous': 'egonormous-sichao',
            'morebench': 'even-more-bench-CY',
            'iaseai': 'IASEAI',
            'workshop': 'IASEAI',
            'notion': 'notion-automation',
            'drone': 'drone-import',
            'dji': 'drone-import',
            'flight log': 'drone-import',
            'email': 'email-archive',
            'gmail': 'email-archive',
            'slack': 'slack-integration',
            'news': 'news-summary',
            'session manager': 'claude-session-manager',
            'extension': 'claude-session-manager',
            'vscode': 'claude-session-manager',
            'cursor': 'claude-session-manager',
            'slash command': 'Global',
            'frontmatter': 'Global',
        };

        for (const [keyword, project] of Object.entries(knownProjects)) {
            if (summaryLower.includes(keyword)) {
                return project;
            }
        }

        // Try to extract first noun phrase as project name (first 2-3 words before colon or common verbs)
        const colonMatch = summary.match(/^([^:]+):/);
        if (colonMatch) {
            const beforeColon = colonMatch[1].trim();
            if (beforeColon.length <= 30 && beforeColon.length >= 3) {
                return beforeColon;
            }
        }

        return 'Session';
    }

    /**
     * Get Claude's summary for a session (for tooltip/description)
     */
    async getSessionSummary(sessionId: string): Promise<string | null> {
        const sessionFile = await this.findSessionFile(sessionId);
        if (sessionFile) {
            const content = fs.readFileSync(sessionFile, 'utf-8');
            const lines = content.trim().split('\n').filter(line => line.trim());

            for (const line of lines) {
                try {
                    const entry: SessionEntry = JSON.parse(line);
                    if (entry.type === 'summary' && entry.summary) {
                        return entry.summary;
                    }
                } catch {
                    continue;
                }
            }
        }
        return null;
    }

    /**
     * Generate a name for a session based on its summary or first user message
     * (Legacy method - kept for compatibility)
     */
    async generateSessionName(sessionId: string): Promise<string> {
        // First try to get the summary from the session file
        const summary = await this.getSessionSummary(sessionId);
        if (summary) {
            return summary;
        }

        // Fall back to first meaningful user message
        const messages = await this.getSessionMessages(sessionId);

        for (const message of messages) {
            if (message.role !== 'user') continue;

            let name = message.content.trim();
            // Remove command tags
            name = name.replace(/<[^>]+>[^<]*<\/[^>]+>/g, '').trim();
            name = name.replace(/<[^>]+>/g, '').trim();

            // Skip if it's just a slash command
            if (name.startsWith('/') && !name.includes(' ')) {
                continue;
            }

            // Skip if empty after cleaning
            if (!name || name.length < 3) {
                continue;
            }

            if (name.length > 60) {
                name = name.slice(0, 57) + '...';
            }
            return name;
        }

        return `Session ${sessionId.slice(0, 8)}`;
    }

    /**
     * Check if a session is currently running (has active terminal)
     * This is a heuristic - checks if session file was modified recently
     */
    isSessionActive(session: ClaudeSession): boolean {
        const age = Date.now() - session.lastActivityTime.getTime();
        // Consider active if modified in last 5 minutes
        return age < 5 * 60 * 1000;
    }

    /**
     * Get sessions for a specific project path
     */
    async getSessionsForProject(projectPath: string): Promise<ClaudeSession[]> {
        const encoded = this.encodeProjectPath(projectPath);
        const projectDir = path.join(this.projectsPath, encoded);

        if (!fs.existsSync(projectDir)) {
            return [];
        }

        const sessions: ClaudeSession[] = [];
        const sessionFiles = fs.readdirSync(projectDir)
            .filter(f => f.endsWith('.jsonl') && !f.startsWith('.'));

        for (const sessionFile of sessionFiles) {
            const sessionId = sessionFile.replace('.jsonl', '');
            const sessionFilePath = path.join(projectDir, sessionFile);

            try {
                const session = await this.parseSessionFile(sessionFilePath, sessionId, projectPath);
                if (session) {
                    sessions.push(session);
                }
            } catch {
                continue;
            }
        }

        return sessions.sort((a, b) => b.lastActivityTime.getTime() - a.lastActivityTime.getTime());
    }
}
