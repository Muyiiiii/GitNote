# GitNote Quick

A lightweight Electron desktop app for text snippets with zero-cost sync via a GitHub repo.

## Features

- Global toggle shortcut: `CommandOrControl+Shift+V`
- Frameless floating window, always on top, hidden from taskbar
- Auto-hide when blur or shortcut pressed again
- Press Enter or click item to copy and hide
- `Ctrl+N` create snippet, `Ctrl+E` edit selected snippet
- Data file path: `storage/data.json` in local repo clone
- Sync strategy:
  - startup: `git pull --rebase` (silent)
  - after data change: debounce 5s then `git add .` -> `git commit -m "update"` -> `git push`
  - push failure: prompt for force overwrite (`--force-with-lease`) or manual resolve

## Setup

1. Install dependencies:

```bash
npm install
```

2. Run app:

```bash
npm start
```

3. On first launch, fill config form:
- `Repo URL`: e.g. `https://github.com/<your-name>/<your-private-repo>.git`
- `Branch`: e.g. `main`
- `PAT`: GitHub Personal Access Token with access to your private repo

## GitHub Private Repo Preparation

1. Create a private GitHub repository.
2. Add a `storage/data.json` file in the repo root (optional, app will auto-create).
3. Create a fine-grained token or classic PAT with repository read/write access.
4. Keep your token private; app stores PAT encrypted using Electron `safeStorage`.

## Project Structure

- `src/main.js`: global shortcut, window control, IPC handlers, Git sync engine
- `src/renderer.js`: UI rendering, filtering, list interactions
- `src/preload.js`: secure bridge between renderer and main process
- `src/index.html` + `src/styles.css`: Raycast/Spotlight-like UI shell

## Notes

- Git must be installed and available in PATH.
- Local repo clone location: Electron userData path under `repo`.