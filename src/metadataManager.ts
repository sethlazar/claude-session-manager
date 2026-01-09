/**
 * Manage extension-specific metadata (custom names, fork relations, etc.)
 * Stored in VS Code's global state
 */

import * as vscode from 'vscode';
import { SessionMetadata } from './types';

export class MetadataManager {
    private context: vscode.ExtensionContext;
    private readonly METADATA_KEY = 'claudeSessions.metadata';

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * Get all metadata
     */
    getMetadata(): SessionMetadata {
        const stored = this.context.globalState.get<SessionMetadata>(this.METADATA_KEY);
        return stored || {
            customNames: {},
            autoNames: {},
            summaries: {},
            forkRelations: {},
            archived: {},
            customFolders: {}
        };
    }

    /**
     * Save metadata
     */
    private async saveMetadata(metadata: SessionMetadata): Promise<void> {
        await this.context.globalState.update(this.METADATA_KEY, metadata);
    }

    /**
     * Get custom name for a session (or auto-generated name, or null)
     */
    getSessionName(sessionId: string): string | null {
        const metadata = this.getMetadata();
        return metadata.customNames[sessionId] ||
               metadata.autoNames[sessionId] ||
               null;
    }

    /**
     * Set custom name for a session
     */
    async setCustomName(sessionId: string, name: string): Promise<void> {
        const metadata = this.getMetadata();
        metadata.customNames[sessionId] = name;
        await this.saveMetadata(metadata);
    }

    /**
     * Set auto-generated name for a session
     */
    async setAutoName(sessionId: string, name: string): Promise<void> {
        const metadata = this.getMetadata();
        metadata.autoNames[sessionId] = name;
        await this.saveMetadata(metadata);
    }

    /**
     * Set summary for a session
     */
    async setSummary(sessionId: string, summary: string): Promise<void> {
        const metadata = this.getMetadata();
        metadata.summaries[sessionId] = summary;
        await this.saveMetadata(metadata);
    }

    /**
     * Get summary for a session
     */
    getSummary(sessionId: string): string | null {
        const metadata = this.getMetadata();
        return metadata.summaries[sessionId] || null;
    }

    /**
     * Record a fork relationship
     */
    async recordFork(childSessionId: string, parentSessionId: string): Promise<void> {
        const metadata = this.getMetadata();
        metadata.forkRelations[childSessionId] = parentSessionId;
        await this.saveMetadata(metadata);
    }

    /**
     * Get parent session ID for a forked session
     */
    getParentSession(sessionId: string): string | null {
        const metadata = this.getMetadata();
        return metadata.forkRelations[sessionId] || null;
    }

    /**
     * Get all children of a session
     */
    getChildSessions(parentSessionId: string): string[] {
        const metadata = this.getMetadata();
        return Object.entries(metadata.forkRelations)
            .filter(([_, parent]) => parent === parentSessionId)
            .map(([child, _]) => child);
    }

    /**
     * Check if a session has been forked
     */
    hasBeenForked(sessionId: string): boolean {
        return this.getChildSessions(sessionId).length > 0;
    }

    /**
     * Remove metadata for a session (cleanup)
     */
    async removeSession(sessionId: string): Promise<void> {
        const metadata = this.getMetadata();
        delete metadata.customNames[sessionId];
        delete metadata.autoNames[sessionId];
        delete metadata.summaries[sessionId];
        delete metadata.forkRelations[sessionId];
        delete metadata.archived[sessionId];
        await this.saveMetadata(metadata);
    }

    /**
     * Archive a session (hide from list)
     */
    async archiveSession(sessionId: string): Promise<void> {
        const metadata = this.getMetadata();
        if (!metadata.archived) {
            metadata.archived = {};
        }
        metadata.archived[sessionId] = true;
        await this.saveMetadata(metadata);
    }

    /**
     * Unarchive a session
     */
    async unarchiveSession(sessionId: string): Promise<void> {
        const metadata = this.getMetadata();
        if (metadata.archived) {
            delete metadata.archived[sessionId];
            await this.saveMetadata(metadata);
        }
    }

    /**
     * Check if a session is archived
     */
    isArchived(sessionId: string): boolean {
        const metadata = this.getMetadata();
        return metadata.archived?.[sessionId] ?? false;
    }

    /**
     * Get all archived session IDs
     */
    getArchivedSessions(): string[] {
        const metadata = this.getMetadata();
        if (!metadata.archived) return [];
        return Object.keys(metadata.archived).filter(id => metadata.archived[id]);
    }

    /**
     * Set custom folder for a session (overrides auto-detected folder)
     */
    async setCustomFolder(sessionId: string, folderName: string): Promise<void> {
        const metadata = this.getMetadata();
        if (!metadata.customFolders) {
            metadata.customFolders = {};
        }
        metadata.customFolders[sessionId] = folderName;
        await this.saveMetadata(metadata);
    }

    /**
     * Get custom folder for a session
     */
    getCustomFolder(sessionId: string): string | null {
        const metadata = this.getMetadata();
        return metadata.customFolders?.[sessionId] || null;
    }

    /**
     * Remove custom folder (revert to auto-detected)
     */
    async removeCustomFolder(sessionId: string): Promise<void> {
        const metadata = this.getMetadata();
        if (metadata.customFolders) {
            delete metadata.customFolders[sessionId];
            await this.saveMetadata(metadata);
        }
    }
}
