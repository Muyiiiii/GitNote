# GitNote Quick

A lightweight Electron desktop app for managing text snippets with zero-cost sync via a private GitHub repository.

## Release

Current version: **v1.0.0**

- Latest: [https://github.com/Muyiiiii/GitNote/releases/tag/v1](https://github.com/Muyiiiii/GitNote/releases/tag/v1)

## Features

### Snippet Management

- Global toggle shortcut: `Ctrl+Shift+V` (Windows/Linux) / `Cmd+Shift+V` (macOS)
- Frameless floating window, always on top, hidden from taskbar
- Auto-hide on blur or when the toggle shortcut is pressed again
- Press `Enter` or click a snippet to copy and hide
- `Ctrl+N` — create new snippet
- `Ctrl+E` — edit selected snippet
- Real-time search/filter across all snippets
- System tray icon with menu for quick access

### GitHub Sync

- On startup: `git pull --rebase` (silent)
- After any data change: debounce 5 s → `git add .` → `git commit -m "update"` → `git push`
- Push failure dialog: force overwrite (`--force-with-lease`) or manual resolve

### Data Protection

- **Encrypted mode** (default): snippets stored with AES-256-GCM encryption; vault key derived via PBKDF2-SHA256 (210,000 rounds)
- **Plaintext mode**: optional, useful for human-readable sync history in the repo
- PAT stored via Electron `safeStorage` (OS credential store)
- Vault unlock prompt on each session

### Storage & Settings

- Customizable storage directory (defaults to Electron `userData` path)
- Data file: `storage/data.json` inside the local repo clone
- Window position and size remembered across sessions
- Built-in log viewer (`Settings → View Logs`)

## Requirements

- [Node.js](https://nodejs.org/) ≥ 18
- [Git](https://git-scm.com/) installed and available in `PATH`

## Setup (Development)

1. Install dependencies:

```bash
npm install
```

2. Start the app:

```bash
npm start
```

3. On first launch, complete the setup form:
   - **Repo URL** — e.g. `https://github.com/<your-name>/<your-private-repo>.git`
   - **Branch** — e.g. `main`
   - **PAT** — GitHub Personal Access Token with `repo` read/write scope

## Build

```bash
npm run build:win   # Windows — produces NSIS installer in dist/
npm run build:mac   # macOS  — produces DMG in dist/
npm run build       # current platform
```

## GitHub Private Repo Preparation

1. Create a **private** GitHub repository.
2. `storage/data.json` is created automatically on first sync; you may also add it manually.
3. Generate a fine-grained token or classic PAT with repository read/write access.
4. Keep the token secret — the app encrypts it via Electron `safeStorage`.

## Project Structure

```
src/
├── main.js       # global shortcut, window, tray, IPC handlers, Git sync, vault/encryption
├── renderer.js   # UI rendering, filtering, list interactions
├── preload.js    # secure IPC bridge (contextBridge)
├── index.html    # app shell: setup, main list, editor, settings, logs, vault panels
└── styles.css    # Raycast/Spotlight-inspired theme
```

## License

MIT
