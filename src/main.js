const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  clipboard,
  dialog,
  safeStorage,
  shell,
  Tray,
  Menu,
  nativeImage
} = require('electron');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const Store = require('electron-store');
const { simpleGit } = require('simple-git');

const TOGGLE_SHORTCUT = 'CommandOrControl+Shift+V';
const SYNC_DEBOUNCE_MS = 5000;
const MAX_LOG_LINES = 1000;
const VAULT_PBKDF2_ROUNDS = 210000;
const VAULT_KEY_BYTES = 32;
const VAULT_ALGO = 'aes-256-gcm';
const VAULT_VERSION = 1;
const VAULT_VERIFIER_PLAINTEXT = 'vault-ok';
const DATA_MODE_ENCRYPTED = 'encrypted';
const DATA_MODE_PLAINTEXT = 'plaintext';

let mainWindow = null;
let syncTimer = null;
let tray = null;
let logFilePath = '';
let appIcon = null;
let forceOpenSettingsOnLaunch = false;
let windowStateTimer = null;
let isQuitting = false;
let sessionVaultKey = null;

const store = new Store({
  name: 'config',
  defaults: {
    git: {
      repoUrl: '',
      branch: 'main',
      patEncrypted: ''
    },
    storageDir: '',
    ui: {
      settingsShownForVersion: ''
    },
    security: {
      dataMode: DATA_MODE_ENCRYPTED
    },
    vault: {
      salt: '',
      verifier: ''
    },
    windowBounds: {
      width: 760,
      height: 540
    }
  }
});

function getStorageDirSetting() {
  return String(store.get('storageDir') || '').trim();
}

function getStorageBaseDir() {
  return getStorageDirSetting() || app.getPath('userData');
}

function getRepoDir() {
  return path.join(getStorageBaseDir(), 'repo');
}

function getDataFilePath() {
  return path.join(getRepoDir(), 'storage', 'data.json');
}

function maskPathForDisplay(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  const sanitized = raw.replace(/[\\/]+$/, '');
  const parts = sanitized.split(/[\\/]+/).filter(Boolean);
  if (parts.length === 0) {
    return '';
  }
  return `.../${parts[parts.length - 1]}`;
}

function shouldForceOpenSettings() {
  const version = app.getVersion();
  const shownVersion = String(store.get('ui.settingsShownForVersion') || '').trim();
  if (shownVersion === version) {
    return false;
  }
  store.set('ui.settingsShownForVersion', version);
  return true;
}

function getSavedWindowBounds() {
  const saved = store.get('windowBounds') || {};
  const width = Number(saved.width);
  const height = Number(saved.height);
  const x = Number(saved.x);
  const y = Number(saved.y);
  const bounds = {
    width: Number.isFinite(width) ? Math.max(520, Math.round(width)) : 760,
    height: Number.isFinite(height) ? Math.max(360, Math.round(height)) : 540
  };
  if (Number.isFinite(x) && Number.isFinite(y)) {
    bounds.x = Math.round(x);
    bounds.y = Math.round(y);
  }
  return bounds;
}

function scheduleSaveWindowBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (windowStateTimer) {
    clearTimeout(windowStateTimer);
  }
  windowStateTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    store.set('windowBounds', mainWindow.getBounds());
  }, 200);
}

function encryptToken(token) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Current system does not support secure encryption for PAT.');
  }
  return safeStorage.encryptString(token).toString('base64');
}

function decryptToken(tokenEncrypted) {
  if (!tokenEncrypted) {
    return '';
  }
  const buffer = Buffer.from(tokenEncrypted, 'base64');
  return safeStorage.decryptString(buffer);
}

function getGitConfig() {
  const saved = store.get('git');
  return {
    repoUrl: saved.repoUrl || '',
    branch: saved.branch || 'main',
    patEncrypted: saved.patEncrypted || ''
  };
}

function clearGitConfig() {
  store.set('git', {
    repoUrl: '',
    branch: 'main',
    patEncrypted: ''
  });
}

function isConfigured() {
  const conf = getGitConfig();
  return Boolean(conf.repoUrl && conf.branch && conf.patEncrypted);
}

function getDataMode() {
  const mode = String(store.get('security.dataMode') || DATA_MODE_ENCRYPTED).trim().toLowerCase();
  return mode === DATA_MODE_PLAINTEXT ? DATA_MODE_PLAINTEXT : DATA_MODE_ENCRYPTED;
}

function isEncryptedMode() {
  return getDataMode() === DATA_MODE_ENCRYPTED;
}

function canLoadItemsNow() {
  return !isEncryptedMode() || isVaultUnlocked();
}

function getVaultConfig() {
  const saved = store.get('vault') || {};
  return {
    salt: String(saved.salt || ''),
    verifier: String(saved.verifier || '')
  };
}

function setVaultConfig(vault) {
  store.set('vault', {
    salt: String(vault.salt || ''),
    verifier: String(vault.verifier || '')
  });
}

function isVaultConfigured() {
  const vault = getVaultConfig();
  return Boolean(vault.salt && vault.verifier);
}

function isVaultUnlocked() {
  return Boolean(sessionVaultKey);
}

function ensureVaultUnlocked() {
  if (!isEncryptedMode()) {
    return;
  }
  if (!isVaultConfigured()) {
    throw new Error('Vault is not set up.');
  }
  if (!isVaultUnlocked()) {
    throw new Error('Vault is locked.');
  }
}

function createRandomBase64(size) {
  return crypto.randomBytes(size).toString('base64');
}

function deriveVaultKey(password, saltBase64) {
  const passwordText = String(password || '');
  const salt = Buffer.from(saltBase64, 'base64');
  if (!passwordText || !salt.length) {
    throw new Error('Vault password or salt is invalid.');
  }
  return crypto.pbkdf2Sync(passwordText, salt, VAULT_PBKDF2_ROUNDS, VAULT_KEY_BYTES, 'sha256');
}

function encryptTextWithKey(plainText, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(VAULT_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText || ''), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: VAULT_VERSION,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64')
  });
}

function decryptTextWithKey(payloadText, key) {
  let payload;
  try {
    payload = JSON.parse(String(payloadText || ''));
  } catch (_err) {
    throw new Error('Encrypted payload is invalid.');
  }

  if (!payload || payload.v !== VAULT_VERSION || !payload.iv || !payload.tag || !payload.data) {
    throw new Error('Encrypted payload format is not supported.');
  }

  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const data = Buffer.from(payload.data, 'base64');

  const decipher = crypto.createDecipheriv(VAULT_ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]);
  return plain.toString('utf8');
}

function setupVault(password) {
  const pwd = String(password || '');
  if (!pwd) {
    throw new Error('Vault password is required.');
  }
  const salt = createRandomBase64(16);
  const key = deriveVaultKey(pwd, salt);
  const verifier = encryptTextWithKey(VAULT_VERIFIER_PLAINTEXT, key);
  setVaultConfig({ salt, verifier });
  sessionVaultKey = key;
}

function unlockVault(password) {
  const vault = getVaultConfig();
  if (!vault.salt || !vault.verifier) {
    throw new Error('Vault is not configured.');
  }
  const key = deriveVaultKey(password, vault.salt);
  const verifier = decryptTextWithKey(vault.verifier, key);
  if (verifier !== VAULT_VERIFIER_PLAINTEXT) {
    throw new Error('Vault password is incorrect.');
  }
  sessionVaultKey = key;
}

function getGitInstance(baseDir) {
  return simpleGit({ baseDir });
}

function sanitizeRepoUrl(input) {
  return String(input || '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .replace(/\/+$/, '');
}

async function writeLog(message) {
  const logPath = getLogFilePath();
  if (!logPath) {
    return;
  }
  const line = `[${new Date().toISOString()}] ${sanitizeSensitiveText(message)}\n`;
  try {
    await fs.appendFile(logPath, line, 'utf8');
  } catch (_err) {
    // Ignore log failures.
  }
}

function getLogFilePath() {
  if (logFilePath) {
    return logFilePath;
  }
  try {
    logFilePath = path.join(app.getPath('userData'), 'main.log');
    return logFilePath;
  } catch (_err) {
    return '';
  }
}

function sanitizeSensitiveText(value) {
  const text = String(value || '');
  return text
    .replace(/(http\.extraHeader=Authorization:\s*Basic\s+)([A-Za-z0-9+/=]+)/gi, '$1[REDACTED]')
    .replace(/(Authorization:\s*Basic\s+)([A-Za-z0-9+/=]+)/gi, '$1[REDACTED]')
    .replace(/(x-access-token:)([^\s'"]+)/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)([^/\s:@]+):([^@\s]+)@/gi, '$1[REDACTED]:[REDACTED]@')
    .replace(/(ghp_|github_pat_)[A-Za-z0-9_]+/gi, '$1[REDACTED]')
    .replace(/([A-Za-z]:\\Users\\)([^\\\r\n]+)/gi, '$1***')
    .replace(/(\/Users\/)([^\/\r\n]+)/g, '$1***')
    .replace(/(\/home\/)([^\/\r\n]+)/g, '$1***');
}

function gitHeader(token) {
  const basic = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
  return `http.extraHeader=Authorization: Basic ${basic}`;
}

async function checkGitInstalled() {
  try {
    await simpleGit().raw(['--version']);
    return true;
  } catch (_err) {
    return false;
  }
}

async function ensureDataFileExists() {
  const file = getDataFilePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.access(file);
  } catch (_err) {
    if (isEncryptedMode() && isVaultConfigured() && isVaultUnlocked()) {
      const encrypted = encryptTextWithKey('[]', sessionVaultKey);
      await fs.writeFile(file, JSON.stringify({ version: VAULT_VERSION, encrypted }, null, 2), 'utf8');
      return;
    }
    await fs.writeFile(file, '[]', 'utf8');
  }
}

function tryParsePlainItems(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch (_err) {
    // Ignore parse failures and let caller handle.
  }
  return null;
}

async function loadItems() {
  await ensureDataFileExists();
  const raw = await fs.readFile(getDataFilePath(), 'utf8');

  if (!isEncryptedMode()) {
    const plaintextItems = tryParsePlainItems(raw);
    return plaintextItems || [];
  }

  ensureVaultUnlocked();
  const plaintextItems = tryParsePlainItems(raw);
  if (plaintextItems) {
    await saveItems(plaintextItems);
    return plaintextItems;
  }

  let wrapped;
  try {
    wrapped = JSON.parse(raw);
  } catch (_err) {
    return [];
  }
  if (!wrapped || wrapped.version !== VAULT_VERSION || !wrapped.encrypted) {
    return [];
  }

  try {
    const plain = decryptTextWithKey(wrapped.encrypted, sessionVaultKey);
    const parsed = JSON.parse(plain);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    throw new Error('Failed to decrypt data file. Check vault password.');
  }
}

async function saveItems(items) {
  await ensureDataFileExists();
  if (!isEncryptedMode()) {
    await fs.writeFile(getDataFilePath(), JSON.stringify(items, null, 2), 'utf8');
    scheduleSync();
    return;
  }

  ensureVaultUnlocked();
  const plain = JSON.stringify(items, null, 2);
  const encrypted = encryptTextWithKey(plain, sessionVaultKey);
  const payload = {
    version: VAULT_VERSION,
    encrypted
  };
  await fs.writeFile(getDataFilePath(), JSON.stringify(payload, null, 2), 'utf8');
  scheduleSync();
}

async function setStorageMode(payload) {
  const targetModeRaw = String(payload && payload.mode ? payload.mode : '').trim().toLowerCase();
  const targetMode = targetModeRaw === DATA_MODE_PLAINTEXT ? DATA_MODE_PLAINTEXT : DATA_MODE_ENCRYPTED;
  const password = String(payload && payload.password ? payload.password : '');
  const currentMode = getDataMode();

  if (targetMode === currentMode) {
    return {
      ok: true,
      mode: currentMode,
      security: {
        dataMode: currentMode
      },
      vault: {
        configured: isVaultConfigured(),
        unlocked: isVaultUnlocked()
      }
    };
  }

  if (targetMode === DATA_MODE_PLAINTEXT) {
    if (!isVaultConfigured()) {
      return { ok: false, error: 'Vault is not configured.' };
    }
    if (!isVaultUnlocked()) {
      if (!password) {
        return { ok: false, error: 'Vault password is required to switch to plaintext.' };
      }
      unlockVault(password);
    }
    const items = await loadItems();
    store.set('security.dataMode', DATA_MODE_PLAINTEXT);
    await saveItems(items);
    return {
      ok: true,
      mode: DATA_MODE_PLAINTEXT,
      security: {
        dataMode: DATA_MODE_PLAINTEXT
      },
      items,
      vault: {
        configured: isVaultConfigured(),
        unlocked: isVaultUnlocked()
      }
    };
  }

  if (!isVaultConfigured()) {
    if (!password) {
      return { ok: false, error: 'Set a vault password to enable encrypted mode.' };
    }
    setupVault(password);
  } else if (!isVaultUnlocked()) {
    if (!password) {
      return { ok: false, error: 'Vault password is required to enable encrypted mode.' };
    }
    unlockVault(password);
  }

  const items = await loadItems();
  store.set('security.dataMode', DATA_MODE_ENCRYPTED);
  await saveItems(items);
  return {
    ok: true,
    mode: DATA_MODE_ENCRYPTED,
    security: {
      dataMode: DATA_MODE_ENCRYPTED
    },
    items,
    vault: {
      configured: isVaultConfigured(),
      unlocked: isVaultUnlocked()
    }
  };
}

async function runGitInRepo(args) {
  const conf = getGitConfig();
  const token = decryptToken(conf.patEncrypted);
  const git = getGitInstance(getRepoDir());
  return git.raw(['-c', gitHeader(token), ...args]);
}

async function initializeRepository() {
  const conf = getGitConfig();
  const token = decryptToken(conf.patEncrypted);
  const repoDir = getRepoDir();
  const gitDir = path.join(repoDir, '.git');

  await fs.mkdir(path.dirname(repoDir), { recursive: true });

  let exists = true;
  try {
    await fs.access(gitDir);
  } catch (_err) {
    exists = false;
  }

  if (!exists) {
    const baseGit = getGitInstance(app.getPath('userData'));
    await baseGit.raw([
      '-c',
      gitHeader(token),
      'clone',
      '--branch',
      conf.branch,
      conf.repoUrl,
      repoDir
    ]);
  } else {
    await runGitInRepo(['remote', 'set-url', 'origin', conf.repoUrl]);
    await runGitInRepo(['fetch', 'origin', conf.branch]);
    try {
      await runGitInRepo(['checkout', conf.branch]);
    } catch (_err) {
      await runGitInRepo(['checkout', '-b', conf.branch, `origin/${conf.branch}`]);
    }
  }

  await ensureDataFileExists();
}

async function pullOnStartupSilently() {
  if (!isConfigured()) {
    return;
  }
  try {
    await initializeRepository();
    const conf = getGitConfig();
    await runGitInRepo(['pull', '--rebase', 'origin', conf.branch]);
  } catch (err) {
    console.error('Startup pull failed:', sanitizeSensitiveText(err.message));
  }
}

async function resolvePushFailure(pushError) {
  const safeError = sanitizeSensitiveText(String(pushError.message || pushError));
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Git Push Failed',
    message: 'Push failed due to remote changes or conflicts.',
    detail: `${safeError}\n\nChoose how to continue.`,
    buttons: ['Force Overwrite Remote', 'Manual Resolve', 'Cancel'],
    defaultId: 1,
    cancelId: 2,
    noLink: true
  });

  if (result.response === 0) {
    const conf = getGitConfig();
    await runGitInRepo(['push', '--force-with-lease', 'origin', conf.branch]);
    return;
  }

  if (result.response === 1) {
    await shell.openPath(getRepoDir());
    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Manual Resolve',
      message: 'Repository folder opened.',
      detail: 'Resolve conflicts manually, then run git push.',
      buttons: ['OK']
    });
  }
}

async function syncNow() {
  if (!isConfigured()) {
    return;
  }

  const conf = getGitConfig();
  try {
    await runGitInRepo(['add', '.']);
    try {
      await runGitInRepo(['commit', '-m', 'update']);
    } catch (commitErr) {
      const message = String(commitErr.message || commitErr);
      if (!message.includes('nothing to commit')) {
        throw commitErr;
      }
    }
    await runGitInRepo(['push', 'origin', conf.branch]);
  } catch (pushErr) {
    await resolvePushFailure(pushErr);
  }
}

function scheduleSync() {
  if (syncTimer) {
    clearTimeout(syncTimer);
  }
  syncTimer = setTimeout(() => {
    syncNow().catch((err) => {
      console.error('Sync failed:', sanitizeSensitiveText(err.message));
    });
  }, SYNC_DEBOUNCE_MS);
}

function hideWindow() {
  if (mainWindow && mainWindow.isVisible()) {
    mainWindow.hide();
  }
}

function applyWindowModeByConfig() {
  if (!mainWindow) {
    return;
  }
  mainWindow.setAlwaysOnTop(false);
  mainWindow.setSkipTaskbar(false);
}

function toggleWindow() {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isVisible()) {
    hideWindow();
    return;
  }

  mainWindow.show();
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.focus();
  mainWindow.webContents.send('window:shown');
}

function createVIcon(size = 64) {
  const stroke = Math.max(3, Math.round(size / 12));
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
      <rect x="6" y="6" width="52" height="52" rx="12" fill="#111820"/>
      <path d="M16 18l16 30 16-30" fill="none" stroke="#4ec3b9" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `.trim();
  return nativeImage.createFromDataURL(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
}

function loadPackagedIcon() {
  const iconCandidates = [
    path.join(__dirname, 'icon.png'),
    path.join(__dirname, 'icon.ico')
  ];
  for (const iconPath of iconCandidates) {
    const image = nativeImage.createFromPath(iconPath);
    if (!image.isEmpty()) {
      return image;
    }
  }
  return null;
}

function getAppIcon() {
  if (appIcon && !appIcon.isEmpty()) {
    return appIcon;
  }
  appIcon = loadPackagedIcon() || createVIcon(64);
  return appIcon;
}

function getTrayIcon() {
  return getAppIcon().resize({ width: 18, height: 18 });
}

function createTray() {
  if (tray) {
    return;
  }
  const icon = getTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('GitNote Quick');
  tray.on('click', () => toggleWindow());

  const menu = Menu.buildFromTemplate([
    {
      label: 'Show/Hide',
      click: () => toggleWindow()
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit()
    }
  ]);
  tray.setContextMenu(menu);
}

function createWindow() {
  const savedBounds = getSavedWindowBounds();
  mainWindow = new BrowserWindow({
    width: savedBounds.width,
    height: savedBounds.height,
    x: savedBounds.x,
    y: savedBounds.y,
    minWidth: 520,
    minHeight: 360,
    show: false,
    frame: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    resizable: true,
    backgroundColor: '#111111',
    icon: getAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      hideWindow();
    }
  });
  mainWindow.on('move', scheduleSaveWindowBounds);
  mainWindow.on('resize', scheduleSaveWindowBounds);

  mainWindow.on('closed', () => {
    if (windowStateTimer) {
      clearTimeout(windowStateTimer);
      windowStateTimer = null;
    }
    mainWindow = null;
  });
}

function registerShortcut() {
  const ok = globalShortcut.register(TOGGLE_SHORTCUT, () => {
    toggleWindow();
  });

  if (!ok) {
    dialog.showErrorBox('Shortcut Error', `Failed to register shortcut: ${TOGGLE_SHORTCUT}`);
  }
}

async function getInitialPayload() {
  const gitInstalled = await checkGitInstalled();
  const configured = isConfigured();
  const dataMode = getDataMode();
  const vaultConfigured = isVaultConfigured();
  const vaultUnlocked = isVaultUnlocked();
  let items = [];

  if (configured && canLoadItemsNow()) {
    try {
      items = await loadItems();
    } catch (_err) {
      items = [];
    }
  }

  const conf = getGitConfig();
  return {
    gitInstalled,
    configured,
    config: {
      repoUrl: conf.repoUrl,
      branch: conf.branch
    },
    storage: {
      current: getStorageDirSetting(),
      defaultDir: app.getPath('userData')
    },
    security: {
      dataMode
    },
    vault: {
      configured: vaultConfigured,
      unlocked: vaultUnlocked
    },
    items,
    forceOpenSettings: forceOpenSettingsOnLaunch
  };
}

ipcMain.handle('app:init', async () => {
  return getInitialPayload();
});

ipcMain.handle('config:save', async (_event, payload) => {
  const repoUrl = sanitizeRepoUrl(payload.repoUrl);
  const branch = String(payload.branch || 'main').trim() || 'main';
  const pat = String(payload.pat || '').trim();

  if (!repoUrl || !branch || !pat) {
    return { ok: false, error: 'Repo URL, Branch and PAT are required.' };
  }
  if (!repoUrl.startsWith('https://')) {
    return { ok: false, error: 'Repo URL must use HTTPS.' };
  }

  if (!(await checkGitInstalled())) {
    return { ok: false, error: 'Git is not installed or unavailable in PATH.' };
  }

  try {
    store.set('git', {
      repoUrl,
      branch,
      patEncrypted: encryptToken(pat)
    });
    applyWindowModeByConfig();
    await initializeRepository();
    await pullOnStartupSilently();
    const items = canLoadItemsNow() ? await loadItems() : [];
    return {
      ok: true,
      items,
      security: {
        dataMode: getDataMode()
      },
      vault: {
        configured: isVaultConfigured(),
        unlocked: isVaultUnlocked()
      }
    };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('vault:setup', async (_event, password) => {
  if (isVaultConfigured()) {
    return { ok: false, error: 'Vault is already configured.' };
  }
  try {
    setupVault(password);
    const items = await loadItems();
    return {
      ok: true,
      items,
      security: {
        dataMode: getDataMode()
      },
      vault: { configured: true, unlocked: true }
    };
  } catch (err) {
    sessionVaultKey = null;
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('vault:unlock', async (_event, password) => {
  if (!isVaultConfigured()) {
    return { ok: false, error: 'Vault is not configured.' };
  }
  try {
    unlockVault(password);
    const items = await loadItems();
    return {
      ok: true,
      items,
      security: {
        dataMode: getDataMode()
      },
      vault: { configured: true, unlocked: true }
    };
  } catch (err) {
    sessionVaultKey = null;
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('config:logout', async (_event, payload) => {
  clearGitConfig();
  if (payload && payload.clearRepo) {
    try {
      await fs.rm(getRepoDir(), { recursive: true, force: true });
    } catch (_err) {
      return { ok: false, error: 'Failed to remove local repo.' };
    }
  }
  applyWindowModeByConfig();
  return { ok: true };
});

ipcMain.handle('config:openRepo', async () => {
  const conf = getGitConfig();
  const url = sanitizeRepoUrl(conf.repoUrl);
  if (!url || !url.startsWith('https://')) {
    return { ok: false, error: 'Repo URL is invalid.' };
  }
  await shell.openExternal(url);
  return { ok: true };
});

ipcMain.handle('storage:select', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Storage Folder',
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths[0]) {
    return { ok: false };
  }
  return { ok: true, path: result.filePaths[0] };
});

ipcMain.handle('storage:save', async (_event, dir) => {
  const target = String(dir || '').trim();
  if (!target) {
    return { ok: false, error: 'Storage path is required.' };
  }
  if (!path.isAbsolute(target)) {
    return { ok: false, error: 'Storage path must be absolute.' };
  }
  try {
    await fs.mkdir(target, { recursive: true });
    const stat = await fs.stat(target);
    if (!stat.isDirectory()) {
      return { ok: false, error: 'Storage path is not a directory.' };
    }
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }

  store.set('storageDir', target);
  try {
    if (isConfigured()) {
      await initializeRepository();
      const items = canLoadItemsNow() ? await loadItems() : [];
      return { ok: true, items, security: { dataMode: getDataMode() } };
    }
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
  return { ok: true };
});

ipcMain.handle('storage:reset', async () => {
  store.set('storageDir', '');
  try {
    if (isConfigured()) {
      await initializeRepository();
      const items = canLoadItemsNow() ? await loadItems() : [];
      return { ok: true, items, security: { dataMode: getDataMode() } };
    }
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
  return { ok: true };
});

ipcMain.handle('storage:mode:set', async (_event, payload) => {
  try {
    return await setStorageMode(payload || {});
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('logs:read', async () => {
  const logPath = getLogFilePath();
  if (!logPath) {
    return { ok: false, error: 'Log path unavailable.' };
  }
  try {
    const content = await fs.readFile(logPath, 'utf8');
    const lines = content.split(/\r?\n/);
    const tail = lines.slice(-MAX_LOG_LINES).join('\n');
    return {
      ok: true,
      path: maskPathForDisplay(logPath),
      content: sanitizeSensitiveText(tail)
    };
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { ok: true, path: maskPathForDisplay(logPath), content: '' };
    }
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('items:create', async (_event, text) => {
  try {
    const value = String(text || '').trim();
    if (!value) {
      return { ok: false, error: 'Text cannot be empty.' };
    }

    const items = await loadItems();
    const item = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      text: value,
      updatedAt: new Date().toISOString()
    };
    items.unshift(item);
    await saveItems(items);
    return { ok: true, items, item };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('items:update', async (_event, payload) => {
  try {
    const id = String(payload.id || '');
    const text = String(payload.text || '').trim();
    if (!id || !text) {
      return { ok: false, error: 'Invalid item update.' };
    }

    const items = await loadItems();
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) {
      return { ok: false, error: 'Item not found.' };
    }

    items[index] = { ...items[index], text, updatedAt: new Date().toISOString() };
    await saveItems(items);
    return { ok: true, items, item: items[index] };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('items:delete', async (_event, id) => {
  try {
    const itemId = String(id || '');
    const items = await loadItems();
    const next = items.filter((item) => item.id !== itemId);
    await saveItems(next);
    return { ok: true, items: next };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('items:copy', async (_event, id) => {
  try {
    const itemId = String(id || '');
    const items = await loadItems();
    const found = items.find((item) => item.id === itemId);
    if (!found) {
      return { ok: false, error: 'Item not found.' };
    }
    clipboard.writeText(found.text);
    hideWindow();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('window:shown');
    }
  });

  app.whenReady().then(async () => {
    process.on('uncaughtException', (err) => {
      writeLog(`uncaughtException: ${err && err.stack ? err.stack : String(err)}`);
    });
    process.on('unhandledRejection', (err) => {
      writeLog(`unhandledRejection: ${err && err.stack ? err.stack : String(err)}`);
    });

    forceOpenSettingsOnLaunch = shouldForceOpenSettings();
    createWindow();
    try {
      createTray();
    } catch (err) {
      writeLog(`createTray failed: ${err && err.stack ? err.stack : String(err)}`);
    }
    applyWindowModeByConfig();
    registerShortcut();
    if (!isConfigured() || forceOpenSettingsOnLaunch) {
      mainWindow.show();
      mainWindow.focus();
    }
    await pullOnStartupSilently();
  });
}

app.on('will-quit', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    store.set('windowBounds', mainWindow.getBounds());
  }
  globalShortcut.unregisterAll();
});

app.on('before-quit', () => {
  isQuitting = true;
  sessionVaultKey = null;
});

app.on('window-all-closed', (event) => {
  if (!isQuitting) {
    event.preventDefault();
  }
});

app.on('activate', () => {
  if (mainWindow) {
    toggleWindow();
  }
});
