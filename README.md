# Claude Session Manager

A VS Code/Cursor extension for managing multiple Claude Code CLI sessions.

**Repo:** https://github.com/sethlazar/claude-session-manager

## Features

- **Session List in Explorer**: Sessions appear in the Explorer sidebar (not a separate icon)
- **Folder Grouping**: Sessions organized by project/task type (JHU-hiring, corpus-search, Meta, etc.)
- **Multi-select & Drag-drop**: Select multiple sessions, drag to reorganize into folders
- **Archive/Unarchive**: Hide old sessions, restore when needed
- **Search Bar**: Live search across all session transcripts with highlighted results
- **SpecStory Integration**: Wrap sessions for cross-machine sync and searchable Markdown transcripts
- **Terminal Integration**: Open sessions as terminal tabs with full terminal functionality
- **Quick Launch Presets**: Start with defaults, Opus+Bypass, Plan Mode, etc.
- **Configurable Defaults**: Model, permission mode, autoCompact, thinking mode, and more

## Installation

### From GitHub Release

```bash
# Download latest release
curl -LO https://github.com/sethlazar/claude-session-manager/releases/download/v0.6.0/claude-session-manager-0.6.0.vsix

# For Cursor
cursor --install-extension claude-session-manager-0.6.0.vsix

# For VS Code
code --install-extension claude-session-manager-0.6.0.vsix
```

### After Installation

1. Restart Cursor/VS Code
2. Open the Explorer sidebar - you'll see "Claude Sessions" and "Claude Search" panels
3. Click + to start a new session

## Usage

### Session List

Sessions are grouped into collapsible folders by task type:
- Folders with active sessions appear first
- Color-coded icons by category (blue for research, yellow for tools, magenta for meta)
- Drag sessions between folders to reorganize
- Multi-select with Cmd/Ctrl+click for bulk operations

### Starting a New Session

Click **+** or press **Cmd+Shift+C**. Choose from:
- **Start with defaults** - Uses your configured settings
- **Opus + Bypass Permissions** - Most capable, no prompts
- **Plan Mode** - Research only, no code changes
- **Accept Edits Mode** - Auto-accept edits
- **Custom flags...** - Pick individual options

### Search

The search panel has a live search bar:
- Type to search (debounced)
- Results show session name, speaker, timestamp, and context
- Click to open the session
- Minimum 2 characters to trigger

### Archive

Right-click sessions to archive. Archived sessions appear in a collapsible "Archived" folder at the bottom. Right-click to restore.

### SpecStory Integration

For cross-machine session sync:

1. Install SpecStory: `npm install -g specstory`
2. Enable in settings: `claudeSessions.useSpecStory = true`
3. Optionally login: `specstory login` for cloud sync

Sessions will be wrapped with `specstory run -c "claude ..."` and saved to `.specstory/history/` as Markdown.

## Settings

Search "claudeSessions" in VS Code settings:

| Setting | Description | Default |
|---------|-------------|---------|
| `defaultModel` | sonnet / opus / haiku | `sonnet` |
| `defaultPermissionMode` | default / acceptEdits / plan / bypassPermissions / delegate / dontAsk | `default` |
| `dangerouslySkipPermissions` | Bypass ALL permission checks | `false` |
| `useSpecStory` | Wrap with SpecStory for sync | `false` |
| `specStoryCommand` | Path to specstory CLI | `specstory` |
| `autoCompact` | Auto context compaction | `false` |
| `alwaysThinking` | Extended thinking mode | `true` |
| `appendSystemPrompt` | Add to system prompt | `""` |
| `allowedTools` / `disallowedTools` | Tool restrictions | `""` |
| `verbose` | Debug output | `false` |
| `defaultProjectPath` | Default folder for new sessions | workspace root |
| `claudeCommand` | Path to claude CLI | `claude` |
| `showHistoricalSessions` | Show old sessions | `true` |
| `maxSessionsToShow` | Max sessions in list | `50` |

## How It Works

The extension reads Claude's session data from:
```
~/.claude/projects/[encoded-project-path]/[session-uuid].jsonl
```

Extension metadata (custom names, folders, archive status) stored in VS Code's global state.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+Shift+C | New Claude Session |

## Architecture

```
src/
├── extension.ts       # Main entry point, command registration
├── historyParser.ts   # Parses Claude's session files
├── metadataManager.ts # Stores custom names, folders, archive status
├── sessionManager.ts  # Spawns terminals, builds commands, SpecStory wrapping
├── sessionProvider.ts # TreeDataProvider with drag-drop support
├── searchProvider.ts  # WebviewView with search bar
└── types.ts           # TypeScript interfaces, flag definitions
```

## Development

```bash
npm install
npm run compile
npm run watch    # Dev mode
npm run package  # Creates .vsix
```

## Version History

- **v0.6.0** - SpecStory integration for cross-machine sync
- **v0.5.0** - Multi-select, drag-drop folders, merged Global/Self-improvement into Meta
- **v0.4.0** - Model picker, permission modes, autoCompact, settings JSON
- **v0.3.0** - WebviewView search bar with live search
- **v0.2.0** - Folder grouping, archive feature, Explorer sidebar integration
- **v0.1.0** - Initial release

## License

MIT

---

Built for MINT Lab
