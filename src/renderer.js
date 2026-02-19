const state = {
  items: [],
  filtered: [],
  selectedId: null,
  editingId: null,
  storage: {
    currentDir: '',
    defaultDir: ''
  },
  config: {
    repoUrl: '',
    branch: 'main'
  },
  security: {
    dataMode: 'encrypted'
  },
  vault: {
    configured: false,
    unlocked: false
  }
};

const els = {
  configView: document.getElementById('configView'),
  appView: document.getElementById('appView'),
  repoUrl: document.getElementById('repoUrl'),
  branch: document.getElementById('branch'),
  pat: document.getElementById('pat'),
  saveConfig: document.getElementById('saveConfig'),
  configError: document.getElementById('configError'),
  search: document.getElementById('search'),
  list: document.getElementById('list'),
  btnNew: document.getElementById('btnNew'),
  btnEdit: document.getElementById('btnEdit'),
  btnDelete: document.getElementById('btnDelete'),
  btnSettings: document.getElementById('btnSettings'),
  editor: document.getElementById('editor'),
  editorTitle: document.getElementById('editorTitle'),
  editorText: document.getElementById('editorText'),
  saveItem: document.getElementById('saveItem'),
  cancelEdit: document.getElementById('cancelEdit'),
  editorError: document.getElementById('editorError'),
  settings: document.getElementById('settings'),
  closeSettings: document.getElementById('closeSettings'),
  configStorageDir: document.getElementById('configStorageDir'),
  configChooseStorage: document.getElementById('configChooseStorage'),
  configSaveStorage: document.getElementById('configSaveStorage'),
  configResetStorage: document.getElementById('configResetStorage'),
  configStorageHelp: document.getElementById('configStorageHelp'),
  configStorageError: document.getElementById('configStorageError'),
  storageDir: document.getElementById('storageDir'),
  chooseStorage: document.getElementById('chooseStorage'),
  saveStorage: document.getElementById('saveStorage'),
  resetStorage: document.getElementById('resetStorage'),
  storageHelp: document.getElementById('storageHelp'),
  storageError: document.getElementById('storageError'),
  settingsRepoUrl: document.getElementById('settingsRepoUrl'),
  settingsBranch: document.getElementById('settingsBranch'),
  settingsPat: document.getElementById('settingsPat'),
  connectRepo: document.getElementById('connectRepo'),
  openRepo: document.getElementById('openRepo'),
  viewLogs: document.getElementById('viewLogs'),
  logoutRepo: document.getElementById('logoutRepo'),
  logoutClean: document.getElementById('logoutClean'),
  logoutWarning: document.getElementById('logoutWarning'),
  settingsError: document.getElementById('settingsError'),
  modeEncrypted: document.getElementById('modeEncrypted'),
  modePlaintext: document.getElementById('modePlaintext'),
  modeStatus: document.getElementById('modeStatus'),
  modeError: document.getElementById('modeError'),
  logs: document.getElementById('logs'),
  closeLogs: document.getElementById('closeLogs'),
  refreshLogs: document.getElementById('refreshLogs'),
  logsPath: document.getElementById('logsPath'),
  logsText: document.getElementById('logsText'),
  logsError: document.getElementById('logsError'),
  vault: document.getElementById('vault'),
  vaultTitle: document.getElementById('vaultTitle'),
  vaultHint: document.getElementById('vaultHint'),
  vaultPassword: document.getElementById('vaultPassword'),
  vaultAction: document.getElementById('vaultAction'),
  vaultError: document.getElementById('vaultError')
};

let vaultMode = 'unlock';

function requiresVault() {
  return state.security.dataMode === 'encrypted';
}

function applySecurityAndVault(result) {
  if (result && result.security) {
    state.security = result.security;
  }
  if (result && result.vault) {
    state.vault = result.vault;
  }
}

function show(view) {
  els.configView.classList.add('hidden');
  els.appView.classList.add('hidden');
  view.classList.remove('hidden');
}

function applyFilter() {
  const keyword = els.search.value.trim().toLowerCase();
  state.filtered = state.items.filter((item) => item.text.toLowerCase().includes(keyword));

  if (!state.filtered.some((item) => item.id === state.selectedId)) {
    state.selectedId = state.filtered[0] ? state.filtered[0].id : null;
  }

  renderList();
}

function renderList() {
  els.list.textContent = '';

  if (state.filtered.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'No snippets found.';
    els.list.appendChild(empty);
    return;
  }

  const frag = document.createDocumentFragment();
  for (const item of state.filtered) {
    const li = document.createElement('li');
    li.className = item.id === state.selectedId ? 'item active' : 'item';
    li.dataset.id = item.id;
    li.textContent = String(item.text || '').replace(/\n/g, ' ');
    frag.appendChild(li);
  }
  els.list.appendChild(frag);
}

function openEditor(mode) {
  els.editor.classList.remove('hidden');
  els.editorError.textContent = '';
  if (mode === 'edit') {
    const current = state.items.find((i) => i.id === state.selectedId);
    if (!current) {
      els.editor.classList.add('hidden');
      return;
    }
    state.editingId = current.id;
    els.editorTitle.textContent = 'Edit Snippet';
    els.editorText.value = current.text;
  } else {
    state.editingId = null;
    els.editorTitle.textContent = 'New Snippet';
    els.editorText.value = '';
  }
  els.editorText.focus();
}

function closeEditor() {
  els.editor.classList.add('hidden');
  els.editorError.textContent = '';
  state.editingId = null;
}

function openSettings() {
  els.settings.classList.remove('hidden');
  els.settingsError.textContent = '';
  els.storageError.textContent = '';
  els.modeError.textContent = '';
  els.settingsPat.value = '';
  updateSettingsView();
  updateLogoutWarning();
  els.settingsRepoUrl.focus();
}

function closeSettings() {
  els.settings.classList.add('hidden');
}

async function loadLogs() {
  els.logsError.textContent = '';
  const result = await window.api.readLogs();
  if (!result.ok) {
    els.logsText.value = '';
    els.logsPath.textContent = '';
    els.logsError.textContent = result.error || 'Failed to load logs.';
    return;
  }
  els.logsPath.textContent = result.path ? `Source: ${result.path}` : '';
  els.logsText.value = result.content || '';
  els.logsText.scrollTop = els.logsText.scrollHeight;
}

async function openLogs() {
  await loadLogs();
  els.logs.classList.remove('hidden');
}

function closeLogs() {
  els.logs.classList.add('hidden');
}

function openVault(mode) {
  vaultMode = mode === 'setup' ? 'setup' : 'unlock';
  els.vaultError.textContent = '';
  els.vaultPassword.value = '';
  els.vaultTitle.textContent = vaultMode === 'setup' ? 'Set Vault Password' : 'Unlock Vault';
  els.vaultHint.textContent =
    vaultMode === 'setup'
      ? 'This password encrypts local snippets and is required to read them later.'
      : 'Enter vault password to decrypt local snippets.';
  els.vaultAction.textContent = vaultMode === 'setup' ? 'Set Password' : 'Unlock';
  els.vault.classList.remove('hidden');
  els.vaultPassword.focus();
}

function closeVault() {
  els.vault.classList.add('hidden');
}

function updateSettingsView() {
  els.settingsRepoUrl.value = state.config.repoUrl || '';
  els.settingsBranch.value = state.config.branch || 'main';
  updateStorageViews();
  updateModeStatus();
}

function maskPath(value) {
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

function updateStorageViews() {
  const current = state.storage.currentDir || '';
  const help = state.storage.defaultDir ? `Default: ${maskPath(state.storage.defaultDir)}` : '';
  if (els.storageDir) {
    els.storageDir.value = current;
  }
  if (els.storageHelp) {
    els.storageHelp.textContent = help;
  }
  if (els.configStorageDir) {
    els.configStorageDir.value = current;
  }
  if (els.configStorageHelp) {
    els.configStorageHelp.textContent = help;
  }
}

function updateLogoutWarning() {
  if (!els.logoutWarning) {
    return;
  }
  const show = Boolean(els.logoutClean && els.logoutClean.checked);
  els.logoutWarning.classList.toggle('hidden', !show);
}

function updateModeStatus() {
  const encrypted = state.security.dataMode === 'encrypted';
  els.modeStatus.textContent = encrypted
    ? 'Current mode: Encrypted (password required to read snippets)'
    : 'Current mode: Plaintext (no password, lower privacy)';
  els.modeEncrypted.disabled = encrypted;
  els.modePlaintext.disabled = !encrypted;
}

async function saveEditor() {
  if (requiresVault() && !state.vault.unlocked) {
    openVault(state.vault.configured ? 'unlock' : 'setup');
    return;
  }
  const text = els.editorText.value.trim();
  if (!text) {
    els.editorError.textContent = 'Text cannot be empty.';
    return;
  }

  let result;
  if (state.editingId) {
    result = await window.api.updateItem({ id: state.editingId, text });
  } else {
    result = await window.api.createItem(text);
  }

  if (!result.ok) {
    els.editorError.textContent = result.error || 'Save failed.';
    return;
  }

  state.items = result.items;
  applyFilter();
  closeEditor();
}

async function copySelectedAndHide() {
  if (!state.selectedId) {
    return;
  }
  if (requiresVault() && !state.vault.unlocked) {
    openVault(state.vault.configured ? 'unlock' : 'setup');
    return;
  }
  await window.api.copyItem(state.selectedId);
}

async function deleteSelected() {
  if (!state.selectedId) {
    return;
  }
  if (requiresVault() && !state.vault.unlocked) {
    openVault(state.vault.configured ? 'unlock' : 'setup');
    return;
  }
  const result = await window.api.deleteItem(state.selectedId);
  if (!result.ok) {
    return;
  }
  state.items = result.items;
  applyFilter();
}

function moveSelection(direction) {
  const idx = state.filtered.findIndex((item) => item.id === state.selectedId);
  if (idx < 0) {
    return;
  }
  const nextIndex = idx + direction;
  if (nextIndex < 0 || nextIndex >= state.filtered.length) {
    return;
  }
  state.selectedId = state.filtered[nextIndex].id;
  renderList();
}

function resetFocus() {
  els.search.focus();
  els.search.select();
}

async function init() {
  const payload = await window.api.init();
  state.storage = payload.storage || state.storage;
  state.config = payload.config || state.config;
  state.security = payload.security || state.security;
  state.vault = payload.vault || state.vault;
  state.items = payload.items || [];

  if (!payload.gitInstalled) {
    show(els.configView);
    els.configError.textContent = 'Git not found in PATH. Please install Git first.';
    updateStorageViews();
    return;
  }

  if (payload.forceOpenSettings) {
    show(els.appView);
    applyFilter();
    openSettings();
    if (requiresVault() && !state.vault.configured) {
      openVault('setup');
      return;
    }
    if (requiresVault() && !state.vault.unlocked) {
      openVault('unlock');
      return;
    }
    return;
  }

  if (!payload.configured) {
    show(els.configView);
    els.branch.value = payload.config.branch || 'main';
    updateStorageViews();
    return;
  }

  show(els.appView);
  applyFilter();
  if (requiresVault() && !state.vault.configured) {
    openVault('setup');
    return;
  }
  if (requiresVault() && !state.vault.unlocked) {
    openVault('unlock');
    return;
  }
  resetFocus();
}

els.saveConfig.addEventListener('click', async () => {
  els.configError.textContent = '';
  const result = await window.api.saveConfig({
    repoUrl: els.repoUrl.value,
    branch: els.branch.value,
    pat: els.pat.value
  });

  if (!result.ok) {
    els.configError.textContent = result.error || 'Config failed.';
    return;
  }

  state.items = result.items || [];
  state.config = {
    repoUrl: els.repoUrl.value.trim(),
    branch: els.branch.value.trim() || 'main'
  };
  applySecurityAndVault(result);
  show(els.appView);
  applyFilter();
  if (requiresVault() && !state.vault.configured) {
    openVault('setup');
    return;
  }
  if (requiresVault() && !state.vault.unlocked) {
    openVault('unlock');
    return;
  }
  resetFocus();
});

els.search.addEventListener('input', applyFilter);

els.list.addEventListener('click', (event) => {
  const li = event.target.closest('.item');
  if (!li) {
    return;
  }
  state.selectedId = li.dataset.id;
  renderList();
  copySelectedAndHide();
});

els.btnNew.addEventListener('click', () => openEditor('new'));
els.btnEdit.addEventListener('click', () => openEditor('edit'));
els.btnDelete.addEventListener('click', deleteSelected);
els.btnSettings.addEventListener('click', openSettings);
els.saveItem.addEventListener('click', saveEditor);
els.cancelEdit.addEventListener('click', closeEditor);
els.closeSettings.addEventListener('click', closeSettings);

els.chooseStorage.addEventListener('click', async () => {
  els.storageError.textContent = '';
  const result = await window.api.selectStorageDir();
  if (result.ok && result.path) {
    els.storageDir.value = result.path;
  }
});

els.saveStorage.addEventListener('click', async () => {
  els.storageError.textContent = '';
  const result = await window.api.saveStorageDir(els.storageDir.value);
  if (!result.ok) {
    els.storageError.textContent = result.error || 'Save failed.';
    return;
  }
  if (result.items) {
    state.items = result.items;
    applyFilter();
  }
  applySecurityAndVault(result);
  state.storage.currentDir = els.storageDir.value.trim();
  updateSettingsView();
});

els.resetStorage.addEventListener('click', async () => {
  els.storageError.textContent = '';
  const result = await window.api.resetStorageDir();
  if (!result.ok) {
    els.storageError.textContent = result.error || 'Reset failed.';
    return;
  }
  if (result.items) {
    state.items = result.items;
    applyFilter();
  }
  applySecurityAndVault(result);
  state.storage.currentDir = '';
  updateSettingsView();
});

els.configChooseStorage.addEventListener('click', async () => {
  els.configStorageError.textContent = '';
  const result = await window.api.selectStorageDir();
  if (result.ok && result.path) {
    els.configStorageDir.value = result.path;
  }
});

els.configSaveStorage.addEventListener('click', async () => {
  els.configStorageError.textContent = '';
  const result = await window.api.saveStorageDir(els.configStorageDir.value);
  if (!result.ok) {
    els.configStorageError.textContent = result.error || 'Save failed.';
    return;
  }
  if (result.items) {
    state.items = result.items;
    applyFilter();
  }
  applySecurityAndVault(result);
  state.storage.currentDir = els.configStorageDir.value.trim();
  updateStorageViews();
});

els.configResetStorage.addEventListener('click', async () => {
  els.configStorageError.textContent = '';
  const result = await window.api.resetStorageDir();
  if (!result.ok) {
    els.configStorageError.textContent = result.error || 'Reset failed.';
    return;
  }
  if (result.items) {
    state.items = result.items;
    applyFilter();
  }
  applySecurityAndVault(result);
  state.storage.currentDir = '';
  updateStorageViews();
});

els.connectRepo.addEventListener('click', async () => {
  els.settingsError.textContent = '';
  const result = await window.api.saveConfig({
    repoUrl: els.settingsRepoUrl.value,
    branch: els.settingsBranch.value,
    pat: els.settingsPat.value
  });

  if (!result.ok) {
    els.settingsError.textContent = result.error || 'Config failed.';
    return;
  }

  state.items = result.items || [];
  state.config = {
    repoUrl: els.settingsRepoUrl.value.trim(),
    branch: els.settingsBranch.value.trim() || 'main'
  };
  applySecurityAndVault(result);
  applyFilter();
  updateSettingsView();
  closeSettings();
  if (requiresVault() && !state.vault.configured) {
    openVault('setup');
    return;
  }
  if (requiresVault() && !state.vault.unlocked) {
    openVault('unlock');
    return;
  }
});

els.vaultAction.addEventListener('click', async () => {
  els.vaultError.textContent = '';
  const password = els.vaultPassword.value;
  if (!password) {
    els.vaultError.textContent = 'Vault password is required.';
    return;
  }

  const result =
    vaultMode === 'setup'
      ? await window.api.setupVault(password)
      : await window.api.unlockVault(password);
  if (!result.ok) {
    els.vaultError.textContent = result.error || 'Vault action failed.';
    return;
  }
  applySecurityAndVault(result);
  state.items = result.items || [];
  applyFilter();
  closeVault();
  resetFocus();
});

els.modeEncrypted.addEventListener('click', async () => {
  els.modeError.textContent = '';
  const password = window.prompt(
    state.vault.configured ? 'Enter vault password to enable encrypted mode:' : 'Set a new vault password:'
  );
  if (password === null) {
    return;
  }
  const result = await window.api.setStorageMode({
    mode: 'encrypted',
    password: String(password || '')
  });
  if (!result.ok) {
    els.modeError.textContent = result.error || 'Failed to switch mode.';
    return;
  }
  applySecurityAndVault(result);
  if (result.items) {
    state.items = result.items;
    applyFilter();
  }
  updateModeStatus();
});

els.modePlaintext.addEventListener('click', async () => {
  els.modeError.textContent = '';
  if (!window.confirm('Switch to plaintext mode? Snippets will be stored without encryption.')) {
    return;
  }
  const password = state.vault.unlocked
    ? ''
    : (window.prompt('Enter vault password to decrypt and migrate data:') || '');
  const result = await window.api.setStorageMode({
    mode: 'plaintext',
    password
  });
  if (!result.ok) {
    els.modeError.textContent = result.error || 'Failed to switch mode.';
    return;
  }
  applySecurityAndVault(result);
  if (result.items) {
    state.items = result.items;
    applyFilter();
  }
  closeVault();
  updateModeStatus();
});

els.openRepo.addEventListener('click', async () => {
  els.settingsError.textContent = '';
  const result = await window.api.openRepo();
  if (!result.ok) {
    els.settingsError.textContent = result.error || 'Open repo failed.';
  }
});

els.viewLogs.addEventListener('click', async () => {
  await openLogs();
});

els.closeLogs.addEventListener('click', () => {
  closeLogs();
});

els.refreshLogs.addEventListener('click', async () => {
  await loadLogs();
});

els.logoutClean.addEventListener('change', () => {
  updateLogoutWarning();
});

els.logoutRepo.addEventListener('click', async () => {
  els.settingsError.textContent = '';
  const clearRepo = Boolean(els.logoutClean.checked);
  const message = clearRepo
    ? 'Logout and remove the local repo? Please back it up first.'
    : 'Logout from the GitHub repo?';
  if (!window.confirm(message)) {
    return;
  }

  const result = await window.api.logoutConfig({ clearRepo });
  if (!result.ok) {
    els.settingsError.textContent = result.error || 'Logout failed.';
    return;
  }
  state.config = { repoUrl: '', branch: 'main' };
  els.logoutClean.checked = false;
  closeSettings();
  show(els.configView);
});

window.api.onWindowShown(() => {
  resetFocus();
});

document.addEventListener('keydown', async (event) => {
  const ctrlOrMeta = event.ctrlKey || event.metaKey;

  if (ctrlOrMeta && event.key.toLowerCase() === 'n') {
    event.preventDefault();
    openEditor('new');
    return;
  }

  if (ctrlOrMeta && event.key.toLowerCase() === 'e') {
    event.preventDefault();
    openEditor('edit');
    return;
  }

  if (event.key === 'Escape' && !els.editor.classList.contains('hidden')) {
    closeEditor();
    return;
  }

  if (event.key === 'Escape' && !els.settings.classList.contains('hidden')) {
    closeSettings();
    return;
  }

  if (event.key === 'Escape' && !els.logs.classList.contains('hidden')) {
    closeLogs();
    return;
  }

  if (!els.vault.classList.contains('hidden') && event.key === 'Enter') {
    event.preventDefault();
    await els.vaultAction.click();
    return;
  }

  if (event.key === 'Enter' && els.editor.classList.contains('hidden')) {
    event.preventDefault();
    await copySelectedAndHide();
    return;
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveSelection(1);
    return;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveSelection(-1);
  }
});

init();
