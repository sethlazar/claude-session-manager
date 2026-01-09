# Claude Session Manager

A VS Code/Cursor extension for managing multiple Claude Code CLI sessions.

## Features

- **Session List Sidebar**: View all your Claude sessions in a dedicated sidebar
- **Auto-naming**: Sessions are automatically named based on their AI-generated summary or first meaningful user message
- **Terminal Integration**: Open sessions as terminal tabs with full terminal functionality
- **Search Transcripts**: Full-text search across all session transcripts
- **Fork Sessions**: Create new sessions that branch from existing ones
- **Rename Sessions**: Give sessions custom names for easier identification
- **Flag Configuration**: Dropdown UI for common Claude CLI flags (--dangerously-skip-permissions, --model, etc.)
- **Keyboard Shortcuts**: Cmd+Shift+C to start a new session

## Installation

### From VSIX (current method)

```bash
# For Cursor
cursor --install-extension claude-session-manager-0.1.0.vsix

# For VS Code
code --install-extension claude-session-manager-0.1.0.vsix
```

The VSIX file is located at:
`/Volumes/Agents/Active-Research/MINT-Projects/Side-Projects/claude-session-manager/claude-session-manager-0.1.0.vsix`

### After Installation

1. Restart Cursor/VS Code
2. Look for the Claude icon in the activity bar (left sidebar)
3. Click it to see your sessions

## Usage

### Viewing Sessions

The sidebar shows all your Claude sessions, sorted by last activity:
- **Green terminal icon**: Currently active session (modified in last 5 minutes)
- **Branch icon**: Forked session
- **Comment icon**: Historical session

Each session shows:
- Display name (custom, AI-generated summary, or first message)
- Time since last activity
- Hover for details (project path, message count, etc.)

### Starting a New Session

1. Click the **+** button in the sidebar title, OR
2. Press **Cmd+Shift+C**, OR
3. Use Command Palette: "New Claude Session"

You'll see a dropdown to select CLI flags:
- Skip Permissions (--dangerously-skip-permissions)
- Permission Mode (default, acceptEdits, bypassPermissions, dontAsk)
- Model selection
- Verbose mode
- And more...

### Opening an Existing Session

Click any session in the list to resume it in a terminal tab.

### Forking a Session

Right-click a session and select "Fork Session" (or use the branch icon).

This creates a new session that starts from where the parent left off. The parent session becomes "frozen" - all new work happens in the fork.

Use cases:
- Try different approaches from the same starting point
- Branch off to explore alternatives

### Renaming a Session

Right-click a session and select "Rename Session" to give it a custom name.

### Searching Transcripts

1. Use the Search panel in the sidebar
2. Type your query
3. Results show matching messages with context

## Settings

Configure in VS Code Settings (search for "Claude Sessions"):

| Setting | Description | Default |
|---------|-------------|---------|
| `claudeSessions.defaultProjectPath` | Default folder for new sessions | Workspace root |
| `claudeSessions.claudeCommand` | Path to claude CLI | `claude` |
| `claudeSessions.showHistoricalSessions` | Show old sessions in list | `true` |
| `claudeSessions.maxSessionsToShow` | Maximum sessions to display | `50` |
| `claudeSessions.defaultFlags` | Flags to always include | `[]` |

## How It Works

The extension reads Claude's session data from:
```
~/.claude/projects/[encoded-project-path]/[session-uuid].jsonl
```

Each session file contains:
- AI-generated summary (if available)
- Full conversation history
- Timestamps and metadata

Sessions are displayed with their summary or first meaningful user message as the display name.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+Shift+C | New Claude Session |

## Architecture

```
src/
├── extension.ts      # Main entry point, command registration
├── historyParser.ts  # Parses Claude's session files
├── metadataManager.ts # Stores custom names, fork relations
├── sessionManager.ts # Spawns terminals, handles forking
├── sessionProvider.ts # TreeDataProvider for sidebar
├── searchProvider.ts # Transcript search functionality
└── types.ts          # TypeScript interfaces
```

## Known Limitations

- Session "active" status is heuristic (based on file modification time)
- Fork relationships are stored in extension metadata (not in Claude's data)
- Search is case-insensitive substring match (not fuzzy)

## Future Enhancements

- [ ] Session grouping by project
- [ ] Export session transcripts
- [ ] Session statistics/analytics
- [ ] Integration with Claude's teleport feature
- [ ] Session tagging/labeling

## Development

```bash
# Install dependencies
npm install

# Compile
npm run compile

# Watch mode
npm run watch

# Package
npm run package
# or
vsce package --allow-missing-repository
```

## License

MIT

---

Built for MINT Lab by TerMinty-464c
