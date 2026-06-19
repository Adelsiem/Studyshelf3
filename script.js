/* ════════════════════════════════════════════════════
   StudyShelf — script.js
   Uses IndexedDB (built into browser) for permanent
   storage of both folders and PDF files.
   No server, no internet, no external database needed.
════════════════════════════════════════════════════ */

/* ══════════════════════════════════════
   ADMIN PASSWORD
   ⚠️ Change this to your own password!
══════════════════════════════════════ */
const ADMIN_PASSWORD = 'Mustapha2024';   // ← CHANGE THIS
const SESSION_KEY    = 'ss_admin_auth';
let   isAdmin        = false;

/* ══════════════════════════════════════
   INDEXEDDB — two stores:
   'folders' and 'pdfs'
══════════════════════════════════════ */
const DB_NAME       = 'StudyShelfDB_v3';
const DB_VERSION    = 1;
const STORE_FOLDERS = 'folders';
const STORE_FILES   = 'pdfs';
let   db            = null;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = function(e) {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORE_FOLDERS)) {
        d.createObjectStore(STORE_FOLDERS, { keyPath: 'id' });
      }
      if (!d.objectStoreNames.contains(STORE_FILES)) {
        d.createObjectStore(STORE_FILES, { keyPath: 'id' });
      }
    };

    req.onsuccess = e => { db = e.target.result; resolve(); };
    req.onerror   = e => reject(e.target.error);
  });
}

function dbGetAll(store) {
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}
function dbPut(store, record) {
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).put(record);
    req.onsuccess = () => res();
    req.onerror   = () => rej(req.error);
  });
}
function dbDelete(store, id) {
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).delete(id);
    req.onsuccess = () => res();
    req.onerror   = () => rej(req.error);
  });
}
function dbClear(store) {
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).clear();
    req.onsuccess = () => res();
    req.onerror   = () => rej(req.error);
  });
}

function readFileAsArrayBuffer(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = e => res(e.target.result);
    r.onerror = () => rej(new Error('Read failed'));
    r.readAsArrayBuffer(file);
  });
}

/* ══════════════════════════════════════
   STATE
══════════════════════════════════════ */
let folders       = [];   // { id, name, date }
let repository    = [];   // { id, name, title, size, sizeKB, type, date, folderId, buffer }
let selectedFiles = [];
let currentFolder = null; // null = root
let folderStack   = [];   // navigation history
let renamingId    = null;
let totalIngested = 0;
let totalFailed   = 0;

/* ══════════════════════════════════════
   INIT
══════════════════════════════════════ */
(async function init() {
  try {
    await openDatabase();

    const [storedFolders, storedFiles] = await Promise.all([
      dbGetAll(STORE_FOLDERS),
      dbGetAll(STORE_FILES)
    ]);

    folders    = storedFolders.sort((a, b) => new Date(a.date) - new Date(b.date));
    repository = storedFiles.sort((a, b) => new Date(b.date) - new Date(a.date));
    totalIngested = repository.length;

    buildFolderSelect();
    updateStats();
    renderBreadcrumb();
    renderView();

    // restore admin session
    if (sessionStorage.getItem(SESSION_KEY) === 'true') {
      unlockAdmin(false);
    }

  } catch (err) {
    console.error(err);
    showStatus('Could not open database. Try Chrome or Edge.', 'error');
    renderView();
  }
})();

/* ══════════════════════════════════════
   ADMIN / PASSWORD
══════════════════════════════════════ */
function toggleAdminModal() {
  if (isAdmin) { logoutAdmin(); return; }
  document.getElementById('adminModal').classList.add('open');
  setTimeout(() => document.getElementById('adminPasswordInput').focus(), 80);
}
function closeAdminModal() {
  document.getElementById('adminModal').classList.remove('open');
  document.getElementById('adminPasswordInput').value = '';
  document.getElementById('adminError').style.display = 'none';
}
function submitAdminPassword() {
  const val = document.getElementById('adminPasswordInput').value;
  if (val === ADMIN_PASSWORD) {
    closeAdminModal();
    unlockAdmin(true);
    showToast('Welcome back, Mustapha! Upload unlocked.', 'success');
  } else {
    document.getElementById('adminError').style.display = 'block';
    document.getElementById('adminPasswordInput').value = '';
    document.getElementById('adminPasswordInput').focus();
  }
}
function unlockAdmin(save) {
  isAdmin = true;
  if (save) sessionStorage.setItem(SESSION_KEY, 'true');
  document.body.classList.add('admin-mode');
  const btn = document.getElementById('adminLockBtn');
  btn.textContent = '🔓';
  btn.classList.add('unlocked');
  btn.title = 'Lock upload';
}
function logoutAdmin() {
  if (!confirm('Lock upload controls?')) return;
  isAdmin = false;
  sessionStorage.removeItem(SESSION_KEY);
  document.body.classList.remove('admin-mode');
  const btn = document.getElementById('adminLockBtn');
  btn.textContent = '🔒';
  btn.classList.remove('unlocked');
  btn.title = 'Admin login';
  showToast('Upload locked', 'info');
}

/* ══════════════════════════════════════
   FOLDER SELECT (upload dropdown)
══════════════════════════════════════ */
function buildFolderSelect() {
  const sel = document.getElementById('folderSelect');
  sel.innerHTML = `<option value="">📁 Root (no folder)</option>` +
    folders.map(f => `<option value="${f.id}">📁 ${escHtml(f.name)}</option>`).join('');
  if (currentFolder) sel.value = currentFolder;
}

/* ══════════════════════════════════════
   NEW FOLDER MODAL
══════════════════════════════════════ */
function openFolderModal() {
  document.getElementById('folderNameInput').value = '';
  document.getElementById('folderModal').classList.add('open');
  setTimeout(() => document.getElementById('folderNameInput').focus(), 80);
}
function closeFolderModal() {
  document.getElementById('folderModal').classList.remove('open');
}
async function confirmNewFolder() {
  const name = document.getElementById('folderNameInput').value.trim();
  if (!name) { showToast('Please enter a folder name', 'error'); return; }

  const folder = { id: uid(), name, date: new Date().toISOString() };

  try {
    await dbPut(STORE_FOLDERS, folder);   // save permanently to IndexedDB
    folders.push(folder);
    buildFolderSelect();
    renderView();
    updateStats();
    closeFolderModal();
    showToast(`Folder "${name}" created`, 'success');
  } catch (err) {
    showToast('Could not create folder', 'error');
    console.error(err);
  }
}

/* ══════════════════════════════════════
   RENAME FOLDER MODAL
══════════════════════════════════════ */
function openRenameModal(id, e) {
  e.stopPropagation();
  renamingId = id;
  const f = folders.find(x => x.id === id);
  document.getElementById('renameInput').value = f ? f.name : '';
  document.getElementById('renameModal').classList.add('open');
  setTimeout(() => document.getElementById('renameInput').focus(), 80);
}
function closeRenameModal() {
  document.getElementById('renameModal').classList.remove('open');
  renamingId = null;
}
async function confirmRename() {
  const name = document.getElementById('renameInput').value.trim();
  if (!name) { showToast('Enter a folder name', 'error'); return; }

  const folder = folders.find(f => f.id === renamingId);
  if (!folder) return;

  folder.name = name;
  try {
    await dbPut(STORE_FOLDERS, folder);
    buildFolderSelect();
    renderBreadcrumb();
    renderView();
    closeRenameModal();
    showToast(`Renamed to "${name}"`, 'success');
  } catch (err) {
    showToast('Could not rename folder', 'error');
  }
}

/* ══════════════════════════════════════
   FOLDER NAVIGATION
══════════════════════════════════════ */
function openFolder(id) {
  folderStack.push(currentFolder);
  currentFolder = id;
  buildFolderSelect();
  renderBreadcrumb();
  renderView();
}
function goHome() {
  currentFolder = null;
  folderStack   = [];
  buildFolderSelect();
  renderBreadcrumb();
  renderView();
}
function goToStack(idx) {
  currentFolder = folderStack[idx];
  folderStack   = folderStack.slice(0, idx);
  buildFolderSelect();
  renderBreadcrumb();
  renderView();
}
function renderBreadcrumb() {
  const bc = document.getElementById('breadcrumb');
  let html = `<button onclick="goHome()">🏠 Root</button>`;

  folderStack.forEach((fid, i) => {
    const f = fid ? folders.find(x => x.id === fid) : null;
    if (f) html += `<span class="sep">›</span><button onclick="goToStack(${i})">${escHtml(f.name)}</button>`;
  });

  if (currentFolder) {
    const cur = folders.find(f => f.id === currentFolder);
    if (cur) html += `<span class="sep">›</span><span class="cur">${escHtml(cur.name)}</span>`;
  }

  bc.innerHTML = html;
}

/* ══════════════════════════════════════
   DELETE FOLDER
══════════════════════════════════════ */
async function deleteFolder(id, e) {
  e.stopPropagation();
  const f = folders.find(x => x.id === id);
  if (!f || !confirm(`Delete folder "${f.name}" and all files inside? Cannot be undone.`)) return;

  // delete all files inside this folder
  const inside = repository.filter(r => r.folderId === id);
  for (const file of inside) await dbDelete(STORE_FILES, file.id);
  repository = repository.filter(r => r.folderId !== id);

  // delete the folder itself
  await dbDelete(STORE_FOLDERS, id);
  folders = folders.filter(x => x.id !== id);

  totalIngested = repository.length;
  buildFolderSelect();
  updateStats();
  renderView();
  showToast(`Folder "${f.name}" deleted`, 'info');
}

/* ══════════════════════════════════════
   RENDER VIEW
══════════════════════════════════════ */
function renderView() {
  const ul = document.getElementById('repository');

  // folders only show at root level
  const viewFolders = currentFolder ? [] : folders;

  // files in current location
  const viewFiles = repository.filter(f =>
    currentFolder
      ? f.folderId === currentFolder
      : !f.folderId || f.folderId === ''
  );

  if (viewFolders.length === 0 && viewFiles.length === 0) {
    ul.innerHTML = `
      <div class="repo-empty">
        <div class="repo-empty-icon">${currentFolder ? '📂' : '🗂'}</div>
        <h3>${currentFolder ? 'Folder is empty' : 'Repository empty'}</h3>
        <p>${currentFolder
          ? 'Upload PDFs into this folder using the left panel.'
          : 'Create a folder or ingest PDFs to get started.'}</p>
      </div>`;
    document.getElementById('heroCount').textContent = repository.length;
    return;
  }

  ul.innerHTML = '';

  // render folders first
  for (const folder of viewFolders) {
    const count = repository.filter(f => f.folderId === folder.id).length;
    const li    = document.createElement('li');
    li.className = 'folder-item';
    li.onclick   = () => openFolder(folder.id);
    li.innerHTML = `
      <div class="folder-icon-wrap">📁</div>
      <div class="folder-info">
        <div class="folder-name">${escHtml(folder.name)}</div>
        <div class="folder-meta">${count} file${count !== 1 ? 's' : ''} · ${fmtDate(folder.date)}</div>
      </div>
      <div class="folder-actions">
        <button class="btn-icon admin-only" title="Rename"
                onclick="openRenameModal('${folder.id}', event)">✏️</button>
        <button class="btn-icon admin-only" title="Delete folder"
                onclick="deleteFolder('${folder.id}', event)">🗑</button>
      </div>`;
    ul.appendChild(li);
  }

  // render files
  for (let i = 0; i < viewFiles.length; i++) {
    const file = viewFiles[i];
    const li   = document.createElement('li');
    li.className  = 'repo-item';
    li.dataset.id = file.id;
    li.innerHTML  = `
      <div class="repo-index">${String(i + 1).padStart(2, '0')}</div>
      <div class="repo-icon">📄</div>
      <div class="repo-info">
        <div class="repo-name" title="${escHtml(file.name)}">${escHtml(file.name)}</div>
        <div class="repo-meta">
          <span>${file.sizeKB} KB</span>
          <span class="dot">·</span>
          <span>${fmtDate(file.date)}</span>
        </div>
      </div>
      <div class="repo-actions">
        <button class="btn-download" onclick="downloadFile('${file.id}')">⬇ Download</button>
        <button class="btn-icon admin-only" onclick="removeFile('${file.id}')" title="Remove">🗑</button>
      </div>`;
    ul.appendChild(li);
  }

  // re-apply admin-only visibility after rendering
  if (isAdmin) {
    document.querySelectorAll('.admin-only').forEach(el => {
      el.style.display = el.tagName === 'BUTTON' ? 'inline-flex' : 'flex';
    });
  }

  document.getElementById('heroCount').textContent = repository.length;
}

/* ══════════════════════════════════════
   DRAG & DROP
══════════════════════════════════════ */
function onDragOver(e) { e.preventDefault(); document.getElementById('dropZone').classList.add('drag-over'); }
function onDragLeave()  { document.getElementById('dropZone').classList.remove('drag-over'); }
function onDrop(e) { e.preventDefault(); onDragLeave(); if (e.dataTransfer.files.length) previewFiles(e.dataTransfer.files); }

/* ══════════════════════════════════════
   PREVIEW
══════════════════════════════════════ */
function previewFiles(fileList) {
  selectedFiles = Array.from(fileList);
  const preview = document.getElementById('filePreview');
  if (!selectedFiles.length) { preview.classList.remove('show'); return; }

  document.getElementById('filePreviewList').innerHTML = selectedFiles.map(f => {
    const ok = f.type === 'application/pdf';
    return `<div class="file-preview-item ${ok ? 'ok' : 'bad'}">
      ${ok ? '✓' : '✗'} ${escHtml(f.name)}${ok ? '' : ' <em>(not PDF)</em>'}
    </div>`;
  }).join('');

  preview.classList.add('show');
  clearStatus();
}

/* ══════════════════════════════════════
   INGEST
══════════════════════════════════════ */
async function ingestFiles() {
  if (!selectedFiles.length) { showStatus('Select at least one PDF file first.', 'info'); return; }

  const btn      = document.getElementById('uploadBtn');
  const pw       = document.getElementById('progressWrap');
  const pb       = document.getElementById('progressBar');
  const pl       = document.getElementById('progressLabel');
  const folderId = document.getElementById('folderSelect').value || null;

  btn.disabled = true;
  pw.classList.add('show');

  let successCount = 0;
  let failCount    = 0;

  /* for loop — inspect every file */
  for (let i = 0; i < selectedFiles.length; i++) {
    const file = selectedFiles[i];
    pb.style.width = ((i / selectedFiles.length) * 82 + 5) + '%';
    pl.textContent = `Saving "${file.name}"… (${i + 1}/${selectedFiles.length})`;

    /* continue skips non-PDFs */
    if (file.type !== 'application/pdf') { failCount++; continue; }

    try {
      const buffer = await readFileAsArrayBuffer(file);
      const record = {
        id:       uid(),
        name:     file.name,
        title:    file.name.replace(/\.pdf$/i, ''),
        size:     file.size,
        sizeKB:   (file.size / 1024).toFixed(1),
        type:     file.type,
        date:     new Date().toISOString(),
        folderId: folderId,
        buffer
      };
      await dbPut(STORE_FILES, record);   // permanently saved to IndexedDB
      repository.unshift(record);
      successCount++;
    } catch (err) {
      console.error(err);
      failCount++;
    }
  }

  pb.style.width = '100%';
  pl.textContent = 'Done!';
  totalIngested += successCount;
  totalFailed   += failCount;

  clearStatus();
  if (successCount > 0 && failCount === 0) {
    showStatus(`✓ Success: ${successCount} file${successCount > 1 ? 's' : ''} ingested.`, 'success');
  } else if (successCount > 0 && failCount > 0) {
    showStatus(`✓ Success: ${successCount} ingested, ${failCount} failed (not PDF).`, 'success');
  } else {
    showStatus(`✗ Failed: ${failCount} file${failCount > 1 ? 's' : ''} rejected — PDFs only.`, 'error');
  }

  updateStats();
  renderView();

  if (successCount > 0) showToast(`${successCount} PDF${successCount > 1 ? 's' : ''} saved permanently`, 'success');
  else showToast('No valid PDFs found', 'error');

  selectedFiles = [];
  document.getElementById('filePreview').classList.remove('show');
  document.getElementById('fileInput').value = '';
  btn.disabled = false;

  setTimeout(() => { pw.classList.remove('show'); pb.style.width = '0%'; }, 1400);
}

/* ══════════════════════════════════════
   DOWNLOAD
══════════════════════════════════════ */
function downloadFile(id) {
  const file = repository.find(f => f.id === id);
  if (!file || !file.buffer) { showToast('File data not found', 'error'); return; }
  const blob = new Blob([file.buffer], { type: 'application/pdf' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  showToast(`Downloading "${file.name}"`, 'info');
}

/* ══════════════════════════════════════
   REMOVE FILE
══════════════════════════════════════ */
async function removeFile(id) {
  const idx = repository.findIndex(f => f.id === id);
  if (idx === -1) return;
  if (!confirm(`Remove "${repository[idx].name}"?`)) return;
  await dbDelete(STORE_FILES, id);
  totalIngested = Math.max(0, totalIngested - 1);
  repository.splice(idx, 1);
  updateStats();
  renderView();
  showToast('File removed', 'info');
}

/* ══════════════════════════════════════
   CLEAR ALL
══════════════════════════════════════ */
async function clearRepository() {
  if (!repository.length && !folders.length) { showToast('Already empty', 'info'); return; }
  if (!confirm('Delete ALL files and folders permanently? Cannot be undone.')) return;
  await Promise.all([dbClear(STORE_FILES), dbClear(STORE_FOLDERS)]);
  repository.length = 0; folders.length = 0;
  totalIngested = 0; totalFailed = 0;
  currentFolder = null; folderStack = [];
  buildFolderSelect();
  updateStats();
  renderBreadcrumb();
  renderView();
  clearStatus();
  showToast('All cleared', 'info');
}

/* ══════════════════════════════════════
   STATS
══════════════════════════════════════ */
function updateStats() {
  const bytes = repository.reduce((a, f) => a + (f.size || 0), 0);
  document.getElementById('statIngested').textContent = totalIngested;
  document.getElementById('statFailed').textContent   = totalFailed;
  document.getElementById('statTotal').textContent    = repository.length;
  document.getElementById('statSize').textContent     = fmtSize(bytes);
  document.getElementById('heroCount').textContent    = repository.length;
}

/* ══════════════════════════════════════
   STATUS & TOAST
══════════════════════════════════════ */
function showStatus(msg, type = 'info') {
  document.getElementById('statusMessages').innerHTML =
    `<div class="status-line status-${type}">${msg}</div>`;
}
function clearStatus() { document.getElementById('statusMessages').innerHTML = ''; }

let toastTimer;
function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

/* ══════════════════════════════════════
   UTILITIES
══════════════════════════════════════ */
function uid() { return Date.now() + '_' + Math.random().toString(36).slice(2); }
function fmtSize(b) { if (!b||b<1024) return (b||0)+' B'; if (b<1048576) return (b/1024).toFixed(1)+' KB'; return (b/1048576).toFixed(1)+' MB'; }
function fmtDate(iso) { return new Date(iso).toLocaleDateString('en-NG', { day:'numeric', month:'short', year:'numeric' }); }
function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
