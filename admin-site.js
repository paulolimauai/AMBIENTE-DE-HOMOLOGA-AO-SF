/* Administração do Site — somente administradores.
   O servidor só entrega o conteúdo dos arquivos com token de administrador;
   sem ele a tela mostra "Acesso restrito". */
(function () {
  'use strict';

  var els = {
    loading: document.getElementById('adsLoading'),
    denied: document.getElementById('adsDenied'),
    body: document.getElementById('adsBody'),
    files: document.getElementById('adsFiles'),
    count: document.getElementById('adsCount'),
    fileName: document.getElementById('adsFileName'),
    fileMeta: document.getElementById('adsFileMeta'),
    preview: document.getElementById('adsPreview'),
    backupsBtn: document.getElementById('adsBackupsBtn'),
    save: document.getElementById('adsSave'),
    content: document.getElementById('adsContent'),
    status: document.getElementById('adsStatus'),
    modal: document.getElementById('adsModal'),
    modalTitle: document.getElementById('adsModalTitle'),
    modalBody: document.getElementById('adsModalBody'),
    modalClose: document.getElementById('adsModalClose'),
    reload: document.getElementById('adsReload')
  };

  var state = { files: [], current: null, dirty: false };

  function token() {
    try { return localStorage.getItem('nexus_token') || ''; } catch (e) { return ''; }
  }

  function api(path, options) {
    options = options || {};
    options.headers = Object.assign({ 'Authorization': 'Bearer ' + token() }, options.headers || {});
    return fetch(path, options).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { status: res.status, data: data };
      });
    });
  }

  function setStatus(msg, kind) {
    els.status.textContent = msg || '';
    els.status.className = 'ads-status' + (kind ? ' ' + kind : '');
  }

  function fmtSize(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function fmtDate(iso) {
    try { return new Date(iso).toLocaleString('pt-BR'); } catch (e) { return String(iso || ''); }
  }

  function showDenied() {
    els.loading.hidden = true;
    els.denied.hidden = false;
  }

  function showApp() {
    els.loading.hidden = true;
    els.denied.hidden = true;
    els.body.hidden = false;
  }

  function renderFiles() {
    els.files.innerHTML = '';
    state.files.forEach(function (f) {
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      if (state.current && state.current.name === f.name) btn.className = 'active';
      var label = document.createElement('span');
      label.textContent = f.name;
      var sub = document.createElement('small');
      sub.textContent = fmtSize(f.size) + ' · ' + (f.rota || '');
      btn.appendChild(label);
      btn.appendChild(sub);
      btn.addEventListener('click', function () { openFile(f.name); });
      li.appendChild(btn);
      els.files.appendChild(li);
    });
    els.count.textContent = state.files.length + ' arquivo(s) editável(is)';
  }

  function openFile(name) {
    if (state.dirty && !window.confirm('Há alterações não salvas em "' + (state.current ? state.current.name : '') + '". Descartar e abrir outro arquivo?')) return;
    state.dirty = false;
    api('/api/admin/site/file?name=' + encodeURIComponent(name)).then(function (r) {
      if (r.status === 401 || r.status === 403) { showDenied(); return; }
      if (!r.data || !r.data.success) { setStatus('Erro ao abrir o arquivo: ' + ((r.data && r.data.error) || r.status), 'err'); return; }
      state.current = r.data.file;
      els.fileName.textContent = r.data.file.name;
      els.fileMeta.textContent = fmtSize(r.data.file.size) + ' · modificado em ' + fmtDate(r.data.file.mtime) + ' · rota ' + (r.data.file.rota || '—');
      els.preview.href = r.data.file.rota || '#';
      els.content.value = r.data.content || '';
      setStatus('Pronto. Edite e clique em "Salvar alterações". Um backup é criado automaticamente a cada gravação.', 'ok');
      renderFiles();
    });
  }

  function loadFiles() {
    api('/api/admin/site/files').then(function (r) {
      if (r.status === 401 || r.status === 403) { showDenied(); return; }
      if (!r.data || !r.data.success) { showDenied(); return; }
      state.files = r.data.files || [];
      showApp();
      renderFiles();
      if (state.files.length) openFile(state.files[0].name);
      else setStatus('Nenhum arquivo editável encontrado.', 'err');
    }).catch(function () { showDenied(); });
  }

  function saveFile() {
    if (!state.current) return;
    els.save.disabled = true;
    setStatus('Salvando…');
    api('/api/admin/site/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: state.current.name, content: els.content.value })
    }).then(function (r) {
      els.save.disabled = false;
      if (r.status === 401 || r.status === 403) { showDenied(); return; }
      if (r.data && r.data.success) {
        state.dirty = false;
        state.current.size = r.data.size;
        state.current.mtime = r.data.mtime;
        var f = state.files.find(function (x) { return x.name === state.current.name; });
        if (f) { f.size = r.data.size; f.mtime = r.data.mtime; }
        setStatus('Salvo com sucesso' + (r.data.backup ? ' (backup: ' + r.data.backup + ')' : '') + '. A página já está no ar.', 'ok');
        renderFiles();
      } else {
        setStatus('Falha ao salvar: ' + ((r.data && r.data.error) || r.status), 'err');
      }
    }).catch(function () {
      els.save.disabled = false;
      setStatus('Falha de rede ao salvar.', 'err');
    });
  }

  function openModal(title, bodyHtml) {
    els.modalTitle.textContent = title;
    els.modalBody.innerHTML = bodyHtml;
    els.modal.hidden = false;
  }

  function loadBackups() {
    if (!state.current) return;
    openModal('Backups de ' + state.current.name, '<div class="ads-backup-empty">Carregando…</div>');
    api('/api/admin/site/backups?name=' + encodeURIComponent(state.current.name)).then(function (r) {
      if (r.status === 401 || r.status === 403) { showDenied(); return; }
      if (!r.data || !r.data.success) { openModal('Backups', '<div class="ads-backup-empty">Erro ao listar backups.</div>'); return; }
      var list = r.data.backups || [];
      if (!list.length) {
        openModal('Backups de ' + state.current.name, '<div class="ads-backup-empty">Nenhum backup ainda. O primeiro é criado na próxima gravação.</div>');
        return;
      }
      var html = '<div class="ads-backup-list">' + list.map(function (b) {
        return '<div class="ads-backup-item"><span class="when">' + esc(fmtDate(b.mtime)) + '</span>' +
          '<span class="size">' + fmtSize(b.size) + '</span>' +
          '<button class="ads-btn ghost" type="button" data-restore="' + esc(b.file) + '">Restaurar</button></div>';
      }).join('') + '</div>';
      openModal('Backups de ' + state.current.name + ' (' + list.length + ')', html);
      els.modalBody.querySelectorAll('[data-restore]').forEach(function (btn) {
        btn.addEventListener('click', function () { restoreBackup(btn.getAttribute('data-restore')); });
      });
    });
  }

  function restoreBackup(backupFile) {
    if (!state.current) return;
    if (!window.confirm('Restaurar o backup "' + backupFile + '"? O conteúdo atual será substituído (e um novo backup do estado atual será criado).')) return;
    api('/api/admin/site/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: state.current.name, backup: backupFile })
    }).then(function (r) {
      if (r.status === 401 || r.status === 403) { showDenied(); return; }
      if (r.data && r.data.success) {
        setStatus('Backup restaurado. Recarregando o arquivo…', 'ok');
        state.dirty = false;
        openFile(state.current.name);
      } else {
        setStatus('Falha ao restaurar: ' + ((r.data && r.data.error) || r.status), 'err');
      }
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  els.save.addEventListener('click', saveFile);
  els.reload.addEventListener('click', function () { loadFiles(); });
  els.backupsBtn.addEventListener('click', loadBackups);
  els.modalClose.addEventListener('click', function () { els.modal.hidden = true; });
  els.modal.addEventListener('click', function (e) { if (e.target === els.modal) els.modal.hidden = true; });
  els.content.addEventListener('input', function () { state.dirty = true; setStatus('Alterações não salvas.', ''); });
  window.addEventListener('beforeunload', function (e) {
    if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  loadFiles();
})();
