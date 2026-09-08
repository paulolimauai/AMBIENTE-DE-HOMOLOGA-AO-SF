
/* ==================== Gerenciamento de LocalStorage e Servidor ==================== */
function getApiBaseUrl() {
  try {
    if (typeof window !== 'undefined' && window.location) {
      const orig = window.location.origin;
      if (orig && orig.startsWith('http') && !orig.includes(':5500') && !orig.includes(':5501')) {
        return orig;
      }
    }
  } catch(e){}
  return 'http://localhost:3000';
}

function loadFromStorage(key, defaultVal) {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : defaultVal;
  } catch(e) {
    return defaultVal;
  }
}
function saveToStorage(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch(e) {
    console.warn('Aviso: Armazenamento local (localStorage) excedeu a cota máxima. Os dados são mantidos e salvos no SQL Server.', e);
  }
}

let registeredUsers = loadFromStorage('nexus_users', []);

// Alternador de Privacidade de Saldos Pós-Login (Balanço Oculto / Visível)
window.toggleSensitiveBalances = function() {
  const isHidden = document.body.classList.toggle('hide-sensitive-balances');
  const btnEyeIcon = document.getElementById('btnEyeIcon');
  const btnEyeText = document.getElementById('btnEyeText');
  const openEyeSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const closedEyeSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>';
  if (btnEyeIcon) btnEyeIcon.innerHTML = isHidden ? closedEyeSvg : openEyeSvg;
  if (btnEyeText) btnEyeText.textContent = isHidden ? 'Exibir Saldos' : 'Ocultar Saldos';
  document.querySelectorAll('.btnEyeIconCard').forEach(function(el) {
    el.innerHTML = isHidden ? closedEyeSvg : openEyeSvg;
  });
  try {
    localStorage.setItem('nexus_hide_balances', isHidden ? 'true' : 'false');
  } catch(e) {}
};

try {
  if (localStorage.getItem('nexus_hide_balances') === 'true') {
    setTimeout(function() {
      document.body.classList.add('hide-sensitive-balances');
      const btnEyeIcon = document.getElementById('btnEyeIcon');
      const btnEyeText = document.getElementById('btnEyeText');
      const closedEyeSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>';
      if (btnEyeIcon) btnEyeIcon.innerHTML = closedEyeSvg;
      if (btnEyeText) btnEyeText.textContent = 'Exibir Saldos';
      document.querySelectorAll('.btnEyeIconCard').forEach(function(el) {
        el.innerHTML = closedEyeSvg;
      });
    }, 100);
  }
} catch(e) {}

// Alternador de Abas de Autenticação (Entrar / Criar Conta / Acessos & Logon)
window.switchAuthTab = function(tab) {
  if (window.clearAuthFeedback) {
    window.clearAuthFeedback('login');
    window.clearAuthFeedback('register');
    window.clearAuthFeedback('forgot');
  }
  const loginBox = document.getElementById('loginBox');
  const regBox = document.getElementById('registerBox');
  const forgotBox = document.getElementById('forgotBox');
  const usersBox = document.getElementById('usersBox');
  const tabsNav = document.getElementById('authTabsNav');
  const tabLogin = document.getElementById('tabBtnLogin');
  const tabReg = document.getElementById('tabBtnRegister');
  const tabUsers = document.getElementById('tabBtnUsers');
  const subTitle = document.getElementById('authBoxSubtitle');

  if (tabLogin) tabLogin.classList.remove('active');
  if (tabReg) tabReg.classList.remove('active');
  if (tabUsers) tabUsers.classList.remove('active');

  if (tab === 'register') {
    if (loginBox) loginBox.style.display = 'none';
    if (forgotBox) forgotBox.style.display = 'none';
    if (usersBox) usersBox.style.display = 'none';
    if (regBox) regBox.style.display = 'block';
    if (tabsNav) tabsNav.style.display = 'flex';
    if (tabReg) tabReg.classList.add('active');
    if (subTitle) subTitle.textContent = 'Crie sua conta para começar a gerenciar suas finanças';
  } else if (tab === 'users') {
    if (loginBox) loginBox.style.display = 'none';
    if (regBox) regBox.style.display = 'none';
    if (forgotBox) forgotBox.style.display = 'none';
    if (usersBox) usersBox.style.display = 'block';
    if (tabsNav) tabsNav.style.display = 'flex';
    if (tabUsers) tabUsers.classList.add('active');
    if (subTitle) subTitle.textContent = 'Selecione um usuário cadastrado para logon imediato';
    carregarUsuariosLogonServer();
  } else if (tab === 'forgot') {
    if (loginBox) loginBox.style.display = 'none';
    if (regBox) regBox.style.display = 'none';
    if (usersBox) usersBox.style.display = 'none';
    if (forgotBox) forgotBox.style.display = 'block';
    if (tabsNav) tabsNav.style.display = 'none';
    if (subTitle) subTitle.textContent = 'Recuperação segura de acesso';
  } else {
    if (regBox) regBox.style.display = 'none';
    if (forgotBox) forgotBox.style.display = 'none';
    if (usersBox) usersBox.style.display = 'none';
    if (loginBox) loginBox.style.display = 'block';
    if (tabsNav) tabsNav.style.display = 'flex';
    if (tabLogin) tabLogin.classList.add('active');
    if (subTitle) subTitle.textContent = 'Plataforma Inteligente de Gestão Financeira';
  }
};

let listaUsuariosCadastradosServer = [];

window.carregarUsuariosLogonServer = async function() {
  const container = document.getElementById('usersListLogonContainerServer');
  const badgeCount = document.getElementById('registeredUsersBadgeCountServer');
  if (container) {
    container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--auth-text-dim); font-size:12px;">Carregando usuários cadastrados...</div>';
  }

  try {
    const res = await fetch(window.location.origin + '/api/users');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        listaUsuariosCadastradosServer = data;
      }
    }
  } catch(e) {}

  if (!listaUsuariosCadastradosServer || listaUsuariosCadastradosServer.length === 0) {
    listaUsuariosCadastradosServer = registeredUsers || [
      { name: 'Paulo Lima', email: 'admin@nexusfinanceiro.com', role: 'Administrador', active: true }
    ];
  }

  if (badgeCount) {
    badgeCount.textContent = listaUsuariosCadastradosServer.length;
  }

  renderUsuariosLogonServer(listaUsuariosCadastradosServer);
};

window.renderUsuariosLogonServer = function(users) {
  const container = document.getElementById('usersListLogonContainerServer');
  if (!container) return;

  if (!users || users.length === 0) {
    container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--auth-text-dim); font-size:12px;">Nenhum usuário cadastrado encontrado.</div>';
    return;
  }

  let html = '';
  users.forEach((u) => {
    const name = u.name || 'Usuário';
    const email = u.email || '';
    const role = u.role || 'Usuário';
    const isAdmin = role === 'Administrador';
    const initials = name.trim().split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
    const passSafe = u.password ? u.password.replace(/'/g, "\\'") : '';

    html += `
      <div style="padding:10px 12px; border-radius:12px; background:var(--card-bg, rgba(255,255,255,0.04)); border:1px solid var(--auth-border); display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <div style="display:flex; align-items:center; gap:10px; min-width:0;">
          <div style="width:34px; height:34px; border-radius:50%; background:${isAdmin ? 'linear-gradient(135deg, #F59E0B, #B45309)' : 'linear-gradient(135deg, #3B82F6, #1D4ED8)'}; color:#fff; font-weight:800; font-size:12px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
            ${initials}
          </div>
          <div style="min-width:0;">
            <div style="display:flex; align-items:center; gap:6px;">
              <strong style="font-size:13px; color:var(--auth-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${name}</strong>
              <span style="font-size:9.5px; font-weight:800; padding:1px 5px; border-radius:4px; text-transform:uppercase; background:${isAdmin ? 'rgba(245,158,11,0.2)' : 'rgba(59,130,246,0.2)'}; color:${isAdmin ? '#FBBF24' : '#60A5FA'};">${role}</span>
            </div>
            <div style="font-size:11.5px; color:var(--auth-text-dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${email}</div>
          </div>
        </div>
        <button type="button" onclick="selecionarUsuarioParaLogonServer('${email}', '${passSafe}', '${name.replace(/'/g, "\\'")}')" style="padding:6px 10px; border-radius:8px; font-size:11px; font-weight:800; background:rgba(245,158,11,0.15); color:var(--auth-gold); border:1px solid rgba(245,158,11,0.4); cursor:pointer; flex-shrink:0;">
          ⚡ Logon
        </button>
      </div>
    `;
  });

  container.innerHTML = html;
};

window.filtrarUsuariosLogonServer = function(query) {
  const q = (query || '').toLowerCase().trim();
  if (!q) {
    renderUsuariosLogonServer(listaUsuariosCadastradosServer);
    return;
  }
  const filtrados = listaUsuariosCadastradosServer.filter(u => 
    (u.name && u.name.toLowerCase().includes(q)) || 
    (u.email && u.email.toLowerCase().includes(q)) ||
    (u.role && u.role.toLowerCase().includes(q))
  );
  renderUsuariosLogonServer(filtrados);
};

window.selecionarUsuarioParaLogonServer = function(email, pass, name) {
  const emailInput = document.getElementById('loginEmail');
  const passInput = document.getElementById('loginPassword');
  if (emailInput) emailInput.value = email;
  if (passInput && pass) passInput.value = pass;

  window.switchAuthTab('login');

  const submitBtn = document.getElementById('loginSubmitBtn');
  if (submitBtn) submitBtn.focus();
};

window.showAuthFeedback = function(box, type, title, message, actionHtml) {
  const banner = document.getElementById(box + 'FeedbackBanner');
  if (!banner) return;

  banner.className = 'auth-feedback-banner ' + (type || 'error');
  const icon = type === 'success' ? '✅' : (type === 'warning' ? '⚠️' : '❌');

  banner.innerHTML = `
    <span style="font-size:18px; line-height:1; flex-shrink:0; margin-top:2px;">${icon}</span>
    <div style="flex:1;">
      <strong style="display:block; font-size:13.5px; font-weight:800; margin-bottom:2px; letter-spacing:-0.01em;">${title}</strong>
      <span style="font-size:12.5px; opacity:0.95; line-height:1.4;">${message}</span>
      ${actionHtml ? `<div style="margin-top:8px;">${actionHtml}</div>` : ''}
    </div>
  `;
  banner.style.display = 'flex';
};

window.clearAuthFeedback = function(box) {
  const banner = document.getElementById(box + 'FeedbackBanner');
  if (banner) banner.style.display = 'none';
  const emailWrap = document.getElementById('wrapLoginEmail');
  const passWrap = document.getElementById('wrapLoginPass');
  if (emailWrap) emailWrap.classList.remove('input-error');
  if (passWrap) passWrap.classList.remove('input-error');
};

window.switchToRegisterWithEmail = function(email) {
  window.switchAuthTab('register');
  const em = email || (document.getElementById('loginEmail') ? document.getElementById('loginEmail').value.trim() : '');
  const regEmailInput = document.getElementById('regEmail');
  if (regEmailInput) {
    if (em) regEmailInput.value = em;
    regEmailInput.focus();
  }
};

window.switchToForgotTab = function() {
  window.switchAuthTab('forgot');
};

// Alternador de Tema na Tela de Login
window.toggleAuthTheme = function() {
  const isLight = document.body.classList.contains('light') || document.documentElement.classList.contains('light');
  const nextLight = !isLight;
  document.body.classList.toggle('light', nextLight);
  document.documentElement.classList.toggle('light', nextLight);
  localStorage.setItem('nexus_theme', nextLight ? 'light' : 'dark');

  const icon = document.getElementById('authThemeIcon');
  if (icon) {
    if (nextLight) {
      icon.innerHTML = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M22 12h-2"/><path d="m4.93 19.07 1.41-1.41"/><path d="m17.66 6.34 1.41-1.41"/>';
    } else {
      icon.innerHTML = '<path d="M12 3a6 6 0 0 0 9 9 9 0 1 1-9-9Z"/>';
    }
  }
};

// Acesso Rápido VIP Administrador Master (1-Clique)
window.preencherCredenciaisAdmin = function() {
  const emailInput = document.getElementById('loginEmail');
  const passInput = document.getElementById('loginPassword');
  if (emailInput) emailInput.value = 'paulolp0101@gmail.com';
  if (passInput) passInput.value = '86266049';
  window.switchAuthTab('login');
  if (window.showAuthFeedback) {
    window.showAuthFeedback('login', 'success', 'Acesso Master', 'Credenciais carregadas com segurança. Entrando...');
  }
  setTimeout(() => {
    if (typeof window.handleLoginSubmit === 'function') {
      window.handleLoginSubmit();
    }
  }, 350);
};

// Relógio Oficial de Brasília DF (UTC-3)
(function initBrasiliaClockEngine() {
  function updateClock() {
    const el = document.getElementById('serverBrasiliaClock');
    if (!el) return;
    try {
      const now = new Date();
      el.textContent = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
      }).format(now);
    } catch(e) {
      const d = new Date();
      el.textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
    }
  }
  setInterval(updateClock, 1000);
  updateClock();
})();

// Ticker de Cotações Financeiras ao Vivo (Mercado 4K)
(function initServerTickerEngine() {
  const track = document.getElementById('serverTickerTrack');
  if (!track) return;

  const initialQuotes = [
    { id: 'usdBrl', sym: 'USD/BRL', val: 5.742, chg: '+0.38%', up: true, prefix: 'R$ ' },
    { id: 'eurBrl', sym: 'EUR/BRL', val: 6.218, chg: '-0.12%', up: false, prefix: 'R$ ' },
    { id: 'ibov', sym: 'IBOVESPA', val: 132850, chg: '+0.75%', up: true, suffix: ' pts' },
    { id: 'btc', sym: 'BITCOIN', val: 528940, chg: '+2.85%', up: true, prefix: 'R$ ' },
    { id: 'eth', sym: 'ETHEREUM', val: 18240, chg: '+1.95%', up: true, prefix: 'R$ ' },
    { id: 'sp500', sym: 'S&P 500', val: 5864, chg: '+0.42%', up: true, suffix: ' pts' },
    { id: 'cdi', sym: 'CDI', val: 10.75, chg: '10,75% a.a.', up: null, isStatic: true },
    { id: 'selic', sym: 'SELIC', val: 10.75, chg: '10,75%', up: null, isStatic: true },
    { id: 'ipca', sym: 'IPCA (12m)', val: 4.12, chg: '+4,12%', up: true, isStatic: true },
    { id: 'ouro', sym: 'OURO (g)', val: 488.50, chg: '+0.64%', up: true, prefix: 'R$ ' }
  ];

  function formatQuote(q) {
    if (q.isStatic) return (q.prefix || '') + q.val.toFixed(2).replace('.', ',') + '%' + (q.suffix || '');
    if (q.val >= 1000) return (q.prefix || '') + Math.round(q.val).toLocaleString('pt-BR') + (q.suffix || '');
    return (q.prefix || '') + q.val.toFixed(3).replace('.', ',') + (q.suffix || '');
  }

  function renderTrack() {
    let html = '';
    for (let loop = 0; loop < 2; loop++) {
      initialQuotes.forEach(q => {
        const chgClass = q.up === true ? 'up' : (q.up === false ? 'down' : 'neu');
        const chgIcon = q.up === true ? '▲ ' : (q.up === false ? '▼ ' : '• ');
        html += '<div class="ticker-item">' +
          '<span class="sym">' + q.sym + '</span>' +
          '<span class="val" id="st_' + loop + '_' + q.id + '">' + formatQuote(q) + '</span>' +
          '<span class="chg ' + chgClass + '">' + chgIcon + q.chg + '</span>' +
          '</div>';
      });
    }
    track.innerHTML = html;
  }
  renderTrack();

  setInterval(() => {
    const dynamic = initialQuotes.filter(q => !q.isStatic);
    const q = dynamic[Math.floor(Math.random() * dynamic.length)];
    const delta = (Math.random() * 0.4 - 0.18) / 100;
    q.val = Math.max(0.01, q.val * (1 + delta));
    q.up = delta >= 0;
    q.chg = (delta >= 0 ? '+' : '') + (delta * 100).toFixed(2).replace('.', ',') + '%';

    for (let loop = 0; loop < 2; loop++) {
      const el = document.getElementById('st_' + loop + '_' + q.id);
      if (el) el.textContent = formatQuote(q);
    }
  }, 2800);
})();

// Interatividade 3D Holographic Titanium Card
(function initTitaniumCardTilt() {
  const card = document.getElementById('holoTitaniumCard');
  const sheen = document.getElementById('holoSheen');
  if (!card) return;

  card.addEventListener('mousemove', (e) => {
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const tiltX = ((y - centerY) / centerY) * -12;
    const tiltY = ((x - centerX) / centerX) * 12;
    card.style.setProperty('--card-tilt-x', tiltX.toFixed(2) + 'deg');
    card.style.setProperty('--card-tilt-y', tiltY.toFixed(2) + 'deg');
    if (sheen) {
      sheen.style.setProperty('--glare-x', ((x / rect.width) * 100).toFixed(1) + '%');
      sheen.style.setProperty('--glare-y', ((y / rect.height) * 100).toFixed(1) + '%');
    }
  });

  card.addEventListener('mouseleave', () => {
    card.style.setProperty('--card-tilt-x', '0deg');
    card.style.setProperty('--card-tilt-y', '0deg');
  });
})();

// Mostrar/Ocultar Senha do Login (Visualização Clara do Olho)
window.togglePasswordVisibility = function(inputId, btnId) {
  const input = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  if (!input || !btn) return;
  if (input.type === 'password') {
    input.type = 'text';
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
    btn.title = 'Ocultar Senha';
    btn.setAttribute('aria-label', 'Ocultar Senha');
  } else {
    input.type = 'password';
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    btn.title = 'Visualizar Senha';
    btn.setAttribute('aria-label', 'Visualizar Senha');
  }
};

// Alternância de Visibilidade Unificada das Senhas no Cadastro (Olho Único que Revela Ambos os Campos)
window.toggleRegisterBothPasswords = function(btnId) {
  const p1 = document.getElementById('regPassword');
  const p2 = document.getElementById('regConfirmPassword');
  const btn = document.getElementById(btnId || 'toggleRegPassBtn');
  if (!p1) return;
  const isPassword = (p1.type === 'password');
  const nextType = isPassword ? 'text' : 'password';
  p1.type = nextType;
  if (p2) p2.type = nextType;
  if (btn) {
    if (isPassword) {
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
      btn.title = 'Ocultar Senhas';
      btn.setAttribute('aria-label', 'Ocultar Senhas');
    } else {
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
      btn.title = 'Visualizar Senhas';
      btn.setAttribute('aria-label', 'Visualizar Senhas');
    }
  }
};
window.toggleRegistrationPasswords = window.toggleRegisterBothPasswords;

// Detecção de Caps Lock no Login
document.addEventListener('keydown', function(e) {
  const capsWarn = document.getElementById('capsLockWarningLogin');
  if (capsWarn && e.getModifierState) {
    capsWarn.style.display = e.getModifierState('CapsLock') ? 'flex' : 'none';
  }
});
document.addEventListener('keyup', function(e) {
  const capsWarn = document.getElementById('capsLockWarningLogin');
  if (capsWarn && e.getModifierState) {
    capsWarn.style.display = e.getModifierState('CapsLock') ? 'flex' : 'none';
  }
});

async function syncUsersWithServer() {
  const apiBase = getApiBaseUrl();
  try {
    let res = await fetch(apiBase + '/api/users');
    if (!res.ok && apiBase !== 'http://localhost:3000') {
      try { res = await fetch('http://localhost:3000/api/users'); } catch(e){}
    }
    if (res && res.ok) {
      const usersData = await res.json();
      if (Array.isArray(usersData) && usersData.length > 0) {
        registeredUsers = usersData;
        saveToStorage('nexus_users', registeredUsers);
        if (window.carregarUsuariosLogonServer) window.carregarUsuariosLogonServer();
        return;
      }
    }
  } catch(e) {
    if (apiBase !== 'http://localhost:3000') {
      try {
        const fallbackRes = await fetch('http://localhost:3000/api/users');
        if (fallbackRes.ok) {
          const usersData = await fallbackRes.json();
          if (Array.isArray(usersData) && usersData.length > 0) {
            registeredUsers = usersData;
            saveToStorage('nexus_users', registeredUsers);
            if (window.carregarUsuariosLogonServer) window.carregarUsuariosLogonServer();
            return;
          }
        }
      } catch(retryErr){}
    }
    console.warn('Aviso: operando em modo offline ao sincronizar usuários:', e);
  }
  const cached = loadFromStorage('nexus_users', null);
  if (Array.isArray(cached) && cached.length > 0) {
    registeredUsers = cached;
  } else {
    registeredUsers = [
      { id: 3, name: 'Administrador', email: 'admin@nexusfinanceiro.com', password: '86266049', role: 'Administrador', active: true },
      { id: 4, name: 'Administrador', email: 'admin@nexusfinanceirohub.com.br', password: '86266049', role: 'Administrador', active: true }
    ];
    saveToStorage('nexus_users', registeredUsers);
  }
  if (window.carregarUsuariosLogonServer) window.carregarUsuariosLogonServer();
}

// Disparo imediato de sincronização de usuários no carregamento
syncUsersWithServer().catch(() => {});

async function saveUsersToServer() {
  saveToStorage('nexus_users', registeredUsers);
  const apiBase = getApiBaseUrl();
  try {
    await fetch(apiBase + '/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registeredUsers)
    });
  } catch(e){}
}

let currentUser = null;
let isViewingOtherUser = false;
let adminOriginalUser = null;

// Event Listeners das Abas e Tema de Autenticação
const tabLoginBtn = document.getElementById('tabBtnLogin');
if (tabLoginBtn) tabLoginBtn.onclick = () => window.switchAuthTab('login');

const tabRegBtn = document.getElementById('tabBtnRegister');
if (tabRegBtn) tabRegBtn.onclick = () => window.switchAuthTab('register');

const authThemeBtn = document.getElementById('authThemeToggleBtn');
if (authThemeBtn) authThemeBtn.onclick = () => window.toggleAuthTheme();

const loginPassToggle = document.getElementById('loginPasswordToggle') || document.getElementById('toggleLoginPassBtn');
if (loginPassToggle) loginPassToggle.onclick = () => window.togglePasswordVisibility('loginPassword', loginPassToggle.id);

const goForgot = document.getElementById('goForgot');
if (goForgot) goForgot.onclick = (e) => { e.preventDefault(); window.switchAuthTab('forgot'); };

const goLoginFromForgot = document.getElementById('goLoginFromForgot');
if (goLoginFromForgot) goLoginFromForgot.onclick = (e) => { e.preventDefault(); window.switchAuthTab('login'); };

const forgotFormElement = document.getElementById('forgotStep1') || document.getElementById('forgotForm');
if (forgotFormElement) {
  forgotFormElement.onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById('forgotEmail') ? document.getElementById('forgotEmail').value.trim() : '';
    const btn = document.getElementById('btnSendPassword');

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Enviando...';
    }

    try {
      const res = await fetch(window.location.origin + '/api/send-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();

      if (!data.success) {
        alert(data.error || 'Não encontramos nenhuma conta com esse e-mail ou falha no envio.');
        return;
      }

      if (data.mode === 'direct' && data.tempPassword) {
        alert('Sua senha temporária de acesso é: ' + data.tempPassword);
        const passInp = document.getElementById('loginPassword');
        if (passInp) passInp.value = data.tempPassword;
      } else {
        alert('Sua senha foi enviada para o seu e-mail com sucesso!');
      }

      const emailInp = document.getElementById('loginEmail');
      if (emailInp) emailInp.value = email;
      window.switchAuthTab('login');
    } catch(err) {
      alert('Erro ao processar solicitação de e-mail. Verifique suas credenciais SMTP no servidor.');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Recuperar Minha Senha →';
      }
    }
  };
}

// Limpa erros em tempo real conforme o usuário digita
const loginEmailEl = document.getElementById('loginEmail');
if (loginEmailEl) {
  loginEmailEl.addEventListener('input', () => {
    const wrap = document.getElementById('wrapLoginEmail');
    if (wrap) wrap.classList.remove('input-error');
    const banner = document.getElementById('loginFeedbackBanner');
    if (banner && banner.style.display !== 'none') banner.style.display = 'none';
  });
}
const loginPasswordEl = document.getElementById('loginPassword');
if (loginPasswordEl) {
  loginPasswordEl.addEventListener('input', () => {
    const wrap = document.getElementById('wrapLoginPass');
    if (wrap) wrap.classList.remove('input-error');
    const banner = document.getElementById('loginFeedbackBanner');
    if (banner && banner.style.display !== 'none') banner.style.display = 'none';
  });
}

// Auto-carregamento de E-mail Lembrado (Remember Me)
(function initRememberMeField() {
  try {
    const remEmail = localStorage.getItem('nexus_remembered_email');
    const emailInp = document.getElementById('loginEmail');
    const remCheck = document.getElementById('rememberMe');
    if (remEmail && emailInp) {
      emailInp.value = remEmail;
      if (remCheck) remCheck.checked = true;
    } else if (remCheck) {
      remCheck.checked = true;
    }
  } catch(e){}
})();

// Login direto contra o SQL Server / API com Validação Precisa em Tela e Fallback Offline
window.handleLoginSubmit = async function(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (window.clearAuthFeedback) window.clearAuthFeedback('login');

  const emailInput = document.getElementById('loginEmail');
  const passwordInput = document.getElementById('loginPassword');
  const rememberCheck = document.getElementById('rememberMe');
  const email = emailInput ? emailInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value.trim() : '';
  const submitBtn = document.getElementById('loginSubmitBtn') || document.querySelector('#loginForm button[type="submit"]') || document.querySelector('#authLoginForm button[type="submit"]');
  const emailWrap = document.getElementById('wrapLoginEmail');
  const passWrap = document.getElementById('wrapLoginPass');

  if (!email) {
    if (emailWrap) emailWrap.classList.add('input-error');
    if (emailInput) emailInput.focus();
    window.showAuthFeedback('login', 'error', 'E-mail não informado', 'Por favor, digite o seu endereço de e-mail para acessar sua conta.');
    return;
  }

  // Validação do formato do e-mail
  const isValidEmail = (str) => {
    if (!str || typeof str !== 'string') return false;
    const at = str.indexOf('@');
    const dot = str.lastIndexOf('.');
    return at > 0 && dot > at + 1 && dot < str.length - 1 && !str.includes(' ');
  };
  if (!isValidEmail(email)) {
    if (emailWrap) emailWrap.classList.add('input-error');
    if (emailInput) emailInput.focus();
    window.showAuthFeedback('login', 'error', 'E-mail em formato inválido', 'O e-mail digitado parece incompleto ou inválido. Exemplo: <strong>seu.nome@gmail.com</strong>');
    return;
  }
  
  const cleanEmail = email.toLowerCase().trim();

  // Persistência do checkbox Lembrar meu acesso
  if (rememberCheck && rememberCheck.checked) {
    localStorage.setItem('nexus_remembered_email', cleanEmail);
  } else if (rememberCheck && !rememberCheck.checked) {
    localStorage.removeItem('nexus_remembered_email');
  }
  const apiBase = getApiBaseUrl();
  let res = null;
  let data = null;

  try {
    res = await fetch(apiBase + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanEmail, password })
    });
    data = await res.json();
  } catch (fetchErr) {
    if (apiBase !== 'http://localhost:3000') {
      try {
        res = await fetch('http://localhost:3000/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: cleanEmail, password })
        });
        data = await res.json();
      } catch (retryErr) {}
    }
  }

  if (res && data) {
    if (!res.ok || !data.success) {
      if (data.errorType === 'user_not_found') {
        if (emailWrap) emailWrap.classList.add('input-error');
        if (emailInput) emailInput.focus();
        window.showAuthFeedback(
          'login',
          'warning',
          'Usuário não cadastrado',
          'Não encontramos nenhuma conta cadastrada para o e-mail <strong>' + cleanEmail + '</strong>.',
          '<button type="button" onclick="window.switchToRegisterWithEmail()" style="display:inline-flex; align-items:center; gap:6px; padding:7px 14px; font-size:12px; font-weight:800; background:linear-gradient(135deg, rgba(245,158,11,0.22) 0%, rgba(217,119,6,0.32) 100%); border:1px solid rgba(245,158,11,0.55); color:#FEF3C7; border-radius:9px; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.35), inset 0 1px 1px rgba(255,255,255,0.25);">Criar Conta com este E-mail →</button>'
        );
      } else if (data.errorType === 'invalid_password') {
        if (passWrap) passWrap.classList.add('input-error');
        if (passwordInput) {
          passwordInput.select();
          passwordInput.focus();
        }
        window.showAuthFeedback(
          'login',
          'error',
          'Senha incorreta',
          'A senha digitada está incorreta para este e-mail. Verifique se o Caps Lock está ativado ou recupere o acesso.',
          '<button type="button" onclick="window.switchToForgotTab()" style="display:inline-flex; align-items:center; gap:6px; padding:7px 14px; font-size:12px; font-weight:800; background:rgba(255,255,255,0.12); border:1px solid rgba(255,255,255,0.30); color:#FFFFFF; border-radius:9px; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.35), inset 0 1px 1px rgba(255,255,255,0.25);">Esqueci Minha Senha →</button>'
        );
      } else if (data.errorType === 'user_inactive') {
        window.showAuthFeedback('login', 'error', 'Conta desativada', data.error || 'Seu usuário foi desativado pelo administrador.');
      } else {
        window.showAuthFeedback('login', 'error', 'Falha na autenticação', data.error || 'E-mail ou senha incorretos.');
      }

      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Entrar na Conta →';
      }
      return;
    }

    currentUser = data.user;
    saveToStorage('nexus_session', { email: currentUser.email });
    saveToStorage('nexus_cached_user', currentUser);
    saveToStorage('nexus_token', data.token || ('token_' + Date.now()));
    
    // Notificação e sincronização imediata de last_login no SQL Server e Nuvem (Fuso Horário de Brasília)
    const nowLoginIso = new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace(' ', 'T') + '-03:00';
    try {
      const pingBody = JSON.stringify({ email: cleanEmail, last_login: nowLoginIso });
      fetch(apiBase + '/api/user/login-ping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: pingBody }).catch(() => {});
      if (apiBase !== 'http://localhost:3000') {
        fetch('http://localhost:3000/api/user/login-ping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: pingBody }).catch(() => {});
      }
    } catch(pingErr){}

    document.documentElement.classList.add('user-logged-in');
    if (currentUser.role === 'Administrador') {
      document.documentElement.classList.add('is-admin');
      currentPage = 'usuarios';
    } else {
      document.documentElement.classList.remove('is-admin');
      currentPage = 'dashboard';
    }

    await loadUserData();
    showLoginSuccessPopup('Redirecionando para o seu sistema...');
    setTimeout(() => {
      document.getElementById('authPage').classList.remove('show');
      document.getElementById('authPage').style.display = 'none';
      document.getElementById('appMain').classList.add('show');
      document.getElementById('appMain').style.display = 'flex';
      render();
    }, 1200);
    return;
  }

  // Fallback offline caso API esteja totalmente inacessível
  await syncUsersWithServer();
  const existingUser = registeredUsers.find(u => u && u.email && u.email.toLowerCase() === cleanEmail);
  if (!existingUser) {
    if (emailWrap) emailWrap.classList.add('input-error');
    if (emailInput) emailInput.focus();
    if (!res) {
      window.showAuthFeedback(
        'login',
        'error',
        'Servidor Backend Offline',
        'Não foi possível estabelecer conexão com o servidor local (<strong>localhost:3000</strong>). Certifique-se de que o comando <code>node server.js</code> está em execução no terminal.'
      );
    } else {
      window.showAuthFeedback(
        'login',
        'warning',
        'Usuário não cadastrado',
        'Não encontramos nenhuma conta cadastrada para o e-mail <strong>' + cleanEmail + '</strong>.',
        '<button type="button" onclick="window.switchToRegisterWithEmail()" style="display:inline-flex; align-items:center; gap:6px; padding:7px 14px; font-size:12px; font-weight:800; background:linear-gradient(135deg, rgba(245,158,11,0.22) 0%, rgba(217,119,6,0.32) 100%); border:1px solid rgba(245,158,11,0.55); color:#FEF3C7; border-radius:9px; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.35), inset 0 1px 1px rgba(255,255,255,0.25);">Criar Conta com este E-mail →</button>'
      );
    }
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Entrar na Conta →'; }
    return;
  }

  currentUser = { id: existingUser.id || Date.now(), name: existingUser.name || cleanEmail.split('@')[0], email: cleanEmail, role: existingUser.role || 'Usuário' };
  saveToStorage('nexus_session', { email: currentUser.email });
  saveToStorage('nexus_cached_user', currentUser);
  saveToStorage('nexus_token', 'offline_token_' + Date.now());

  document.documentElement.classList.add('user-logged-in');
  document.documentElement.classList.toggle('is-admin', currentUser.role === 'Administrador');
  currentPage = (currentUser.role === 'Administrador') ? 'usuarios' : 'dashboard';
  await loadUserData();
  showLoginSuccessPopup('Acesso offline autenticado!');
  setTimeout(() => {
    document.getElementById('authPage').classList.remove('show');
    document.getElementById('authPage').style.display = 'none';
    document.getElementById('appMain').classList.add('show');
    document.getElementById('appMain').style.display = 'flex';
    render();
  }, 1200);

  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Entrar na Conta →';
  }
};

const loginFormElement = document.getElementById('loginForm') || document.getElementById('authLoginForm');
if (loginFormElement) {
  loginFormElement.onsubmit = window.handleLoginSubmit;
}

function getGreetingTime() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return { text: 'Bom dia', icon: '☀️' };
  if (h >= 12 && h < 18) return { text: 'Boa tarde', icon: '🌤️' };
  return { text: 'Boa noite', icon: '🌙' };
}

function getFormattedToday() {
  const d = new Date();
  const weekDays = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  return weekDays[d.getDay()] + ', ' + d.getDate() + ' de ' + months[d.getMonth()] + ' de ' + d.getFullYear();
}

function showExecutiveWelcomeToast(msg, subMsg) {
  let toastEl = document.getElementById('executiveWelcomeToast');
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.id = 'executiveWelcomeToast';
    toastEl.className = 'executive-welcome-toast';
    document.body.appendChild(toastEl);
  }
  const userName = currentUser ? currentUser.name : 'Usuário';
  const userRole = currentUser ? (currentUser.role || 'Usuário') : 'Usuário';
  const roleBadge = userRole === 'Administrador' ? '👑 Administrador Master' : '👤 Usuário';
  
  toastEl.innerHTML = `
    <div class="toast-content-box">
      <div class="toast-icon-wrap">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          <path d="m9 12 2 2 4-4"/>
        </svg>
      </div>
      <div class="toast-body">
        <div class="toast-top-row">
          <span class="toast-badge">${roleBadge}</span>
          <span class="toast-time">Sessão Ativa</span>
        </div>
        <h4 class="toast-title">${msg || 'Sessão Autenticada com Sucesso'}</h4>
        <p class="toast-desc">${subMsg || ('Ambiente financeiro sincronizado e protegido para <strong>' + userName + '</strong>.')}</p>
      </div>
      <button type="button" class="toast-close-btn" onclick="document.getElementById('executiveWelcomeToast').classList.remove('show')" title="Fechar">✕</button>
    </div>
    <div class="toast-progress-bar"></div>
  `;

  requestAnimationFrame(() => {
    toastEl.classList.add('show');
  });

  if (toastEl._timeout) clearTimeout(toastEl._timeout);
  toastEl._timeout = setTimeout(() => {
    if (toastEl) toastEl.classList.remove('show');
  }, 4500);
}

function showLoginSuccessPopup(msg){
  const overlay = document.getElementById('loginSuccessOverlay');
  if(!overlay) return;
  if(msg) {
    const msgEl = document.getElementById('loginSuccessMsg');
    if(msgEl) msgEl.textContent = msg;
  }
  overlay.style.display = 'flex';
  overlay.classList.add('show');
  void overlay.offsetHeight;
  overlay.classList.add('in');
  setTimeout(()=>{
    overlay.classList.remove('in');
    setTimeout(()=>{
      overlay.classList.remove('show');
      overlay.style.display = 'none';
    }, 350);
  }, 2500);
}

function showAccountDisabledPopup(msg){
  const overlay = document.getElementById('accountDisabledOverlay');
  if(!overlay) return;
  if(msg) document.getElementById('accountDisabledMsg').textContent = msg;
  overlay.style.display = 'flex';
  overlay.classList.add('show');
  void overlay.offsetHeight;
  overlay.classList.add('in');
}
function hideAccountDisabledPopup(){
  const overlay = document.getElementById('accountDisabledOverlay');
  if(!overlay) return;
  overlay.classList.remove('in');
  setTimeout(()=> {
    overlay.classList.remove('show');
    overlay.style.display = 'none';
  }, 300);
}

let logoutTimer = null;
function showLogoutPopup(msg){
  const overlay = document.getElementById('logoutSuccessOverlay');
  if(!overlay) return;
  if(msg) {
    const msgEl = document.getElementById('logoutSuccessMsg');
    if(msgEl) msgEl.textContent = msg;
  }
  overlay.style.display = 'flex';
  overlay.classList.add('show');
  void overlay.offsetHeight;
  overlay.classList.add('in');

  const prog = document.getElementById('logoutTimerProgress');
  if (prog) {
    prog.style.transition = 'none';
    prog.style.width = '100%';
    void prog.offsetHeight;
    prog.style.transition = 'width 4.5s linear';
    prog.style.width = '0%';
  }

  setTimeout(() => {
    const loginEmailInput = document.getElementById('loginEmail');
    if (loginEmailInput) loginEmailInput.focus();
  }, 80);

  if (logoutTimer) clearTimeout(logoutTimer);
  logoutTimer = setTimeout(() => {
    hideLogoutPopup();
  }, 4500);

  const box = overlay.querySelector('.logout-box');
  if (box) {
    box.onmouseenter = () => {
      if (logoutTimer) clearTimeout(logoutTimer);
      if (prog) {
        const computedWidth = window.getComputedStyle(prog).width;
        prog.style.transition = 'none';
        prog.style.width = computedWidth;
      }
    };
    box.onmouseleave = () => {
      if (logoutTimer) clearTimeout(logoutTimer);
      logoutTimer = setTimeout(() => hideLogoutPopup(), 2500);
    };
  }
}

function hideLogoutPopup(){
  const overlay = document.getElementById('logoutSuccessOverlay');
  if(!overlay) return;
  if (logoutTimer) {
    clearTimeout(logoutTimer);
    logoutTimer = null;
  }
  overlay.classList.remove('in');
  setTimeout(()=> {
    overlay.classList.remove('show');
    overlay.style.display = 'none';
    const loginEmailInput = document.getElementById('loginEmail');
    if (loginEmailInput) loginEmailInput.focus();
  }, 320);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const logoutOverlay = document.getElementById('logoutSuccessOverlay');
    if (logoutOverlay && logoutOverlay.classList.contains('show')) {
      hideLogoutPopup();
    }
  }
});

window.checkServerRegPasswordMatch = function() {
  const p1 = document.getElementById('regPassword') ? document.getElementById('regPassword').value : '';
  const p2 = document.getElementById('regConfirmPassword') ? document.getElementById('regConfirmPassword').value : '';
  const msg = document.getElementById('regPwdMatchMsg');
  if (!msg) return;

  if (!p2) {
    msg.style.display = 'none';
    return;
  }

  msg.style.display = 'flex';
  if (p1 === p2) {
    msg.textContent = '✓ As senhas conferem';
    msg.style.color = '#34d399';
  } else {
    msg.textContent = '✕ As senhas não conferem';
    msg.style.color = '#f87171';
  }
};

window.isValidCPFServer = function(cpf) {
  if (!cpf) return false;
  const clean = cpf.replace(/[^0-9]/g, '');
  if (clean.length !== 11) return false;
  if (clean.split('').every(function(c) { return c === clean[0]; })) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(clean.charAt(i), 10) * (10 - i);
  let rev = 11 - (sum % 11);
  if (rev === 10 || rev === 11) rev = 0;
  if (rev !== parseInt(clean.charAt(9), 10)) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(clean.charAt(i), 10) * (11 - i);
  rev = 11 - (sum % 11);
  if (rev === 10 || rev === 11) rev = 0;
  if (rev !== parseInt(clean.charAt(10), 10)) return false;
  return true;
};

// Máscara e Validação de CPF no Cadastro (Preenchimento manual dos dados cadastrais)
window.handleServerCpfInput = function(input) {
  const rawDigits = input.value.replace(/[^0-9]/g, '').slice(0, 11);
  let v = rawDigits;
  if (v.length > 9) v = v.replace(/([0-9]{3})([0-9]{3})([0-9]{3})([0-9]{1,2})/, '$1.$2.$3-$4');
  else if (v.length > 6) v = v.replace(/([0-9]{3})([0-9]{3})([0-9]{1,3})/, '$1.$2.$3');
  else if (v.length > 3) v = v.replace(/([0-9]{3})([0-9]{1,3})/, '$1.$2');
  input.value = v;

  const msg = document.getElementById('regCpfFeedbackMsg');

  if (rawDigits.length === 11) {
    if (!window.isValidCPFServer(rawDigits)) {
      if (msg) {
        msg.style.display = 'block';
        msg.textContent = '✕ CPF Inválido perante a Receita Federal';
        msg.style.color = '#f87171';
      }
      return;
    }

    if (msg) {
      msg.style.display = 'block';
      msg.textContent = '✓ CPF Válido';
      msg.style.color = '#34d399';
    }
  } else {
    if (msg) msg.style.display = 'none';
  }
};

window.handleServerBirthInput = function(input) {
  let v = input.value.replace(/[^0-9]/g, '').slice(0, 8);
  if (v.length > 4) v = v.replace(/([0-9]{2})([0-9]{2})([0-9]{1,4})/, '$1/$2/$3');
  else if (v.length > 2) v = v.replace(/([0-9]{2})([0-9]{1,2})/, '$1/$2');
  input.value = v;
};

window.handleServerPhoneInput = function(input) {
  let v = input.value.replace(/[^0-9]/g, '').slice(0, 11);
  if (v.length > 10) v = v.replace(/([0-9]{2})([0-9]{5})([0-9]{4})/, '($1) $2-$3');
  else if (v.length > 6) v = v.replace(/([0-9]{2})([0-9]{4})([0-9]{0,4})/, '($1) $2-$3');
  else if (v.length > 2) v = v.replace(/([0-9]{2})([0-9]{0,5})/, '($1) $2');
  else if (v.length > 0) v = v.replace(/([0-9]{0,2})/, '($1');
  input.value = v;
};

// Cadastro com padrão financeiro completo, inserção direta no SQL Server e fallback resiliente
window.handleRegisterSubmit = async function(e) {
  if (e && e.preventDefault) e.preventDefault();
  const nameInput = document.getElementById('regName');
  const cpfInput = document.getElementById('regCpf');
  const birthInput = document.getElementById('regBirthDate');
  const phoneInput = document.getElementById('regPhone');
  const emailInput = document.getElementById('regEmail');
  const passwordInput = document.getElementById('regPassword');
  const confirmPasswordInput = document.getElementById('regConfirmPassword');
  const termsInput = document.getElementById('regTerms');
  const truthfulInput = document.getElementById('regTruthful');

  const name = nameInput ? nameInput.value.trim() : '';
  const cpf = cpfInput ? cpfInput.value.trim() : '';
  const birthDate = birthInput ? birthInput.value.trim() : '';
  const phone = phoneInput ? phoneInput.value.trim() : '';
  const email = emailInput ? emailInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value.trim() : '';
  const confirmPassword = confirmPasswordInput ? confirmPasswordInput.value.trim() : '';
  const submitBtn = document.getElementById('regSubmitBtn') || document.querySelector('#registerForm button[type="submit"]');

  const cleanEmail = email.toLowerCase().trim();

  // 1. Validação de Nome Completo
  if (!name || name.split(' ').filter(p => p.length > 1).length < 2) {
    showCustomAlert('Atenção', 'Por favor, informe seu Nome Completo do titular (conforme documento oficial).', 'error');
    if (nameInput) nameInput.focus();
    return false;
  }

  // 2. Validação de CPF
  if (!cpf || !window.isValidCPFServer(cpf)) {
    showCustomAlert('Atenção', 'Por favor, informe um CPF válido e regularizado na Receita Federal.', 'error');
    if (cpfInput) cpfInput.focus();
    return false;
  }

  // 3. Validação de Data de Nascimento e Maioridade
  if (!birthDate || birthDate.length < 10) {
    showCustomAlert('Atenção', 'Por favor, informe sua Data de Nascimento (DD/MM/AAAA).', 'error');
    if (birthInput) birthInput.focus();
    return false;
  }

  // 4. Validação de Celular com DDD
  if (!phone || phone.replace(/[^0-9]/g, '').length < 10) {
    showCustomAlert('Atenção', 'Por favor, informe seu telefone Celular com DDD para autenticação e 2FA.', 'error');
    if (phoneInput) phoneInput.focus();
    return false;
  }

  // 5. Validação de E-mail
  if (!cleanEmail.includes('@') || !cleanEmail.includes('.')) {
    showCustomAlert('Atenção', 'Por favor, informe um endereço de e-mail válido (ex: seu.email@exemplo.com).', 'error');
    if (emailInput) emailInput.focus();
    return false;
  }

  // 6. Validação de Senha Forte Financeira
  if (password.length < 8) {
    showCustomAlert('Atenção', 'Padrão financeiro: a senha deve possuir no mínimo 8 caracteres.', 'error');
    if (passwordInput) passwordInput.focus();
    return false;
  }

  const hasUpperLower = /[a-z]/.test(password) && /[A-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  if (!hasUpperLower || !hasNumber || !hasSpecial) {
    showCustomAlert('Atenção', 'A senha financeira deve conter letras maiúsculas, minúsculas, ao menos um número e um caractere especial (@#$%).', 'error');
    if (passwordInput) passwordInput.focus();
    return false;
  }

  // 7. Confirmação de Senha
  if (password !== confirmPassword) {
    showCustomAlert('Atenção', 'As senhas não conferem. Por favor, digite a mesma senha nos dois campos.', 'error');
    if (confirmPasswordInput) confirmPasswordInput.focus();
    return false;
  }

  // 8. Termos e Declaração
  if (termsInput && !termsInput.checked) {
    showCustomAlert('Atenção', 'É obrigatório aceitar os Termos de Abertura de Conta e a Política de Privacidade LGPD.', 'error');
    return false;
  }
  if (truthfulInput && !truthfulInput.checked) {
    showCustomAlert('Atenção', 'É obrigatório declarar a veracidade das informações prestadas sob as penas da lei.', 'error');
    return false;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Validando conta bancária...';
  }

  let registerSuccess = false;
  let serverMessage = '';

  const apiBase = getApiBaseUrl();
  let response = null;
  let data = null;

  const payload = {
    name,
    email: cleanEmail,
    password,
    cpf,
    birth_date: birthDate,
    phone,
    terms_accepted: true
  };

  try {
    try {
      response = await fetch(apiBase + '/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      data = await response.json();
    } catch (e) {
      if (apiBase !== 'http://localhost:3000') {
        try {
          response = await fetch('http://localhost:3000/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          data = await response.json();
        } catch (retryErr) {}
      }
    }

    if (response && response.ok && data && data.success) {
      registerSuccess = true;
      serverMessage = data.message || 'Conta financeira criada e salva no banco de dados com sucesso!';
      await syncUsersWithServer();
    } else if (data && data.error) {
      showCustomAlert('Atenção', data.error, 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Concluir Abertura de Conta →';
      }
      return false;
    } else {
      throw new Error('Falha de comunicação com a API');
    }
  } catch (err) {
    console.warn('[CADASTRO RESILIENTE] Falha na API de registro, salvando localmente:', err.message);
    const existingIndex = registeredUsers.findIndex(u => u.email && u.email.toLowerCase() === cleanEmail);
    const localUserObj = { id: Date.now(), name, email: cleanEmail, password, cpf, birth_date: birthDate, phone, role: 'Usuário', active: true, terms_accepted: true };
    if (existingIndex >= 0) {
      registeredUsers[existingIndex] = { ...registeredUsers[existingIndex], ...localUserObj };
    } else {
      registeredUsers.push(localUserObj);
    }
    saveUsersToServer();
    registerSuccess = true;
    serverMessage = 'Conta salva com sucesso! Faça login para continuar.';
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Concluir Abertura de Conta →';
    }
  }

  if (registerSuccess) {
    if (nameInput) nameInput.value = '';
    if (emailInput) emailInput.value = '';
    if (passwordInput) passwordInput.value = '';
    if (confirmPasswordInput) confirmPasswordInput.value = '';
    const regMsg = document.getElementById('regPwdMatchMsg');
    if (regMsg) regMsg.style.display = 'none';

    const loginEmail = document.getElementById('loginEmail');
    const loginPass = document.getElementById('loginPassword');
    if (loginEmail) loginEmail.value = cleanEmail;
    if (loginPass) loginPass.value = password;

    if (window.carregarUsuariosLogonServer) window.carregarUsuariosLogonServer();

    window.switchAuthTab('login');
    const loginBtn = document.getElementById('loginSubmitBtn');
    if (loginBtn) loginBtn.focus();

    showCustomAlert('Cadastro Realizado com Sucesso! 🎉', 'Conta criada com sucesso! Suas credenciais foram sincronizadas. Clique em OK para entrar agora.', 'success', () => {
      if (typeof window.handleLoginSubmit === 'function') window.handleLoginSubmit();
    });

    setTimeout(() => {
      const modal = document.getElementById('executive4kModal');
      if (modal && modal.style.display !== 'none') {
        modal.style.display = 'none';
        if (typeof window.handleLoginSubmit === 'function') window.handleLoginSubmit();
      }
    }, 1200);
  }
  return false;
};

const registerFormElem = document.getElementById('registerForm') || document.getElementById('authRegisterForm');
if (registerFormElem) {
  registerFormElem.onsubmit = window.handleRegisterSubmit;
}

// Logout seguro sem deletar as credenciais persistidas
const logoutButton = document.getElementById('logoutBtn');
if (logoutButton) {
  logoutButton.onclick = async () => {
    try { await saveUserData(); } catch(e){}
    resetUserDataState();
    currentUser = null;
    isViewingOtherUser = false;
    adminOriginalUser = null;
    isDataLoading = false;
    localStorage.removeItem('nexus_session');
    localStorage.removeItem('nexus_cached_user');
    localStorage.removeItem('nexus_token');
    localStorage.removeItem('nexus_viewing_user');
    document.documentElement.classList.remove('user-logged-in');
    document.documentElement.classList.remove('is-admin');
    const appMain = document.getElementById('appMain');
    const authPage = document.getElementById('authPage');
    if (appMain) {
      appMain.classList.remove('show');
      appMain.style.display = 'none';
    }
    if (authPage) {
      authPage.classList.add('show');
      authPage.style.display = 'flex';
    }
    showLogoutPopup('Você saiu da sua conta com segurança. Suas informações estão salvas e protegidas no banco de dados.');
  };
}

/* ==================== Isolamento de Dados por Usuário ==================== */
let categories = [];
let accounts = [];
let transactions = [];
let budgets = [];
let goals = [];
let recurringList = [];
let alerts = [];
let attachments = [];
let notifications = [];

let nextAccId = 1, nextTxId = 1, nextBudgetId = 1, nextGoalId = 1, nextRecId = 1, nextAlertId = 1, nextAttId = 1, nextNotifId = 1;

/* ==================== Migração: tipo de categoria ==================== */
const RECEITA_NAME_HINTS = ['salário','salario','renda','freela','freelance','bônus','bonus','valor extra','extra','13º','decimo terceiro','décimo terceiro','rendimento','dividendo','investimento','reembolso'];
const BASE_CATEGORIES = [
  {name:'Alimentação', color:'#e8974b', type:'despesa', icon:'🍔'},
  {name:'Supermercado', color:'#d8a34b', type:'despesa', icon:'🛒'},
  {name:'Moradia', color:'#c98a3f', type:'despesa', icon:'🏠'},
  {name:'Contas da Casa', color:'#f0a63a', type:'despesa', icon:'💡'},
  {name:'Transporte', color:'#ef5a5a', type:'despesa', icon:'🚗'},
  {name:'Saúde', color:'#5ac57e', type:'despesa', icon:'⚕️'},
  {name:'Educação', color:'#4a90e2', type:'despesa', icon:'📚'},
  {name:'Lazer', color:'#9b6bd8', type:'despesa', icon:'🎮'},
  {name:'Vestuário', color:'#d85bb0', type:'despesa', icon:'👕'},
  {name:'Assinaturas', color:'#6b7fd7', type:'despesa', icon:'📺'},
  {name:'Cartão de Crédito', color:'#e8b04b', type:'despesa', icon:'💳'},
  {name:'Pix Enviado', color:'#f0a63a', type:'despesa', icon:'📤'},
  {name:'Cuidados Pessoais', color:'#e07bb0', type:'despesa', icon:'💆'},
  {name:'Outros', color:'#8a93a3', type:'despesa', icon:'📦'},
  {name:'Salário', color:'#e8b04b', type:'receita', icon:'💼'},
  {name:'Freelance', color:'#4a90e2', type:'receita', icon:'💻'},
  {name:'Investimentos', color:'#5ac57e', type:'receita', icon:'📈'},
  {name:'Pix Recebido', color:'#3ec7c7', type:'receita', icon:'📥'},
  {name:'Reembolso', color:'#6bcf9e', type:'receita', icon:'💵'},
  {name:'Bônus / 13º', color:'#d8a34b', type:'receita', icon:'🎉'},
  {name:'Outras Receitas', color:'#8a93a3', type:'receita', icon:'💰'}
];

const DEFAULT_ACCOUNTS = [];
const DEFAULT_TRANSACTIONS = [];

function isCurrentAdmin() {
  if (!currentUser) return false;
  if (currentUser.role === 'Administrador') return true;
  const e = (currentUser.email || '').toLowerCase().trim();
  return e === 'admin@nexusfinanceiro.com';
}

function resetUserDataState() {
  categories = BASE_CATEGORIES.map(c => ({ ...c, count: 0 }));
  accounts = [];
  transactions = [];
  nextAccId = 1;
  nextTxId = 1;
  budgets = [];
  goals = [];
  recurringList = [];
  alerts = [];
  attachments = [];
  notifications = [];
  nextBudgetId = 1;
  nextGoalId = 1;
  nextRecId = 1;
  nextAlertId = 1;
  nextAttId = 1;
  nextNotifId = 1;
}

function migrateCategories(){
  let changed = false;
  categories.forEach(c=>{
    if(!c.type){
      const lower = c.name.toLowerCase();
      c.type = RECEITA_NAME_HINTS.some(h=>lower.includes(h)) ? 'receita' : 'despesa';
      changed = true;
    }
    if(!c.icon){
      c.icon = c.type==='receita' ? '💰' : '📁';
      changed = true;
    }
    if(typeof c.count !== 'number'){
      c.count = 0;
      changed = true;
    }
  });
  BASE_CATEGORIES.forEach(dc=>{
    if(!categories.some(c=>c.name.toLowerCase()===dc.name.toLowerCase())){
      categories.push({...dc, count:0});
      changed = true;
    }
  });
  if(changed) saveUserData();
}

function parseInputValue(valStr) {
  if (typeof valStr === 'number') return isNaN(valStr) ? 0 : Math.abs(valStr);
  if (!valStr) return 0;
  let cleaned = String(valStr).replace(/[^0-9.,-]/g, '').trim();
  if (cleaned.includes(',') && cleaned.includes('.')) {
    if (cleaned.indexOf('.') < cleaned.indexOf(',')) {
      cleaned = cleaned.replace(/./g, '').replace(',', '.');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (cleaned.includes(',')) {
    cleaned = cleaned.replace(',', '.');
  }
  const num = Math.abs(parseFloat(cleaned));
  return isNaN(num) ? 0 : num;
}

function autoMigrateTransactionsAndAccounts() {
  if (!accounts || accounts.length === 0) return;
  let changed = false;

  transactions.forEach(t => {
    // 0. Garante que t.val é um número float válido positivo
    const parsedVal = parseInputValue(t.val);
    if (t.val !== parsedVal) {
      t.val = parsedVal;
      changed = true;
    }

    // 1. Se t.accId aponta para um ID de conta que não existe mais, reseta para relinkar
    if (t.accId != null && !accounts.some(a => String(a.id) === String(t.accId))) {
      t.accId = null;
      changed = true;
    }

    // 2. Se a transação possui t.acc que corresponde ao nome exato de uma conta, vincula ao ID exato dessa conta
    if (t.acc) {
      const exactMatch = accounts.find(a => a.name.toLowerCase().trim() === String(t.acc).toLowerCase().trim());
      if (exactMatch && (String(t.accId) !== String(exactMatch.id) || t.acc !== exactMatch.name)) {
        t.accId = exactMatch.id;
        t.acc = exactMatch.name;
        changed = true;
      }
    }

    // 3. Se t.desc, t.cat ou t.card menciona o nome de um cartão específico, vincula ao ID desse cartão
    const descText = ((t.desc || '') + ' ' + (t.cat || '') + ' ' + (t.acc || '') + ' ' + (t.card || '')).toLowerCase().trim();
    if (descText) {
      const cardMatch = accounts.find(a => {
        if (!isAccountCreditCard(a)) return false;
        const aName = a.name.toLowerCase().trim();
        const normName = normalizeAccName(a.name);
        return (normName.length >= 3 && descText.includes(normName)) || (aName.length >= 3 && descText.includes(aName));
      });
      if (cardMatch && (String(t.accId) !== String(cardMatch.id) || (t.acc === 'Cartão de Crédito' || !t.acc))) {
        t.accId = cardMatch.id;
        t.acc = cardMatch.name;
        changed = true;
      }
    }

    // 4. Se a transação não tem accId válido, encontra a conta correspondente via isTxForAccount
    if (t.accId == null) {
      const match = accounts.find(a => isTxForAccount(t, a));
      if (match) {
        t.accId = match.id;
        t.acc = match.name;
        changed = true;
      }
    }
  });

  // 5. Atualiza ícones genéricos (📁) das categorias para ícones semânticos profissionais
  if (Array.isArray(categories)) {
    categories.forEach(c => {
      if (!c.icon || c.icon === '📁') {
        const smartIcon = getCategoryIcon(c.name);
        if (smartIcon !== '📁') {
          c.icon = smartIcon;
          changed = true;
        }
      }
    });
  }

  if (changed && typeof saveUserData === 'function') {
    saveUserData();
  }
}

function autoCompleteAllRecurringMonths() {
  if (!Array.isArray(recurringList) || recurringList.length === 0) return false;
  let changed = false;
  recurringList.forEach(r => {
    const totalM = r.totalMonths ? parseInt(r.totalMonths) : 0;
    const appliedM = r.appliedMonths ? parseInt(r.appliedMonths) : 0;
    if (totalM > 0 && appliedM < totalM) {
      const targetAcc = accounts.find(a => a.name === r.acc);
      const accId = targetAcc ? targetAcc.id : null;
      const finalAccName = targetAcc ? targetAcc.name : r.acc;
      const startM = r.startMonth || 1;
      const startY = r.startYear || new Date().getFullYear();
      const detectedMethod = r.paymentMethod || (typeof detectPaymentMethodFromName === 'function' ? detectPaymentMethodFromName(r.desc) : null) || ((r.cat && r.cat.toLowerCase().includes('cartão')) || (r.acc && r.acc.toLowerCase().includes('cartão')) ? 'Cartão de Crédito' : 'Boleto');

      if (!Array.isArray(r.appliedPeriods)) r.appliedPeriods = [];

      for (let k = appliedM + 1; k <= totalM; k++) {
        const monthZero = (startM - 1) + (k - 1);
        const y = startY + Math.floor(monthZero / 12);
        const m = (monthZero % 12) + 1;
        const date = pdCustom(y, m, r.day);
        const itemDesc = r.desc + ' (' + k + '/' + totalM + ')';

        // Evita duplicar se ja foi gerado
        const alreadyExists = transactions.some(t => t.recurringId === r.id && t.installment === (k + '/' + totalM));
        if (!alreadyExists) {
          transactions.unshift({
            id: nextTxId++,
            desc: itemDesc,
            val: r.val,
            date: date,
            cat: r.cat,
            acc: finalAccName,
            accId: accId,
            status: 'Pendente',
            type: r.type || 'out',
            installment: k + '/' + totalM,
            recurringId: r.id,
            paymentMethod: detectedMethod
          });
        }
        const periodKey = y + '-' + String(m).padStart(2, '0');
        if (!r.appliedPeriods.includes(periodKey)) {
          r.appliedPeriods.push(periodKey);
        }
      }

      r.appliedMonths = totalM;
      r.paymentMethod = detectedMethod;
      changed = true;
    }
  });
  return changed;
}

function applyDataPayload(data) {
  resetUserDataState();
  if (!data || typeof data !== 'object') return;
  
  if (Array.isArray(data.categories) && data.categories.length > 0) {
    categories = data.categories;
  }
  if (Array.isArray(data.accounts)) {
    accounts = data.accounts;
  }
  if (Array.isArray(data.transactions)) {
    transactions = data.transactions;
  }
  if (Array.isArray(data.budgets)) budgets = data.budgets;
  if (Array.isArray(data.goals)) goals = data.goals;
  if (Array.isArray(data.recurringList)) recurringList = data.recurringList;
  if (Array.isArray(data.alerts)) alerts = data.alerts;
  if (Array.isArray(data.attachments)) attachments = data.attachments;
  if (Array.isArray(data.notifications)) notifications = data.notifications;

  if (data.nextAccId) nextAccId = Math.max(nextAccId, data.nextAccId);
  if (data.nextTxId) nextTxId = Math.max(nextTxId, data.nextTxId);
  if (data.nextBudgetId) nextBudgetId = Math.max(nextBudgetId, data.nextBudgetId);
  if (data.nextGoalId) nextGoalId = Math.max(nextGoalId, data.nextGoalId);
  if (data.nextRecId) nextRecId = Math.max(nextRecId, data.nextRecId);
  if (data.nextAlertId) nextAlertId = Math.max(nextAlertId, data.nextAlertId);
  if (data.nextAttId) nextAttId = Math.max(nextAttId, data.nextAttId);
  if (data.nextNotifId) nextNotifId = Math.max(nextNotifId, data.nextNotifId);

  migrateCategories();
  autoMigrateTransactionsAndAccounts();
  autoCompleteAllRecurringMonths();
}

let isDataLoading = false;

async function loadUserData() {
  if (!currentUser) {
    resetUserDataState();
    isDataLoading = false;
    return;
  }
  if (isDataLoading) return;
  const cleanEmail = (currentUser.email || '').toLowerCase().trim();
  const userKey = 'nexus_data_' + cleanEmail;
  
  // 1. Reset state e carrega dados do cache local do próprio usuário se existir
  let localData = loadFromStorage(userKey, null);
  if (localData && Array.isArray(localData.transactions)) {
    const isMock = localData.transactions.some(t => t.desc === 'Salário' && t.val === 3335 && (t.acc === 'Dinheiro em Espécie' || t.accId === 4));
    if (isMock) {
      localData.transactions = [];
      if (Array.isArray(localData.accounts) && localData.accounts.some(a => a.name === 'AMAZON' || a.name === 'DIGIO')) {
        localData.accounts = [];
      }
      saveToStorage(userKey, localData);
    }
  }
  if (localData) {
    applyDataPayload(localData);
    isDataLoading = false;
  } else {
    // Novos usuários ou cadastros récem-criados iniciam em memória sem sobrescrever o servidor
    resetUserDataState();
    isDataLoading = false;
  }

  // 2. Sincroniza em segundo plano com o servidor SQL Server / API especificamente para este e-mail
  let hasServerChanges = false;
  try {
    const res = await fetch(window.location.origin + '/api/data?email=' + encodeURIComponent(cleanEmail));
    if (res.ok) {
      const serverData = await res.json();
      if (serverData && typeof serverData === 'object' && Object.keys(serverData).length > 0) {
        const localTxCount = (localData && Array.isArray(localData.transactions)) ? localData.transactions.length : (Array.isArray(transactions) ? transactions.length : 0);
        const serverTxCount = Array.isArray(serverData.transactions) ? serverData.transactions.length : 0;

        // Proteção essencial: se o cache local possui transações e o servidor retornou vazio, envia para persistir
        if (localTxCount > 0 && serverTxCount === 0) {
          await saveUserData();
        } else if (serverTxCount > 0 || !localData) {
          // Servidor possui dados ou cache local estava vazio: carrega dados do banco/servidor com segurança!
          applyDataPayload(serverData);
          saveToStorage(userKey, serverData);
          hasServerChanges = true;
        } else {
          const localDataStr = JSON.stringify(localData || {});
          const serverDataStr = JSON.stringify(serverData);
          if (localDataStr !== serverDataStr) {
            applyDataPayload(serverData);
            saveToStorage(userKey, serverData);
            hasServerChanges = true;
          }
        }
      }
    }
  } catch(e) {
    console.warn('Aviso de conexão com o banco de dados:', e);
  } finally {
    isDataLoading = false;
  }
  if (hasServerChanges && typeof render === 'function' && document.getElementById('appMain') && document.getElementById('appMain').classList.contains('show')) {
    render();
  }
}

// Sincronização Automática entre Dispositivos ao alternar ou focar no app (com debounce inteligente)
if (typeof document !== 'undefined') {
  let _lastFocusSync = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && currentUser && !isViewingOtherUser) {
      const now = Date.now();
      if (now - _lastFocusSync > 20000) {
        _lastFocusSync = now;
        loadUserData();
      }
    }
  });
  window.addEventListener('focus', () => {
    if (currentUser && !isViewingOtherUser) {
      const now = Date.now();
      if (now - _lastFocusSync > 20000) {
        _lastFocusSync = now;
        loadUserData();
      }
    }
  });
}

async function saveUserData() {
  if (!currentUser) return;
  if (isViewingOtherUser) return;
  if (isDataLoading) return;

  const cleanEmail = (currentUser.email || '').toLowerCase().trim();
  const userKey = 'nexus_data_' + cleanEmail;

  const payloadData = {
    categories, accounts, transactions, budgets, goals, recurringList, alerts, attachments, notifications,
    nextAccId, nextTxId, nextBudgetId, nextGoalId, nextRecId, nextAlertId, nextAttId, nextNotifId
  };
  
  saveToStorage(userKey, payloadData);

  try {
    await fetch(window.location.origin + '/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: currentUser.email, data: payloadData })
    });
  } catch(e) {}
}

/* ==================== Admin: Visualizar dados de outro usuário ==================== */
async function viewUserData(email){
  await syncUsersWithServer();
  if(!currentUser || currentUser.role !== 'Administrador') return;
  const target = registeredUsers.find(u => u.email.toLowerCase() === (email||'').toLowerCase());
  if(!target || target.email.toLowerCase() === currentUser.email.toLowerCase()) return;

  if(!isViewingOtherUser){
    await saveUserData();
    adminOriginalUser = currentUser;
  }
  currentUser = target;
  isViewingOtherUser = true;
  document.body.classList.add('has-view-mode-banner');
  saveToStorage('nexus_viewing_user', target.email);
  await loadUserData();
  currentPage = 'dashboard';
  render();
  updateViewModeBanner();
  showToast('Modo Espelho ativado: visualizando conta de ' + target.name);
}

async function exitViewMode(){
  if(!isViewingOtherUser || !adminOriginalUser) return;
  currentUser = adminOriginalUser;
  adminOriginalUser = null;
  isViewingOtherUser = false;
  document.body.classList.remove('has-view-mode-banner');
  localStorage.removeItem('nexus_viewing_user');
  localStorage.setItem('nexus_current_page', 'usuarios');
  try {
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, null, '#usuarios');
    } else {
      window.location.hash = 'usuarios';
    }
  } catch(e){}
  saveToStorage('nexus_session', { email: currentUser.email });
  saveToStorage('nexus_cached_user', currentUser);
  await loadUserData();
  currentPage = 'usuarios';
  render();
  updateViewModeBanner();
  showToast('Você voltou para sua conta de Administrador.');
}

/* ==================== Admin: Ativar/Desativar usuário ==================== */
async function toggleUserActive(email){
  await syncUsersWithServer();
  if(!currentUser || currentUser.role !== 'Administrador') return;
  const u = registeredUsers.find(x => x.email === email);
  if(!u || u.email === currentUser.email) return;

  const willDeactivate = u.active !== false;
  if(willDeactivate && u.role === 'Administrador' && registeredUsers.filter(x=>x.role==='Administrador' && x.active!==false).length <= 1){
    showToast('É necessário manter ao menos um administrador ativo');
    return;
  }

  u.active = willDeactivate ? false : true;
  await saveUsersToServer();
  showToast(willDeactivate ? 'Usuário desativado.' : 'Usuário ativado novamente.');
  logActivity('Edição', 'Usuário', 'Administrador ' + (willDeactivate ? 'desativou' : 'ativou') + ' o acesso do usuário ' + u.email + ' (' + u.name + ')');
  render();
}

async function deleteUserAdmin(email){
  await syncUsersWithServer();
  if(!currentUser || currentUser.role !== 'Administrador') return;
  const cleanEmail = (email || '').toLowerCase().trim();
  const u = registeredUsers.find(x => (x.email || '').toLowerCase() === cleanEmail);
  if(!u) return;
  if(cleanEmail === (currentUser.email || '').toLowerCase()){
    showCustomAlert('Ação não permitida', 'Você não pode excluir sua própria conta enquanto estiver conectado nela.', 'error');
    return;
  }
  if(u.role === 'Administrador' && registeredUsers.filter(x => x.role === 'Administrador').length <= 1){
    showCustomAlert('Ação não permitida', 'É necessário manter ao menos um administrador ativo no sistema.', 'error');
    return;
  }

  showCustomAlert(
    'Excluir Usuário?',
    'Tem certeza que deseja excluir permanentemente o usuário "' + u.name + '" (' + u.email + ')? Esta ação não pode ser desfeita.',
    'error',
    async () => {
      registeredUsers = registeredUsers.filter(x => (x.email || '').toLowerCase() !== cleanEmail);
      await saveUsersToServer();
      try {
        await fetch(window.location.origin + '/api/users?email=' + encodeURIComponent(cleanEmail), { method: 'DELETE' });
      } catch(e){}
      logActivity('Exclusão', 'Usuário', 'Administrador excluiu o usuário ' + u.email + ' (' + u.name + ')');
      showCustomAlert('Sucesso!', 'Usuário excluído com sucesso do banco de dados.', 'success');
      render();
    }
  );
}

/* ==================== Período ==================== */
const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const PERIOD_MIN = {year:2000, month:1};
const PERIOD_MAX = {year:2100, month:12};

function parseDateParts(dateVal) {
  if (!dateVal) return null;
  const str = String(dateVal).trim().split('T')[0];
  if (str.includes('-')) {
    const p = str.split('-');
    if (p.length === 3) {
      if (p[0].length === 4) return { year: parseInt(p[0]), month: parseInt(p[1]), day: parseInt(p[2]) };
      return { year: parseInt(p[2]), month: parseInt(p[1]), day: parseInt(p[0]) };
    }
  }
  if (str.includes('/')) {
    const p = str.split('/');
    if (p.length === 3) {
      if (p[2].length === 4) return { year: parseInt(p[2]), month: parseInt(p[1]), day: parseInt(p[0]) };
      return { year: parseInt(p[0]), month: parseInt(p[1]), day: parseInt(p[2]) };
    }
  }
  const d = new Date(dateVal);
  if (!isNaN(d.getTime())) {
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
  }
  return null;
}

function getAvailableYears() {
  const yearSet = new Set();
  const now = new Date().getFullYear();
  yearSet.add(now);
  yearSet.add(now - 1);
  yearSet.add(now + 1);
  if (typeof currentPeriod !== 'undefined' && currentPeriod && currentPeriod.year) {
    yearSet.add(currentPeriod.year);
  }
  
  const addDateStr = (dateStr) => {
    if (!dateStr) return;
    const p = parseDateParts(dateStr);
    if (p && p.year && p.year >= 2000 && p.year <= 2100) yearSet.add(p.year);
  };
  
  if (typeof transactions !== 'undefined' && Array.isArray(transactions)) {
    transactions.forEach(t => addDateStr(t.date));
  }
  if (typeof cardTx !== 'undefined' && Array.isArray(cardTx)) {
    cardTx.forEach(t => addDateStr(t.date));
  }
  if (typeof recurrentes !== 'undefined' && Array.isArray(recurrentes)) {
    recurrentes.forEach(r => addDateStr(r.startDate || r.date));
  }
  
  const minYr = Math.min(...yearSet);
  const maxYr = Math.max(...yearSet);
  const startYr = Math.min(2020, minYr);
  const endYr = Math.max(now + 5, maxYr);
  
  for (let y = startYr; y <= endYr; y++) {
    yearSet.add(y);
  }
  
  return Array.from(yearSet).sort((a, b) => a - b);
}
const EYE_ICON = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF_ICON = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.8 21.8 0 0 1 5.06-6.06M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a21.8 21.8 0 0 1-3.22 4.44M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

function bindPasswordToggle(inputId, btnId){
  const inp = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  if(!inp || !btn) return;
  btn.innerHTML = EYE_ICON;
  btn.onclick = ()=>{
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    btn.innerHTML = show ? EYE_OFF_ICON : EYE_ICON;
    btn.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
  };
}
function bindDualPasswordToggle(primaryInputId, secondaryInputId, btnId){
  const inp1 = document.getElementById(primaryInputId);
  const inp2 = document.getElementById(secondaryInputId);
  const btn = document.getElementById(btnId);
  if(!inp1 || !btn) return;
  btn.innerHTML = EYE_ICON;
  btn.onclick = ()=>{
    const show = inp1.type === 'password';
    inp1.type = show ? 'text' : 'password';
    if(inp2) inp2.type = show ? 'text' : 'password';
    btn.innerHTML = show ? EYE_OFF_ICON : EYE_ICON;
    btn.setAttribute('aria-label', show ? 'Ocultar senhas' : 'Mostrar senhas');
  };
}
function getDefaultPeriod(){
  try {
    const saved = localStorage.getItem('fin_current_period');
    if (saved) {
      const p = JSON.parse(saved);
      if (p && typeof p.year === 'number' && typeof p.month === 'number') {
        if (p.year >= PERIOD_MIN.year && p.year <= PERIOD_MAX.year && p.month >= 1 && p.month <= 12) {
          return { year: p.year, month: p.month };
        }
      }
    }
  } catch(e) {}
  const now = new Date();
  let y = now.getFullYear(), m = now.getMonth()+1;
  if(y < PERIOD_MIN.year || (y===PERIOD_MIN.year && m < PERIOD_MIN.month)) return {year:PERIOD_MIN.year, month:PERIOD_MIN.month};
  if(y > PERIOD_MAX.year || (y===PERIOD_MAX.year && m > PERIOD_MAX.month)) return {year:PERIOD_MAX.year, month:PERIOD_MAX.month};
  return {year:y, month:m};
}
let currentPeriod = getDefaultPeriod();

function pdCustom(y,m,day){
  const lastDay = new Date(y, m, 0).getDate();
  const d = String(Math.min(day, lastDay)).padStart(2,'0');
  return y + '-' + String(m).padStart(2,'0') + '-' + d;
}
function pd(day){ return pdCustom(currentPeriod.year, currentPeriod.month, day); }

let editingId=null, editingAccId=null, editingCatName=null, editingBudgetId=null, editingGoalId=null, editingRecId=null, editingAlertId=null, editingUserEmail=null;
let catManageType = 'despesa';
let currentType='out', currentRecType='out';
let currentPage = (function getInitialPage() {
  try {
    const cu = localStorage.getItem('nexus_cached_user');
    const u = cu ? JSON.parse(cu) : null;
    const isAdmin = u && u.role === 'Administrador';
    const validPages = isAdmin ? ['usuarios', 'ordens', 'logs'] : ['dashboard', 'transacoes', 'cartoes', 'orcamentos', 'metas', 'relatorios', 'recorrentes', 'importar', 'anexos', 'alertas', 'config'];
    const hashPage = window.location.hash ? window.location.hash.replace('#', '') : null;
    const savedPage = localStorage.getItem('nexus_current_page');
    if (hashPage && validPages.includes(hashPage)) return hashPage;
    if (savedPage && validPages.includes(savedPage)) return savedPage;
    return isAdmin ? 'usuarios' : 'dashboard';
  } catch(e){}
  return 'dashboard';
})();
let charts = {};

function getCategoryIcon(name) {
  if (!name) return '🏷️';
  const c = Array.isArray(categories) ? categories.find(cat => cat.name && cat.name.toLowerCase().trim() === String(name).toLowerCase().trim()) : null;
  if (c && c.icon && c.icon !== '📁') return c.icon;
  
  const n = String(name).toLowerCase().trim();
  if (n.includes('cartão') || n.includes('cartao') || n.includes('crédito') || n.includes('credito')) return '💳';
  if (n.includes('boleto') || n.includes('fatura') || n.includes('carnê') || n.includes('carne') || n.includes('conta')) return '📄';
  if (n.includes('salário') || n.includes('salario') || n.includes('pagamento') || n.includes('pró-labore') || n.includes('pro-labore') || n.includes('renda')) return '💰';
  if (n.includes('alimentação') || n.includes('alimentacao') || n.includes('restaurante') || n.includes('lanche') || n.includes('ifood') || n.includes('refeição') || n.includes('comida')) return '🍔';
  if (n.includes('mercado') || n.includes('supermercado') || n.includes('compras') || n.includes('feira') || n.includes('açougue') || n.includes('padaria')) return '🛒';
  if (n.includes('moradia') || n.includes('casa') || n.includes('aluguel') || n.includes('condomínio') || n.includes('condominio')) return '🏠';
  if (n.includes('transporte') || n.includes('combustível') || n.includes('combustivel') || n.includes('gasolina') || n.includes('uber') || n.includes('carro') || n.includes('estacionamento')) return '🚗';
  if (n.includes('saúde') || n.includes('saude') || n.includes('farmácia') || n.includes('farmacia') || n.includes('médico') || n.includes('medico') || n.includes('hospital') || n.includes('dentista') || n.includes('exame')) return '💊';
  if (n.includes('educação') || n.includes('educacao') || n.includes('curso') || n.includes('faculdade') || n.includes('livro') || n.includes('escola') || n.includes('mensalidade')) return '📚';
  if (n.includes('lazer') || n.includes('viagem') || n.includes('festa') || n.includes('passeio') || n.includes('cinema') || n.includes('show') || n.includes('hotel')) return '🎉';
  if (n.includes('internet') || n.includes('telefone') || n.includes('celular') || n.includes('fibra') || n.includes('plano')) return '📶';
  if (n.includes('luz') || n.includes('energia') || n.includes('elétrica') || n.includes('eletrica') || n.includes('cemig') || n.includes('enel')) return '💡';
  if (n.includes('água') || n.includes('agua') || n.includes('saneamento') || n.includes('copasa') || n.includes('sabesp')) return '💧';
  if (n.includes('investimento') || n.includes('poupança') || n.includes('poupanca') || n.includes('ações') || n.includes('acoes') || n.includes('rendimento') || n.includes('cdb') || n.includes('cripto')) return '📈';
  if (n.includes('streaming') || n.includes('netflix') || n.includes('spotify') || n.includes('assinatura') || n.includes('tv') || n.includes('amazon prime') || n.includes('disney')) return '🎬';
  if (n.includes('vestuário') || n.includes('vestuario') || n.includes('roupa') || n.includes('calçado') || n.includes('calcado') || n.includes('moda') || n.includes('tênis')) return '👕';
  if (n.includes('pet') || n.includes('animal') || n.includes('veterinário') || n.includes('veterinario') || n.includes('ração') || n.includes('racao') || n.includes('gato') || n.includes('cachorro')) return '🐾';
  if (n.includes('imposto') || n.includes('tributo') || n.includes('taxa') || n.includes('iptu') || n.includes('ipva') || n.includes('irpf') || n.includes('darf')) return '🏛️';
  if (n.includes('presente') || n.includes('doação') || n.includes('doacao') || n.includes('aniversário') || n.includes('natal')) return '🎁';
  if (n.includes('serviço') || n.includes('servico') || n.includes('manutenção') || n.includes('manutencao') || n.includes('reforma') || n.includes('obra')) return '🔧';
  
  return '🏷️';
}

const fmt = v => 'R$ ' + (v||0).toLocaleString('pt-BR',{minimumFractionDigits:2, maximumFractionDigits:2});
const catColor = name => (categories.find(c=>c.name===name)||{}).color || '#888';
const catIcon = name => getCategoryIcon(name);

function catOptionsHTML(type, selected){
  let list = type ? categories.filter(c=>(c.type||'despesa')===type) : categories.slice();
  list = list.slice().sort((a,b)=> (b.count||0)-(a.count||0) || a.name.localeCompare(b.name,'pt-BR'));
  return list.map(c=>'<option value="'+c.name+'"'+(selected===c.name?' selected':'')+'>'+catIcon(c.name)+' '+c.name+'</option>').join('');
}
const periodLabel = () => currentPeriod.month === 0 ? 'Todas as Datas (Geral)' : ((MONTHS[currentPeriod.month-1] || 'Mês ' + currentPeriod.month) + ' / ' + currentPeriod.year);

function formatDateBR(dateVal) {
  if (!dateVal) return '—';
  try {
    const str = String(dateVal).trim();
    if (str.includes('T')) {
      const parts = str.split('T')[0].split('-');
      if (parts.length === 3) return parts[2] + '/' + parts[1] + '/' + parts[0];
    }
    const parts = str.split('-');
    if (parts.length === 3) {
      return parts[2].padStart(2,'0') + '/' + parts[1].padStart(2,'0') + '/' + parts[0];
    }
    const d = new Date(dateVal);
    if (!isNaN(d.getTime())) return d.toLocaleDateString('pt-BR');
  } catch(e){}
  return String(dateVal);
}

function formatDateTimeWithSeconds(dateVal) {
  if (!dateVal) return 'Primeiro acesso pendente';
  try {
    if (typeof dateVal === 'string' && dateVal.includes(' ') && !dateVal.includes('T') && !dateVal.includes('Z')) {
      const parts = dateVal.split(' ');
      const dateParts = parts[0].split('-');
      const timeParts = parts[1].split(':');
      const day = dateParts[2].padStart(2, '0');
      const month = dateParts[1].padStart(2, '0');
      const year = dateParts[0];
      const hours = timeParts[0].padStart(2, '0');
      const minutes = timeParts[1].padStart(2, '0');
      const seconds = (timeParts[2] || '00').split('.')[0].padStart(2, '0');
      return day + '/' + month + '/' + year + ' às ' + hours + ':' + minutes + ':' + seconds;
    }
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return 'Primeiro acesso pendente';
    return d.toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).replace(', ', ' às ');
  } catch(e){
    return 'Primeiro acesso pendente';
  }
}

const inPeriod = t => {
  if (!t || !t.date) return false;
  if (currentPeriod.month === 0) return true;
  
  const parsed = parseDateParts(t.date);
  if (!parsed) return false;
  return parsed.month === currentPeriod.month && parsed.year === currentPeriod.year;
};

/* ==================== Cálculos de Cartões e Limites ==================== */
function isAccountCreditCard(account) {
  if (!account) return false;

  const accTypeLower = (account.type || '').toLowerCase().trim();
  const accNameLower = (account.name || '').toLowerCase().trim();

  // 0. Se contiver explicitamente débito/debito ou conta bancária, NUNCA é cartão de crédito
  if (
    accTypeLower.includes('débito') ||
    accTypeLower.includes('debito') ||
    accNameLower.includes('débito') ||
    accNameLower.includes('debito')
  ) {
    return false;
  }

  if (account.isCreditCard === true || account.isCard === true) return true;

  // 1. Se o tipo for de conta bancária de dinheiro/saldo corrente/investimento/pix, NUNCA é cartão de crédito
  const isExplicitBankOrCash = (
    accTypeLower.includes('corrente') ||
    accTypeLower.includes('poupança') ||
    accTypeLower.includes('poupanca') ||
    accTypeLower.includes('investimento') || 
    accTypeLower.includes('dinheiro') || 
    accTypeLower.includes('caixa') || 
    accTypeLower.includes('carteira') ||
    accTypeLower.includes('pix')
  );

  if (isExplicitBankOrCash) {
    return false;
  }

  // 2. Se o tipo contiver explicitamente Crédito / Fatura / Card
  if (
    accTypeLower.includes('crédito') ||
    accTypeLower.includes('credito') ||
    accTypeLower.includes('fatura') ||
    accTypeLower.includes('card')
  ) {
    return true;
  }

  // 3. Se o tipo não for especificado ou for 'Outros', verifica termos de cartão de crédito no nome
  const creditKeywords = [
    'crédito', 'credito', 'fatura', 'credicard', 'amex', 'hipercard',
    'mastercard', 'visa', 'roxinho', 'trigg', 'digio', 'bradescard', 'itaucard', 'ourocard'
  ];
  if (creditKeywords.some(k => accNameLower.includes(k))) {
    return true;
  }

  return false;
}

function normalizeAccName(str) {
  if (!str) return '';
  return str.toLowerCase()
    .replace(/cartão de crédito|cartao de credito|cartão de débito|cartao de debito|cartão|cartao|conta corrente|conta poupança|conta poupanca|conta|banco|crédito|credito|débito|debito/gi, '')
    .replace(/[^a-z0-9]/gi, '')
    .trim();
}

function isTxForAccount(t, account) {
  if (!t || !account) return false;

  const accNameLower = (account.name || '').toLowerCase().trim();
  const tAccLower = (t.acc || '').toLowerCase().trim();
  const tCardLower = (t.card || '').toLowerCase().trim();
  const descLower = (t.desc || '').toLowerCase().trim();
  const catLower = (t.cat || '').toLowerCase().trim();

  // 1. Prioridade Máxima: Se accId for especificado e coincidir com o ID da conta
  if (t.accId != null && account.id != null && String(t.accId) === String(account.id)) {
    return true;
  }

  // 2. Correspondência exata do nome da conta ou do cartão
  if (accNameLower && (tAccLower === accNameLower || tCardLower === accNameLower)) return true;

  // 3. Substring direta entre nomes (ex: "Digio" em "Cartão Digio" ou "Digio Crédito")
  if (accNameLower && tAccLower && (tAccLower.includes(accNameLower) || accNameLower.includes(tAccLower))) return true;
  if (accNameLower && tCardLower && (tCardLower.includes(accNameLower) || accNameLower.includes(tCardLower))) return true;

  // 4. Correspondência normalizada (removendo "cartão", "crédito", etc.)
  const normAccName = normalizeAccName(account.name);
  const normTAcc = normalizeAccName(t.acc);
  const normTCard = normalizeAccName(t.card);

  if (normAccName.length >= 2) {
    if (normTAcc === normAccName || normTCard === normAccName) return true;
    if (normTAcc && (normTAcc.includes(normAccName) || normAccName.includes(normTAcc))) return true;
    if (normTCard && (normTCard.includes(normAccName) || normAccName.includes(normTCard))) return true;
  }

  // 5. Se a descrição ou categoria contiver o nome da conta (ex: "Digio" em descrição ou categoria)
  if (normAccName.length >= 3 && (descLower.includes(normAccName) || catLower.includes(normAccName))) {
    return true;
  }
  if (accNameLower.length >= 3 && (descLower.includes(accNameLower) || catLower.includes(accNameLower))) {
    return true;
  }

  // 6. Transações com "Cartão de Crédito" genérico
  if (isAccountCreditCard(account)) {
    const allCreditCards = accounts.filter(a => isAccountCreditCard(a));
    if (tAccLower === 'cartão de crédito' || tAccLower === 'cartao de credito' || tAccLower === 'cartão' || tAccLower === 'cartao') {
      const specificMatch = allCreditCards.find(a => {
        const aNameLower = (a.name || '').toLowerCase().trim();
        const normName = normalizeAccName(a.name);
        return (normName.length >= 3 && descLower.includes(normName)) || (aNameLower.length >= 3 && descLower.includes(aNameLower));
      });
      if (specificMatch) {
        return String(specificMatch.id) === String(account.id);
      }
      if (allCreditCards.length === 1 && String(allCreditCards[0].id) === String(account.id)) return true;
    }
  }

  return false;
}

function isPgtoFaturaOrEstorno(t) {
  if (!t || t.type !== 'in') return false;
  const catLower = (t.cat || '').toLowerCase().trim();
  const descLower = (t.desc || '').toLowerCase().trim();
  
  if (catLower.includes('fatura') || catLower.includes('estorno') || catLower.includes('reembolso')) return true;
  if (descLower.includes('fatura') || descLower.includes('estorno') || descLower.includes('reembolso') || descLower.includes('pgto cartão') || descLower.includes('pgto cartao') || descLower.includes('pagamento de cartão') || descLower.includes('pagamento cartao')) return true;
  
  if (
    catLower.includes('salário') || catLower.includes('salario') || 
    catLower.includes('rendimento') || catLower.includes('investimento') || 
    catLower.includes('freelance') || catLower.includes('venda') || 
    catLower.includes('pró-labore') || catLower.includes('pro-labore') ||
    catLower.includes('bônus') || catLower.includes('bonus') ||
    catLower.includes('comissão') || catLower.includes('comissao')
  ) {
    return false;
  }
  
  if (catLower.includes('cartão') || catLower.includes('cartao') || catLower.includes('crédito') || catLower.includes('credito')) {
    return true;
  }
  
  return true;
}

function getCardStats(account) {
  if (!account) return { spentPeriod: 0, spentTotal: 0, totalLimit: 0, availableLimit: 0, usagePct: 0, currentBalance: 0, initialBalance: 0, isCreditCard: false, txCount: 0, periodIn: 0, periodOut: 0 };
  
  const isCreditCard = isAccountCreditCard(account);
  const cardTx = transactions.filter(t => isTxForAccount(t, account));

  const totalDespesas = cardTx.filter(t => t.type === 'out').reduce((s, t) => s + parseInputValue(t.val), 0);
  const totalPagamentos = cardTx.filter(t => t.type === 'in').reduce((s, t) => s + parseInputValue(t.val), 0);
  
  const periodCardTx = cardTx.filter(inPeriod);
  const periodDespesas = periodCardTx.filter(t => t.type === 'out').reduce((s, t) => s + parseInputValue(t.val), 0);
  const periodPagamentos = periodCardTx.filter(t => t.type === 'in').reduce((s, t) => s + parseInputValue(t.val), 0);

  const initialBalance = parseInputValue(account.balance) || parseInputValue(account.limit) || parseInputValue(account.initialBalance) || 0;

  if (isCreditCard) {
    // Para Cartões de Crédito: initialBalance representa o Limite Total Aprovado
    const totalLimit = Math.max(0, initialBalance);
    const spentTotal = Math.max(0, totalDespesas - totalPagamentos);
    const spentPeriod = Math.max(0, periodDespesas - periodPagamentos);
    const availableLimit = totalLimit - spentTotal;
    const usagePct = totalLimit > 0 ? Math.min(100, Math.max(0, Math.round((spentTotal / totalLimit) * 100))) : (spentTotal > 0 ? 100 : 0);
    const currentBalance = availableLimit;

    return {
      spentPeriod,
      spentTotal,
      totalLimit,
      availableLimit,
      usagePct,
      currentBalance,
      initialBalance,
      isCreditCard: true,
      txCount: cardTx.length,
      periodIn: periodPagamentos,
      periodOut: periodDespesas
    };
  } else {
    // Para Contas Bancárias (Conta Corrente, Poupança, Investimentos, etc.)
    const spentTotal = totalDespesas;
    const spentPeriod = periodDespesas;
    const currentBalance = initialBalance + totalPagamentos - totalDespesas;
    const availableLimit = currentBalance;
    const totalLimit = initialBalance;
    const usagePct = 0;

    return {
      spentPeriod,
      spentTotal,
      totalLimit,
      availableLimit,
      usagePct,
      currentBalance,
      initialBalance,
      isCreditCard: false,
      txCount: cardTx.length,
      periodIn: periodPagamentos,
      periodOut: periodDespesas
    };
  }
}

function computeCardSummary() {
  const creditCards = accounts.filter(a => isAccountCreditCard(a));

  let totalLimitGeral = 0;
  let spentTotalGeral = 0;
  let spentPeriodGeral = 0;
  let availableLimitGeral = 0;
  
  creditCards.forEach(card => {
    const stats = getCardStats(card);
    totalLimitGeral += stats.totalLimit;
    spentTotalGeral += stats.spentTotal;
    spentPeriodGeral += stats.spentPeriod;
    availableLimitGeral += stats.availableLimit;
  });
  
  const usagePctGeral = totalLimitGeral > 0 ? Math.min(100, Math.round((spentTotalGeral / totalLimitGeral) * 100)) : 0;
  return { creditCards, totalLimitGeral, spentTotalGeral, spentPeriodGeral, availableLimitGeral, usagePctGeral };
}

/* ==================== Cálculos ==================== */
function computeTotals(list=transactions){
  const receitas = list.filter(t=>t.type==='in').reduce((s,t)=>s+parseInputValue(t.val),0);
  const despesas = list.filter(t=>t.type==='out').reduce((s,t)=>s+parseInputValue(t.val),0);
  
  let saldoContasBancarias = 0;
  let faturasCartoesCredito = 0;

  accounts.forEach(a => {
    const stats = getCardStats(a);
    if (stats.isCreditCard) {
      faturasCartoesCredito += stats.spentTotal;
    } else {
      saldoContasBancarias += stats.currentBalance;
    }
  });

  const saldo = saldoContasBancarias - faturasCartoesCredito;
  return { receitas, despesas, saldo, saldoContasBancarias, faturasCartoesCredito };
}
function txStatsCardsHTML(list){
  const receitas = list.filter(t=>t.type==='in').reduce((s,t)=>s+parseInputValue(t.val),0);
  const despesas = list.filter(t=>t.type==='out').reduce((s,t)=>s+parseInputValue(t.val),0);
  const saldo = receitas - despesas;
  let html = '';
  html += '<div class="kpi" style="padding:14px 16px;"><div class="row1" style="margin-bottom:6px;"><span>Total de Receitas</span><span class="ic" style="width:32px; height:32px; font-size:14px; background:rgba(16,185,129,0.14); color:var(--green);">↑</span></div><div class="val" style="font-size:20px; color:var(--green); margin-bottom:2px;">' + fmt(receitas) + '</div><div class="sub" style="font-size:11px;">Entradas no filtro</div></div>';
  html += '<div class="kpi" style="padding:14px 16px;"><div class="row1" style="margin-bottom:6px;"><span>Total de Despesas</span><span class="ic" style="width:32px; height:32px; font-size:14px; background:rgba(239,68,68,0.14); color:var(--red);">↓</span></div><div class="val" style="font-size:20px; color:var(--red); margin-bottom:2px;">' + fmt(despesas) + '</div><div class="sub" style="font-size:11px;">Saídas no filtro</div></div>';
  html += '<div class="kpi" style="padding:14px 16px;"><div class="row1" style="margin-bottom:6px;"><span>Balanço Líquido</span><span class="ic" style="width:32px; height:32px; font-size:14px; background:' + (saldo < 0 ? 'rgba(239,68,68,0.14)' : 'rgba(59,130,246,0.14)') + '; color:' + (saldo < 0 ? 'var(--red)' : 'var(--blue)') + ';">⇄</span></div><div class="val" style="font-size:20px; color:' + (saldo < 0 ? 'var(--red)' : 'var(--green)') + '; margin-bottom:2px;">' + fmt(saldo) + '</div><div class="sub" style="font-size:11px;">Receitas − Despesas</div></div>';
  html += '<div class="kpi" style="padding:14px 16px;"><div class="row1" style="margin-bottom:6px;"><span>Total de Registros</span><span class="ic" style="width:32px; height:32px; font-size:14px; background:rgba(168,85,247,0.14); color:var(--purple);">📋</span></div><div class="val" style="font-size:20px; margin-bottom:2px;">' + list.length + '</div><div class="sub" style="font-size:11px;">Lançamentos no filtro</div></div>';
  return html;
}
function despesasPorCategoria(list=transactions){
  const map = {};
  list.filter(t=>t.type==='out').forEach(t=>{ 
    const v = parseInputValue(t.val);
    map[t.cat]=(map[t.cat]||0)+v; 
  });
  return Object.entries(map).map(([name,val])=>({name,val,color:catColor(name)})).sort((a,b)=>b.val-a.val);
}
function budgetStatus(list=budgets){
  const periodTx = transactions.filter(inPeriod);
  return list.map(b=>{
    const spent = periodTx.filter(t=>t.cat===b.category && t.type==='out').reduce((s,t)=>s+parseInputValue(t.val),0);
    const pct = b.limit>0 ? Math.round(spent/b.limit*100) : 0;
    return {...b, spent, pct};
  });
}

function showCustomAlert(title, message, type = 'success', onConfirm = null) {
  let modal = document.getElementById('executive4kModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'executive4kModal';
    modal.className = 'executive-4k-modal-overlay';
    document.body.appendChild(modal);
  }

  let iconHtml = `
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#60A5FA" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 8px rgba(59,130,246,0.7));">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="16" x2="12" y2="12"/>
      <line x1="12" y1="8" x2="12.01" y2="8"/>
    </svg>
  `;
  let badgeStyle = 'background:linear-gradient(135deg, rgba(59,130,246,0.22) 0%, rgba(37,99,235,0.12) 60%, rgba(0,0,0,0.35) 100%) !important; border:1.5px solid rgba(96,165,250,0.5) !important; box-shadow:0 0 30px rgba(59,130,246,0.4), inset 0 1px 2px rgba(255,255,255,0.6) !important;';
  let btnStyle = 'background:linear-gradient(135deg, #3B82F6 0%, #2563EB 60%, #1D4ED8 100%) !important; box-shadow:0 12px 28px -4px rgba(59,130,246,0.5), inset 0 1px 1px rgba(255,255,255,0.45) !important;';

  if (type === 'success') {
    iconHtml = `
      <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#34D399" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 10px rgba(52,211,153,0.8));">
        <path d="M20 6 9 17l-5-5"/>
      </svg>
    `;
    badgeStyle = 'background:linear-gradient(135deg, rgba(16,185,129,0.22) 0%, rgba(5,150,105,0.12) 60%, rgba(0,0,0,0.35) 100%) !important; border:1.5px solid rgba(52,211,153,0.5) !important; box-shadow:0 0 30px rgba(16,185,129,0.4), inset 0 1px 2px rgba(255,255,255,0.6) !important;';
    btnStyle = 'background:linear-gradient(135deg, #10B981 0%, #059669 60%, #047857 100%) !important; box-shadow:0 12px 28px -4px rgba(16,185,129,0.5), inset 0 1px 1px rgba(255,255,255,0.45) !important;';
  } else if (type === 'error') {
    iconHtml = `
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#F87171" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 10px rgba(239,68,68,0.8));">
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
        <line x1="12" y1="9" x2="12" y2="13"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
    `;
    badgeStyle = 'background:linear-gradient(135deg, rgba(239,68,68,0.22) 0%, rgba(185,28,28,0.12) 60%, rgba(0,0,0,0.35) 100%) !important; border:1.5px solid rgba(248,113,113,0.5) !important; box-shadow:0 0 30px rgba(239,68,68,0.4), inset 0 1px 2px rgba(255,255,255,0.6) !important;';
    btnStyle = 'background:linear-gradient(135deg, #EF4444 0%, #DC2626 60%, #991B1B 100%) !important; box-shadow:0 12px 28px -4px rgba(239,68,68,0.5), inset 0 1px 1px rgba(255,255,255,0.45) !important;';
  }

  modal.innerHTML = `
    <div class="executive-4k-card">
      <div class="executive-4k-badge" style="${badgeStyle}">
        ${iconHtml}
      </div>
      <h3 class="executive-4k-title">${title}</h3>
      <p class="executive-4k-message">${message}</p>
      <button type="button" class="executive-4k-btn" style="${btnStyle}" id="exec4kOkBtn">
        Entendido
      </button>
    </div>
  `;

  modal.style.display = 'flex';

  const closeAlert = () => {
    modal.style.display = 'none';
    if (typeof onConfirm === 'function') onConfirm();
  };

  const okBtn = document.getElementById('exec4kOkBtn');
  if (okBtn) okBtn.onclick = closeAlert;
  modal.onclick = (e) => {
    if (e.target === modal) closeAlert();
  };
}

window.alert = function(msg) {
  let type = 'info';
  let title = 'Notificação do Sistema';
  if (typeof msg === 'string') {
    if (msg.toLowerCase().includes('sucesso') || msg.toLowerCase().includes('criada') || msg.toLowerCase().includes('salv')) {
      type = 'success';
      title = 'Sucesso! 🎉';
    } else if (msg.toLowerCase().includes('erro') || msg.toLowerCase().includes('falha') || msg.toLowerCase().includes('incorreto') || msg.toLowerCase().includes('verifique')) {
      type = 'error';
      title = 'Atenção';
    }
  }
  showCustomAlert(title, msg, type);
};

let toastTimer = null;
function showToast(msg){
  const t = document.getElementById('toast');
  if(!t) return;
  const msgEl = document.getElementById('toastMsg');
  if(msgEl) msgEl.textContent = msg;

  const isDanger = /remov|exclu|erro|inválid|atençã|falha|⚠️|🗑/i.test(msg);
  const iconCheck = document.getElementById('toastIconCheck');
  const iconAlert = document.getElementById('toastIconAlert');

  if(isDanger) {
    t.classList.add('toast-danger');
    if(iconCheck) iconCheck.style.display = 'none';
    if(iconAlert) iconAlert.style.display = 'block';
  } else {
    t.classList.remove('toast-danger');
    if(iconCheck) iconCheck.style.display = 'block';
    if(iconAlert) iconAlert.style.display = 'none';
  }

  t.classList.add('show');
  if(toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove('show');
  }, 3400);
}

function timeAgo(ts){
  const diff = Math.max(0, Date.now() - ts);
  const min = Math.floor(diff/60000);
  if(min < 1) return 'agora mesmo';
  if(min < 60) return 'há ' + min + ' min';
  const hr = Math.floor(min/60);
  if(hr < 24) return 'há ' + hr + 'h';
  const day = Math.floor(hr/24);
  if(day < 7) return 'há ' + day + 'd';
  return new Date(ts).toLocaleDateString('pt-BR');
}
async function pushNotification(text, icon){
  notifications.unshift({id: nextNotifId++, text, icon: icon || '🔔', time: Date.now(), read:false});
  if(notifications.length > 40) notifications = notifications.slice(0,40);
  await saveUserData();
  renderNotifications();
}
function renderNotifications(){
  const dot = document.getElementById('notifDot');
  const list = document.getElementById('notifList');
  if(!dot || !list) return;
  const unread = notifications.filter(n=>!n.read).length;
  dot.style.display = unread > 0 ? 'block' : 'none';
  list.innerHTML = notifications.length ? notifications.map(n=>`
    <div class="notif-item ${n.read?'':'unread'}">
      ${n.read? '' : '<span class="unread-dot"></span>'}
      <span class="ic">${n.icon}</span>
      <div class="body"><div class="txt">${n.text}</div><div class="time">${timeAgo(n.time)}</div></div>
    </div>`).join('') : `<div class="notif-empty">Nenhuma notificação por aqui.</div>`;
}

/* ==================== Atualização parcial da tabela de Transações (evita flicker) ==================== */
window.clearAllTxFilters = function(allDates = false) {
  const s = document.getElementById('txSearch'); if(s) s.value = '';
  const ft = document.getElementById('txFiltroTipo'); if(ft) ft.value = '';
  const fc = document.getElementById('txFiltroCat'); if(fc) fc.value = '';
  const fs = document.getElementById('txFiltroStatus'); if(fs) fs.value = '';
  const fa = document.getElementById('txFiltroConta'); if(fa) fa.value = '';
  if (allDates) {
    currentPeriod = { year: new Date().getFullYear(), month: 0 };
    try { localStorage.setItem('fin_current_period', JSON.stringify(currentPeriod)); } catch(e){}
    const el = document.getElementById('pageContent');
    if (el) el.removeAttribute('data-current-rendered-page');
    render();
    return;
  }
  refreshTxTable();
};

function refreshTxTable(){
  const search = document.getElementById('txSearch');
  const fTipo = document.getElementById('txFiltroTipo');
  const fCat = document.getElementById('txFiltroCat');
  const fStatus = document.getElementById('txFiltroStatus');
  const fConta = document.getElementById('txFiltroConta');
  const btnReset = document.getElementById('btnResetTxFilters');
  const tableWrap = document.getElementById('txTableWrap');
  if(!tableWrap) return false;

  // Purga imediata: impede que gerenciadores de senha do navegador preencham o e-mail do usuário no campo de busca de transações
  const userEmail = (currentUser && currentUser.email ? currentUser.email.toLowerCase().trim() : '');
  if (search && search.value && userEmail && search.value.trim().toLowerCase() === userEmail) {
    search.value = '';
  }

  const hasFilterActive = Boolean(
    (search && search.value.trim()) ||
    (fTipo && fTipo.value) ||
    (fCat && fCat.value) ||
    (fStatus && fStatus.value) ||
    (fConta && fConta.value)
  );
  if (btnReset) {
    btnReset.style.display = hasFilterActive ? 'inline-flex' : 'none';
  }

  let list = transactions.filter(inPeriod);
  if (search && search.value) {
    const q = search.value.trim().toLowerCase();
    if(q) {
      list = list.filter(t => {
        const desc = (t.desc || '').toLowerCase();
        const cat = (t.cat || '').toLowerCase();
        const acc = (t.acc || '').toLowerCase();
        const method = (t.paymentMethod || '').toLowerCase();
        const valStr = String(t.val || '').toLowerCase();
        const valFmt = fmt(t.val).toLowerCase();
        const dt = formatDateBR(t.date).toLowerCase();
        const rawDt = String(t.date || '').toLowerCase();
        const status = (t.status || '').toLowerCase();
        return desc.includes(q) || cat.includes(q) || acc.includes(q) || method.includes(q) || valStr.includes(q) || valFmt.includes(q) || dt.includes(q) || rawDt.includes(q) || status.includes(q);
      });
    }
  }
  if(fTipo && fTipo.value) list = list.filter(t=>t.type===fTipo.value);
  if(fCat && fCat.value) list = list.filter(t=>t.cat===fCat.value);
  if(fStatus && fStatus.value) list = list.filter(t=>t.status===fStatus.value);
  if(fConta && fConta.value) {
    const targetAcc = accounts.find(a => a.name === fConta.value);
    if (targetAcc) {
      list = list.filter(t => isTxForAccount(t, targetAcc));
    } else {
      const qAcc = fConta.value.toLowerCase().trim();
      list = list.filter(t => (t.acc || '').toLowerCase().trim().includes(qAcc));
    }
  }

  list.sort((a,b)=>b.date.localeCompare(a.date));
  tableWrap.innerHTML = transactionsTable(list, true);
  const statsRow = document.getElementById('txStatsRow'); if(statsRow) statsRow.innerHTML = txStatsCardsHTML(list);
  document.querySelectorAll('[data-edit]').forEach(el => {
    el.onclick = (e) => {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      openModal(parseInt(el.getAttribute('data-edit')));
    };
  });
  document.querySelectorAll('[data-del]').forEach(el => {
    el.onclick = (e) => {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      const id = parseInt(el.getAttribute('data-del'));
      if (!isNaN(id)) deleteTransaction(id);
    };
  });
  document.querySelectorAll('[data-togglestatus]').forEach(el => {
    el.onclick = (e) => {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      const id = parseInt(el.getAttribute('data-togglestatus'));
      if (!isNaN(id)) toggleTransactionStatus(id);
    };
  });
  return true;
}

/* ==================== Render Suave sem Flickering ==================== */
function updateMainHeaderSpacing() {
  const th = document.querySelector('.topheader');
  const mainEl = document.querySelector('.main');
  if (th && mainEl && window.innerWidth > 900) {
    const banner = document.querySelector('.view-mode-banner');
    const bannerH = (banner && document.body.classList.contains('has-view-mode-banner')) ? banner.offsetHeight : 0;
    const thH = th.offsetHeight || 125;
    mainEl.style.marginTop = (thH + bannerH + 4) + 'px';
  }
}
window.addEventListener('resize', updateMainHeaderSpacing);

function render(){
  const el = document.getElementById('pageContent');
  if (!el) return;
  updateMainHeaderSpacing();

  const isAdmin = currentUser && currentUser.role === 'Administrador';
  const isAdminView = isAdmin && !isViewingOtherUser;

  if (isAdminView) {
    // Perfil de Administrador acessa EXCLUSIVAMENTE funções administrativas
    if (!['usuarios', 'ordens', 'logs'].includes(currentPage)) {
      currentPage = 'usuarios';
    }
  } else {
    // Usuários comuns nunca podem acessar páginas administrativas
    if (['usuarios', 'ordens', 'logs'].includes(currentPage)) {
      currentPage = 'dashboard';
    }
  }


  let newHTML = '';
  try {
    if(currentPage==='usuarios') {
      newHTML = pageUsuarios();
      syncUsersWithServer().then(() => {
        const uEl = document.getElementById('pageContent');
        if (uEl && currentPage === 'usuarios') {
          const freshHTML = pageUsuarios();
          if (uEl.innerHTML !== freshHTML) uEl.innerHTML = freshHTML;
        }
      }).catch(() => {});
    }
    else if(currentPage==='logs') {
      newHTML = pageLogs();
      loadSystemLogs().then(() => {
        const lEl = document.getElementById('pageContent');
        if (lEl && currentPage === 'logs') {
          const freshHTML = pageLogs();
          if (lEl.innerHTML !== freshHTML) lEl.innerHTML = freshHTML;
        }
      }).catch(() => {});
    }
    else if(currentPage==='ordens') {
      newHTML = pageOrdens();
      syncOrdensWithServer().then(() => {
        const oEl = document.getElementById('pageContent');
        if (oEl && currentPage === 'ordens') {
          const freshHTML = pageOrdens();
          if (oEl.innerHTML !== freshHTML) oEl.innerHTML = freshHTML;
        }
      }).catch(() => {});
    }
    else if(currentPage==='dashboard') newHTML = pageDashboard();
    else if(currentPage==='transacoes') newHTML = pageTransacoes();
    else if(currentPage==='cartoes') newHTML = pageContas();
    else if(currentPage==='orcamentos') newHTML = pageOrcamentos();
    else if(currentPage==='metas') newHTML = pageMetas();
    else if(currentPage==='relatorios') newHTML = pageRelatorios();
    else if(currentPage==='recorrentes') newHTML = pageRecorrentes();
    else if(currentPage==='importar') newHTML = pageImportar();
    else if(currentPage==='anexos') newHTML = pageAnexos();
    else if(currentPage==='alertas') newHTML = pageAlertas();
    else if(currentPage==='config') newHTML = pageConfig();
    else if(currentPage==='funcoes') newHTML = pageFuncoes();
    else newHTML = pageDashboard();

    const pageChanged = el.getAttribute('data-current-rendered-page') !== currentPage;
    const htmlChanged = el.dataset.renderedHtml !== newHTML;

    if (pageChanged || htmlChanged) {
      el.innerHTML = newHTML;
      el.dataset.renderedHtml = newHTML;
      el.setAttribute('data-current-rendered-page', currentPage);
      attachPageEvents();
    }
  } catch(err) {
    console.error("Erro ao renderizar tela " + currentPage + ":", err);
    try {
      el.innerHTML = '<div class="placeholder"><div class="big">⚠️</div><h3>Erro ao carregar módulo</h3><p>Tente recarregar ou voltar para a aba de Usuários.</p></div>';
    } catch(e2){}
  }

  try {
    updateHeaderUser();
    renderNotifications();
    updateViewModeBanner();
    updateAdminMenuVisibility();
    updateActiveMenu();
    if(currentPage==='dashboard') {
      drawDashboardCharts();
      animateKpiValues();
    }
  } catch(err) {
    console.error("Erro no pós-render:", err);
    updateActiveMenu();
  }
}

function updateActiveMenu(){
  const isAdmin = currentUser && currentUser.role === 'Administrador';
  const isAdminView = isAdmin && !isViewingOtherUser;

  if (isAdminView) {
    if (!['usuarios', 'ordens', 'logs'].includes(currentPage)) {
      currentPage = 'usuarios';
    }
  } else {
    // Usuários comuns nunca podem permanecer em telas de administração
    if (['usuarios', 'ordens', 'logs'].includes(currentPage)) {
      currentPage = 'dashboard';
    }
  }

  const buttons = document.querySelectorAll('button[data-page]');
  buttons.forEach(b => {
    const isCurrent = (b.getAttribute('data-page') === currentPage);
    b.classList.toggle('active', isCurrent);
  });
}

function updateAdminMenuVisibility(){
  const isAdmin = currentUser && currentUser.role === 'Administrador';
  const isAdminView = isAdmin && !isViewingOtherUser;

  if (isAdminView) {
    document.documentElement.classList.add('is-admin');
  } else {
    document.documentElement.classList.remove('is-admin');
  }

  // Módulos financeiros: visíveis apenas para perfis comuns (ou em Modo Espelho)
  // Administrador tem acesso estritamente a módulos administrativos
  const financialPages = ['dashboard', 'transacoes', 'cartoes', 'orcamentos', 'metas', 'relatorios', 'recorrentes', 'importar', 'anexos', 'config'];
  financialPages.forEach(function(pg) {
    document.querySelectorAll('button[data-page="' + pg + '"]').forEach(function(btn) {
      btn.style.display = isAdminView ? 'none' : 'flex';
    });
  });

  // Módulos de gestão administrativa aparecem EXCLUSIVAMENTE para o Administrador
  const adminPages = ['usuarios', 'ordens', 'logs'];
  adminPages.forEach(function(pg) {
    document.querySelectorAll('button[data-page="' + pg + '"]').forEach(function(btn) {
      btn.style.display = isAdminView ? 'flex' : 'none';
    });
  });

  // Divisores e badges executivas do menu de gestão
  document.querySelectorAll('.menu-admin-divider, #mobileDrawerAdminDivider').forEach(function(el) {
    el.style.display = 'none';
  });
  document.querySelectorAll('.menu-admin-badge, #mobileDrawerAdminBadge').forEach(function(el) {
    el.style.display = isAdminView ? 'inline-flex' : 'none';
  });

  // Ocultar atalho Minha Conta no header para Perfil Administrador
  document.querySelectorAll('.aether-settings-btn').forEach(function(el) {
    el.style.display = isAdminView ? 'none' : 'inline-flex';
  });
}

function updateViewModeBanner(){
  const banner = document.getElementById('viewModeBanner');
  const floatingBtn = document.getElementById('floatingExitMirrorBtn');
  const headerMirrorExitBtn = document.getElementById('headerMirrorExitBtn');
  const exitBtn = document.getElementById('viewModeExitBtn');

  if (exitBtn) exitBtn.onclick = exitViewMode;
  if (floatingBtn) floatingBtn.onclick = exitViewMode;
  if (headerMirrorExitBtn) headerMirrorExitBtn.onclick = exitViewMode;

  if(isViewingOtherUser && currentUser){
    const nameEl = document.getElementById('viewModeUserName');
    if(nameEl) nameEl.textContent = currentUser.name;
    if(banner) banner.classList.add('show');
    if(floatingBtn) floatingBtn.style.display = 'inline-flex';
    if(headerMirrorExitBtn) headerMirrorExitBtn.style.display = 'inline-flex';
    document.body.classList.add('has-view-mode-banner');
  } else {
    if(banner) banner.classList.remove('show');
    if(floatingBtn) floatingBtn.style.display = 'none';
    if(headerMirrorExitBtn) headerMirrorExitBtn.style.display = 'none';
    document.body.classList.remove('has-view-mode-banner');
  }
}

function updateHeaderUser(){
  if (!currentUser) return;
  const unameEl = document.getElementById('headerName');
  const avatarEl = document.getElementById('headerAvatar');
  const roleEl = document.getElementById('headerRole');

  if(unameEl) unameEl.textContent = currentUser.name;
  if(roleEl) {
    if (isViewingOtherUser) {
      roleEl.innerHTML = '<span style="color:#FBBF24; font-weight:800;">👁️ Modo Espelho</span>';
    } else {
      const roleText = currentUser.role || 'Usuário';
      roleEl.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span>' + roleText + '</span>';
    }
  }
  if(avatarEl) {
    const rawParts = currentUser.name.trim().split(/s+/);
    let inits = 'PL';
    if (rawParts.length >= 2) {
      inits = (rawParts[0][0] + rawParts[1][0]).toUpperCase();
    } else if (rawParts.length === 1) {
      inits = rawParts[0].slice(0, 2).toUpperCase();
    }
    avatarEl.textContent = inits;
  }
}

function periodPickerHTML(){
  const isAllDates = currentPeriod.month === 0;
  const labelText = isAllDates ? 'Todas as Datas (Geral)' : (MONTHS[currentPeriod.month-1] + ' / ' + currentPeriod.year);

  return `
  <div class="period-wrap">
    <button type="button" class="period" id="periodBtn" title="Selecionar Período de Análise Financeira">
      <span class="period-ic">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="17" rx="4"/>
          <line x1="3" y1="9" x2="21" y2="9"/>
          <line x1="8" y1="2" x2="8" y2="5"/>
          <line x1="16" y1="2" x2="16" y2="5"/>
          <circle cx="8" cy="13" r="1.1" fill="currentColor"/>
          <circle cx="12" cy="13" r="1.1" fill="currentColor"/>
          <circle cx="16" cy="13" r="1.1" fill="currentColor"/>
          <circle cx="8" cy="17" r="1.1" fill="currentColor"/>
          <circle cx="12" cy="17" r="1.1" fill="currentColor"/>
          <circle cx="16" cy="17" r="1.1" fill="currentColor"/>
        </svg>
      </span>
      <span class="period-text">${labelText}</span>
      <svg class="period-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div class="period-panel" id="periodPanel">
      <button type="button" class="period-today-btn" id="periodTodayBtn" style="margin-bottom:6px;">📍 Ir para o mês atual</button>
      <button type="button" class="period-today-btn" id="periodAllDatesBtn" style="background:rgba(74,144,226,0.15); color:var(--blue); margin-bottom:12px;">🌐 Ver Todas as Datas (Visão Geral)</button>
      <div class="field"><label>Ano</label><select id="periodYearSel"></select></div>
      <div class="field"><label>Mês</label><select id="periodMonthSel"></select></div>
      <button class="btn-primary" id="periodApplyBtn" style="width:100%;justify-content:center">Aplicar</button>
    </div>
  </div>`;
}

/* ==================== Dashboard ==================== */
function getPendingBillsSummary() {
  const today = new Date();
  today.setHours(0,0,0,0);

  const pendingTxs = transactions.filter(t => {
    if (t.type !== 'out' || t.status === 'Pago' || t.status === 'Recebido') return false;
    const dParts = t.date ? t.date.split('-') : [];
    const d = dParts.length === 3 ? new Date(parseInt(dParts[0]), parseInt(dParts[1]) - 1, parseInt(dParts[2])) : new Date(t.date);
    d.setHours(0,0,0,0);
    const diffDays = Math.round((d - today) / (1000 * 60 * 60 * 24));
    return diffDays <= 3;
  });

  const items = pendingTxs.map(t => {
    const dParts = t.date ? t.date.split('-') : [];
    const d = dParts.length === 3 ? new Date(parseInt(dParts[0]), parseInt(dParts[1]) - 1, parseInt(dParts[2])) : new Date(t.date);
    d.setHours(0,0,0,0);

    const diffDays = Math.round((d - today) / (1000 * 60 * 60 * 24));
    let statusType = 'soon';
    let statusText = '';
    let isUrgent = false;

    if (diffDays < 0) {
      statusType = 'overdue';
      statusText = `VENCIDA (há ${Math.abs(diffDays)} dia${Math.abs(diffDays) === 1 ? '' : 's'})`;
      isUrgent = true;
    } else if (diffDays === 0) {
      statusType = 'today';
      statusText = 'VENCE HOJE';
      isUrgent = true;
    } else {
      statusType = 'soon';
      statusText = `VENCE EM ${diffDays} DIA${diffDays === 1 ? '' : 'S'}`;
      isUrgent = true;
    }

    return {
      ...t,
      diffDays,
      statusType,
      statusText,
      isUrgent,
      formattedDate: dParts.length === 3 ? `${dParts[2]}/${dParts[1]}/${dParts[0]}` : t.date
    };
  });

  items.sort((a,b) => a.diffDays - b.diffDays);

  const totalValue = items.reduce((acc, curr) => acc + (curr.val || 0), 0);
  const urgentCount = items.filter(i => i.isUrgent).length;
  const overdueCount = items.filter(i => i.statusType === 'overdue').length;

  return {
    items,
    totalValue,
    urgentCount,
    overdueCount
  };
}

async function markTransactionAsPaid(id) {
  const t = transactions.find(x => x.id === id);
  if (!t) return;
  t.status = 'Pago';
  showToast(`✅ Conta "${t.desc}" marcada como PAGA!`);
  logActivity('Pagamento', 'Transação', `Baixa realizada no pagamento de "${t.desc}" (${fmt(t.val)}).`);
  await pushNotification(`Pagamento realizado: ${t.desc} — ${fmt(t.val)}`, '✅');
  await saveUserData();
  render();
}

function pageDashboard(){
  const periodTx = transactions.filter(inPeriod);
  const {receitas,despesas,saldo} = computeTotals(periodTx);
  const cats = despesasPorCategoria(periodTx);
  const actualTotalDesp = cats.reduce((s,c)=>s+c.val,0);
  const totalDesp = actualTotalDesp || 1;
  const totalFluxo = receitas + despesas;
  const recPct = totalFluxo > 0 ? Math.round((receitas / totalFluxo) * 100) : 0;
  const despPct = totalFluxo > 0 ? (100 - recPct) : 0;
  const resultado = receitas - despesas;
  const savingsPct = receitas > 0 ? Math.max(0, Math.round((resultado / receitas) * 100)) : 0;
  const commitPct = receitas > 0 ? Math.min(100, Math.round((despesas / receitas) * 100)) : (despesas > 0 ? 100 : 0);
  const now = new Date();
  const daysInPeriod = now.getDate() || 1;
  const dailyAvg = despesas > 0 ? (despesas / daysInPeriod) : 0;
  const lastTx = periodTx.slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5);
  const cardSummary = computeCardSummary();
  const pendingSummary = getPendingBillsSummary();

  const greeting = getGreetingTime();
  const formattedToday = getFormattedToday();
  const rawFirstName = currentUser ? (currentUser.name || '').split(' ')[0] : 'Usuário';
  const firstName = rawFirstName ? (rawFirstName.charAt(0).toUpperCase() + rawFirstName.slice(1).toLowerCase()) : 'Usuário';

  const h = new Date().getHours();
  let greetingIconSvg = '';
  let greetingBadgeBg = '';
  let greetingBadgeBorder = '';
  let greetingBadgeColor = '';
  if (h >= 5 && h < 12) {
    greetingIconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
    greetingBadgeBg = 'linear-gradient(135deg, rgba(245,158,11,0.25), rgba(217,119,6,0.1))';
    greetingBadgeBorder = 'rgba(245,158,11,0.38)';
    greetingBadgeColor = '#FBBF24';
  } else if (h >= 12 && h < 18) {
    greetingIconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M22 12h-2"/><path d="m4.93 19.07 1.41-1.41"/><path d="m17.66 6.34 1.41-1.41"/></svg>';
    greetingBadgeBg = 'linear-gradient(135deg, rgba(14,165,233,0.25), rgba(2,132,199,0.1))';
    greetingBadgeBorder = 'rgba(14,165,233,0.38)';
    greetingBadgeColor = '#38BDF8';
  } else {
    greetingIconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 0 1 1-9-9Z"/><path d="M19 3v4"/><path d="M21 5h-4"/></svg>';
    greetingBadgeBg = 'linear-gradient(135deg, rgba(99,102,241,0.25), rgba(79,70,229,0.1))';
    greetingBadgeBorder = 'rgba(129,140,248,0.38)';
    greetingBadgeColor = '#A5B4FC';
  }

  return `
  <!-- 4K EXECUTIVE DASHBOARD WELCOME HERO -->
  <div class="dashboard-welcome-hero">
    <div class="hero-content">
      <div class="hero-left">
        <div class="hero-badge-strip">
          <span class="hero-badge hide-mobile">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#38BDF8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <span>${formattedToday}</span>
          </span>
        </div>
        <h1 class="hero-greeting">
          <span style="display:inline-flex; align-items:center; justify-content:center; width:38px; height:38px; border-radius:12px; background:${greetingBadgeBg}; border:1px solid ${greetingBadgeBorder}; color:${greetingBadgeColor}; box-shadow:0 4px 16px rgba(0,0,0,0.4); flex-shrink:0;">
            ${greetingIconSvg}
          </span>
          <span>${greeting.text}, <span class="hero-name-gradient">${firstName}</span></span>
        </h1>
        <p class="hero-sub">
          Visão Consolidada • Inteligência Estratégica & Gestão Financeira Pessoal
        </p>
      </div>

      <div class="hero-actions">
        ${periodPickerHTML()}
        <button type="button" class="btn-hero-privacy" onclick="window.toggleSensitiveBalances()" id="btnToggleBalances" title="Ocultar ou Exibir Saldos">
          <span class="btn-hero-icon-pill">
            <span id="btnEyeIcon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg></span>
          </span>
          <span id="btnEyeText">Ocultar Saldos</span>
        </button>
        <button class="btn-hero-primary" id="btnNovaTransacao" title="Lançar Nova Receita ou Despesa">
          <span class="btn-hero-icon-pill">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </span>
          <span>Nova Transação</span>
        </button>
      </div>
    </div>
  </div>

  <div class="kpis">
    <!-- 1. Saldo Total -->
    <div class="kpi kpi-balance">
      <div class="row1">
        <div style="display:flex; align-items:center; gap:8px;">
          <span>Saldo Total</span>
          <button type="button" onclick="window.toggleSensitiveBalances()" title="Ocultar ou Exibir Saldos" style="background:none; border:none; color:var(--text-dim); cursor:pointer; font-size:13px; padding:0; display:inline-flex; align-items:center; opacity:0.8; transition:opacity 0.2s;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.8'">
            <span class="btnEyeIconCard"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg></span>
          </button>
        </div>
        <span class="ic" style="background:linear-gradient(135deg, rgba(6,182,212,0.18), rgba(6,182,212,0.06)); border:1px solid rgba(6,182,212,0.3); color:#22D3EE;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/></svg>
        </span>
      </div>
      <div class="val" data-anim-val="${saldo}" style="color:${saldo < 0 ? '#F87171' : '#34D399'}; font-variant-numeric:tabular-nums;">${fmt(saldo)}</div>
      <div class="sub">
        <span style="display:inline-flex; align-items:center; gap:5px; font-weight:600; color:${saldo < 0 ? '#F87171' : '#34D399'};">
          <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:currentColor; box-shadow:0 0 6px currentColor;"></span>
          <span>${saldo < 0 ? 'Saldo Negativo' : 'Saldo Positivo'}</span>
        </span>
        <span class="kpi-tag ${saldo < 0 ? 'kpi-tag-danger' : 'kpi-tag-success'}">${saldo < 0 ? 'Atenção' : 'Disponível'}</span>
      </div>
    </div>

    <!-- 2. Receitas -->
    <div class="kpi kpi-income">
      <div class="row1">
        <span>Receitas</span>
        <span class="ic" style="background:linear-gradient(135deg, rgba(16,185,129,0.18), rgba(16,185,129,0.06)); border:1px solid rgba(16,185,129,0.3); color:#34D399;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
        </span>
      </div>
      <div class="val" data-anim-val="${receitas}" data-prefix="${receitas > 0 ? '+' : ''}" style="color:#34D399; font-variant-numeric:tabular-nums;">${receitas > 0 ? '+' : ''}${fmt(receitas)}</div>
      <div class="sub">
        <span style="display:inline-flex; align-items:center; gap:5px; font-weight:600; color:#94A3B8;">
          <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:#10B981;"></span>
          <span>Entradas no mês</span>
        </span>
        <span class="kpi-tag kpi-tag-success">Líquido</span>
      </div>
    </div>

    <!-- 3. Despesas -->
    <div class="kpi kpi-expense">
      <div class="row1">
        <span>Despesas</span>
        <span class="ic" style="background:linear-gradient(135deg, rgba(239,68,68,0.18), rgba(239,68,68,0.06)); border:1px solid rgba(239,68,68,0.3); color:#F87171;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>
        </span>
      </div>
      <div class="val" data-anim-val="${despesas}" data-prefix="${despesas > 0 ? '-' : ''}" style="color:${despesas > 0 ? '#F87171' : 'var(--text-dim)'}; font-variant-numeric:tabular-nums;">${despesas > 0 ? '-' : ''}${fmt(despesas)}</div>
      <div class="sub">
        <span style="display:inline-flex; align-items:center; gap:5px; font-weight:600; color:#94A3B8;">
          <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:#EF4444;"></span>
          <span>Saídas no mês</span>
        </span>
        <span class="kpi-tag kpi-tag-danger">${commitPct}% da Renda</span>
      </div>
    </div>

    <!-- 4. Resultado Líquido -->
    <div class="kpi kpi-net">
      <div class="row1">
        <span>Resultado Líquido</span>
        <span class="ic" style="background:linear-gradient(135deg, rgba(59,130,246,0.18), rgba(59,130,246,0.06)); border:1px solid rgba(59,130,246,0.3); color:#60A5FA;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        </span>
      </div>
      <div class="val" data-anim-val="${resultado}" style="color:${resultado >= 0 ? '#34D399' : '#F87171'}; font-variant-numeric:tabular-nums;">${resultado >= 0 ? '+' : ''}${fmt(resultado)}</div>
      <div class="sub">
        <span style="display:inline-flex; align-items:center; gap:5px; font-weight:600; color:${resultado >= 0 ? '#34D399' : '#F87171'};">
          <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:currentColor; box-shadow:0 0 6px currentColor;"></span>
          <span>${resultado >= 0 ? 'Superávit no mês' : 'Déficit no mês'}</span>
        </span>
        <span class="kpi-tag ${resultado >= 0 ? 'kpi-tag-success' : 'kpi-tag-danger'}">${savingsPct > 0 ? savingsPct + '% Poupado' : (resultado >= 0 ? 'Equilibrado' : 'Alerta')}</span>
      </div>
    </div>

    <!-- 5. Lançamentos -->
    <div class="kpi kpi-tx">
      <div class="row1">
        <span>Lançamentos</span>
        <span class="ic" style="background:linear-gradient(135deg, rgba(168,85,247,0.18), rgba(168,85,247,0.06)); border:1px solid rgba(168,85,247,0.3); color:#C084FC;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
        </span>
      </div>
      <div class="val" data-anim-val="${periodTx.length}" data-is-int="true" style="color:#C084FC; font-variant-numeric:tabular-nums;">${periodTx.length}</div>
      <div class="sub">
        <span style="display:inline-flex; align-items:center; gap:5px; font-weight:600; color:#94A3B8;">
          <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:#A855F7;"></span>
          <span>Registros ativos</span>
        </span>
        <span class="kpi-tag kpi-tag-purple">Total</span>
      </div>
    </div>
  </div>

  ${cardSummary.creditCards.length > 0 ? `
  <!-- Resumo de Limite de Cartões de Crédito no Dashboard -->
  <div class="panel cards-summary-panel" style="margin-bottom:20px; border:1px solid rgba(232,176,75,0.25);">
    <div class="panel-head" style="margin-bottom:12px;">
      <h3 style="display:flex;align-items:center;gap:8px;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
        Cartões de Crédito — Limite & Faturas
      </h3>
      <span class="tag" data-nav="cartoes" style="cursor:pointer; background:var(--green-soft); color:var(--green);">Ver todos os cartões</span>
    </div>
    <div class="kpi-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(170px, 1fr)); gap:12px;">
      <div class="kpi" style="background:rgba(255,255,255,0.03); padding:12px 14px; border-radius:10px; border:1px solid var(--card-border);">
        <div class="row1" style="color:var(--text-dim); font-size:12px;">Limite Disponível Total</div>
        <div class="val" data-anim-val="${cardSummary.availableLimitGeral}" style="font-size:20px; font-weight:800; color:var(--green); margin-top:2px;">${fmt(cardSummary.availableLimitGeral)}</div>
        <div class="sub" style="font-size:10.5px; color:var(--text-faint); margin-top:2px;">Para novas compras</div>
      </div>
      <div class="kpi" style="background:rgba(255,255,255,0.03); padding:12px 14px; border-radius:10px; border:1px solid var(--card-border);">
        <div class="row1" style="color:var(--text-dim); font-size:12px;">Fatura do Mês</div>
        <div class="val" data-anim-val="${cardSummary.spentPeriodGeral}" style="font-size:20px; font-weight:800; color:var(--orange); margin-top:2px;">${fmt(cardSummary.spentPeriodGeral)}</div>
        <div class="sub" style="font-size:10.5px; color:var(--text-faint); margin-top:2px;">${periodLabel()}</div>
      </div>
      <div class="kpi" style="background:rgba(255,255,255,0.03); padding:12px 14px; border-radius:10px; border:1px solid var(--card-border);">
        <div class="row1" style="color:var(--text-dim); font-size:12px;">Fatura Acumulada em Aberto</div>
        <div class="val" data-anim-val="${cardSummary.spentTotalGeral}" style="font-size:20px; font-weight:800; color:var(--red); margin-top:2px;">${fmt(cardSummary.spentTotalGeral)}</div>
        <div class="sub" style="font-size:10.5px; color:var(--text-faint); margin-top:2px;">Compras minus pagamentos</div>
      </div>
      <div class="kpi" style="background:rgba(255,255,255,0.03); padding:12px 14px; border-radius:10px; border:1px solid var(--card-border);">
        <div class="row1" style="color:var(--text-dim); font-size:12px;">Limite Aprovado Total</div>
        <div class="val" data-anim-val="${cardSummary.totalLimitGeral}" style="font-size:20px; font-weight:800; color:var(--blue); margin-top:2px;">${fmt(cardSummary.totalLimitGeral)}</div>
        <div class="sub" style="font-size:10.5px; color:var(--text-faint); margin-top:2px;">Soma dos cartões</div>
      </div>
    </div>
    <div style="margin-top:10px;">
      <div style="display:flex; justify-content:space-between; font-size:11.5px; color:var(--text-dim); margin-bottom:4px;">
        <span>Comprometimento Global dos Cartões</span>
        <span style="font-weight:700; color:${cardSummary.usagePctGeral>=90?'var(--red)':cardSummary.usagePctGeral>=70?'var(--orange)':'var(--green)'};">${cardSummary.usagePctGeral}% comprometido</span>
      </div>
      <div class="bar-split" style="height:6px; background:var(--card-border); border-radius:4px; overflow:hidden;">
        <div class="g" style="width:${cardSummary.usagePctGeral}%; height:100%; background:${cardSummary.usagePctGeral>=90?'var(--red)':cardSummary.usagePctGeral>=70?'var(--orange)':'var(--green)'}; border-radius:4px;"></div>
      </div>
    </div>
  </div>
  ` : ''}

  <div class="grid3">
    <!-- Painel 1: Resumo Financeiro (4K Executive Luxury Design) -->
    <div class="panel" style="display:flex; flex-direction:column; justify-content:space-between; height:100%; box-sizing:border-box;">
      <div style="display:flex; flex-direction:column; gap:14px; width:100%;">
        
        <!-- Cabeçalho Executivo 4K Alinhado -->
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="width:38px; height:38px; border-radius:12px; background:linear-gradient(135deg, rgba(59,130,246,0.22), rgba(37,99,235,0.08)); border:1px solid rgba(59,130,246,0.35); display:flex; align-items:center; justify-content:center; box-shadow:0 4px 16px rgba(59,130,246,0.25); flex-shrink:0;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#60A5FA" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 3v18h18"/>
                <path d="M18 17V9"/>
                <path d="M13 17V5"/>
                <path d="M8 17v-3"/>
              </svg>
            </div>
            <div>
              <h3 style="font-size:15px; font-weight:800; color:#FFFFFF; margin:0; letter-spacing:-0.02em;">
                Resumo Financeiro
              </h3>
              <span style="font-size:11px; color:var(--text-dim); margin-top:2px; display:block; opacity:0.85; font-weight:500;">
                Balanço consolidado & fluxo operacional
              </span>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:6px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.11); padding:5px 12px; border-radius:20px; backdrop-filter:blur(10px); box-shadow:0 2px 8px rgba(0,0,0,0.2);">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#60A5FA" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <span style="font-weight:700; font-size:11px; color:var(--text); letter-spacing:0.02em;">${periodLabel()}</span>
          </div>
        </div>

        <!-- 1. Grid de 3 Cards Principais 4K (Receitas, Despesas, Resultado) -->
        <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px;">
          <!-- Receitas -->
          <div style="background:linear-gradient(145deg, rgba(16,185,129,0.10) 0%, rgba(16,185,129,0.02) 100%); border:1px solid rgba(16,185,129,0.25); border-radius:14px; padding:10px 8px; text-align:center; box-shadow:0 4px 16px -2px rgba(16,185,129,0.12), inset 0 1px 0 rgba(255,255,255,0.08);">
            <div style="font-size:9.5px; font-weight:800; text-transform:uppercase; letter-spacing:0.08em; color:#34D399; display:flex; align-items:center; justify-content:center; gap:5px;">
              <span style="width:6px; height:6px; border-radius:50%; background:#10B981; box-shadow:0 0 8px #10B981;"></span>
              Receitas
            </div>
            <b style="color:#34D399; font-size:14px; font-weight:900; margin-top:5px; display:block; font-variant-numeric:tabular-nums; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-shadow:0 0 10px rgba(16,185,129,0.35);">
              ${fmt(receitas)}
            </b>
          </div>

          <!-- Despesas -->
          <div style="background:linear-gradient(145deg, rgba(239,68,68,0.10) 0%, rgba(239,68,68,0.02) 100%); border:1px solid rgba(239,68,68,0.25); border-radius:14px; padding:10px 8px; text-align:center; box-shadow:0 4px 16px -2px rgba(239,68,68,0.12), inset 0 1px 0 rgba(255,255,255,0.08);">
            <div style="font-size:9.5px; font-weight:800; text-transform:uppercase; letter-spacing:0.08em; color:#F87171; display:flex; align-items:center; justify-content:center; gap:5px;">
              <span style="width:6px; height:6px; border-radius:50%; background:#EF4444; box-shadow:0 0 8px #EF4444;"></span>
              Despesas
            </div>
            <b style="color:#F87171; font-size:14px; font-weight:900; margin-top:5px; display:block; font-variant-numeric:tabular-nums; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-shadow:0 0 10px rgba(239,68,68,0.35);">
              ${fmt(despesas)}
            </b>
          </div>

          <!-- Resultado -->
          <div style="background:linear-gradient(145deg, ${resultado >= 0 ? 'rgba(59,130,246,0.10) 0%, rgba(59,130,246,0.02)' : 'rgba(239,68,68,0.12) 0%, rgba(239,68,68,0.03)'} 100%); border:1px solid ${resultado >= 0 ? 'rgba(59,130,246,0.25)' : 'rgba(239,68,68,0.28)'}; border-radius:14px; padding:10px 8px; text-align:center; box-shadow:0 4px 16px -2px ${resultado >= 0 ? 'rgba(59,130,246,0.12)' : 'rgba(239,68,68,0.15)'}, inset 0 1px 0 rgba(255,255,255,0.08);">
            <div style="font-size:9.5px; font-weight:800; text-transform:uppercase; letter-spacing:0.08em; color:${resultado >= 0 ? '#60A5FA' : '#F87171'}; display:flex; align-items:center; justify-content:center; gap:5px;">
              <span style="width:6px; height:6px; border-radius:50%; background:${resultado >= 0 ? '#3B82F6' : '#EF4444'}; box-shadow:0 0 8px ${resultado >= 0 ? '#3B82F6' : '#EF4444'};"></span>
              Resultado
            </div>
            <b style="color:${resultado >= 0 ? '#34D399' : '#F87171'}; font-size:14px; font-weight:900; margin-top:5px; display:block; font-variant-numeric:tabular-nums; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-shadow:0 0 10px ${resultado >= 0 ? 'rgba(52,211,153,0.35)' : 'rgba(239,68,68,0.35)'};">
              ${fmt(resultado)}
            </b>
          </div>
        </div>

        <!-- 2. Medidor Visual de Economia (Executive 4K Precision Gauge) -->
        <div style="display:flex; align-items:center; justify-content:center; position:relative; width:134px; height:134px; margin:4px auto;">
          <svg viewBox="0 0 100 100" style="width:100%; height:100%; transform:rotate(-90deg); filter:drop-shadow(0 4px 14px rgba(0,0,0,0.4));">
            <defs>
              <linearGradient id="meterEmeraldGrad" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#059669"/>
                <stop offset="50%" stop-color="#10B981"/>
                <stop offset="100%" stop-color="#34D399"/>
              </linearGradient>
              <linearGradient id="meterTrackGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="rgba(255,255,255,0.08)"/>
                <stop offset="100%" stop-color="rgba(255,255,255,0.02)"/>
              </linearGradient>
            </defs>
            <!-- Background Outer Precision Guide -->
            <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,0.03)" stroke-width="1" stroke-dasharray="2 3"/>
            <!-- Background Sleek Glass Track (Nunca vermelho quando zerado!) -->
            <circle cx="50" cy="50" r="38" fill="none" stroke="url(#meterTrackGrad)" stroke-width="7.5"/>
            <!-- Inner Concentric Orbit -->
            <circle cx="50" cy="50" r="30.5" fill="none" stroke="rgba(255,255,255,0.035)" stroke-width="1"/>
            
            ${savingsPct > 0 ? `
            <!-- Active Neon Emerald Savings Arc -->
            <circle cx="50" cy="50" r="38" fill="none" stroke="url(#meterEmeraldGrad)" stroke-width="8" stroke-linecap="round" stroke-dasharray="238.76" stroke-dashoffset="${238.76 * (1 - Math.min(savingsPct, 100) / 100)}" style="transition: stroke-dashoffset 0.8s cubic-bezier(0.16, 1, 0.3, 1); filter:drop-shadow(0 0 6px rgba(16,185,129,0.55));"/>
            ` : `
            <!-- Idle Precision Ambient Ring (Zeroed State) -->
            <circle cx="50" cy="50" r="38" fill="none" stroke="rgba(59,130,246,0.18)" stroke-width="7.5" stroke-dasharray="3 5"/>
            `}
          </svg>
          
          <div style="position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; pointer-events:none;">
            <span style="font-size:9px; text-transform:uppercase; letter-spacing:0.14em; font-weight:800; color:var(--text-dim); opacity:0.85;">Economia</span>
            <b style="font-size:23px; font-weight:900; letter-spacing:-0.03em; margin:2px 0; ${savingsPct > 0 ? 'color:#34D399; text-shadow:0 0 12px rgba(16,185,129,0.45);' : 'color:var(--text);'}; line-height:1; font-variant-numeric:tabular-nums;">
              ${savingsPct}%
            </b>
            <span style="font-size:9.5px; color:var(--text-dim); font-weight:600; opacity:0.75;">
              ${receitas > 0 ? 'da receita' : 'da renda'}
            </span>
          </div>
        </div>

        <!-- 3. Indicadores de Saúde Financeira 4K Glass -->
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
          <!-- Comprometimento -->
          <div style="background:linear-gradient(135deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0.01) 100%); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:9px 12px; display:flex; align-items:center; gap:10px; box-shadow:inset 0 1px 0 rgba(255,255,255,0.04);">
            <div style="width:30px; height:30px; border-radius:9px; background:linear-gradient(135deg, rgba(245,158,11,0.2), rgba(217,119,6,0.08)); border:1px solid rgba(245,158,11,0.3); display:flex; align-items:center; justify-content:center; flex-shrink:0; box-shadow:0 2px 8px rgba(245,158,11,0.15);">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#FBBF24" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
            </div>
            <div style="min-width:0;">
              <div style="font-size:9.5px; text-transform:uppercase; letter-spacing:0.04em; color:var(--text-dim); font-weight:700;">Comprometimento</div>
              <div style="font-size:12px; font-weight:800; color:${commitPct > 80 ? '#F87171' : commitPct > 60 ? '#FBBF24' : '#34D399'}; font-variant-numeric:tabular-nums; margin-top:1px;">${commitPct}% da Renda</div>
            </div>
          </div>

          <!-- Média Diária -->
          <div style="background:linear-gradient(135deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0.01) 100%); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:9px 12px; display:flex; align-items:center; gap:10px; box-shadow:inset 0 1px 0 rgba(255,255,255,0.04);">
            <div style="width:30px; height:30px; border-radius:9px; background:linear-gradient(135deg, rgba(59,130,246,0.2), rgba(37,99,235,0.08)); border:1px solid rgba(59,130,246,0.3); display:flex; align-items:center; justify-content:center; flex-shrink:0; box-shadow:0 2px 8px rgba(59,130,246,0.15);">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#60A5FA" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            </div>
            <div style="min-width:0;">
              <div style="font-size:9.5px; text-transform:uppercase; letter-spacing:0.04em; color:var(--text-dim); font-weight:700;">Média Diária</div>
              <div style="font-size:12px; font-weight:800; color:var(--text); font-variant-numeric:tabular-nums; margin-top:1px;">${fmt(dailyAvg)}/dia</div>
            </div>
          </div>
        </div>

        <!-- 4. Barra de Distribuição de Renda 4K -->
        <div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; font-size:11px; font-weight:700;">
            <span style="color:#34D399; display:flex; align-items:center; gap:5px; letter-spacing:0.02em;">
              <span style="width:6px; height:6px; border-radius:50%; background:#10B981; box-shadow:0 0 6px #10B981; display:inline-block;"></span>
              Receitas ${recPct}%
            </span>
            <span style="color:#F87171; display:flex; align-items:center; gap:5px; letter-spacing:0.02em;">
              Despesas ${despPct}%
              <span style="width:6px; height:6px; border-radius:50%; background:#EF4444; box-shadow:0 0 6px #EF4444; display:inline-block;"></span>
            </span>
          </div>
          <div class="bar-split" style="height:7px; border-radius:8px; overflow:hidden; background:${totalFluxo > 0 ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.06)'}; box-shadow:inset 0 1px 3px rgba(0,0,0,0.4); display:flex;">
            <div class="g" style="width:${recPct}%; border-radius:8px; background:linear-gradient(90deg, #10B981, #38BDF8); box-shadow:0 0 8px rgba(16,185,129,0.4); transition:width 0.5s ease;"></div>
          </div>
        </div>

      </div>

      <!-- Rodapé Alinhado com Link Interativo 4K -->
      <div style="margin-top:14px; padding-top:12px; display:flex; justify-content:space-between; align-items:center; font-size:11.5px; color:var(--text-dim); border-top:1px solid rgba(255,255,255,0.07); width:100%;">
        <span style="display:flex; align-items:center; gap:6px;">
          <span style="width:6px; height:6px; border-radius:50%; background:#10B981; box-shadow:0 0 6px #10B981;"></span>
          Poupança: <strong style="color:#34D399; font-weight:800;">${savingsPct}%</strong>
        </span>
        <span style="cursor:pointer; color:#60A5FA; font-weight:700; transition:all 0.2s ease; display:flex; align-items:center; gap:4px;" data-nav="relatorios" class="hover:underline">
          <span>Ver relatórios completos</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
        </span>
      </div>
    </div>

    <!-- Painel 2: Despesas por Categoria (Design Executivo 4K Alinhado) -->
    <div class="panel" style="display:flex; flex-direction:column; justify-content:space-between; height:100%; box-sizing:border-box;">
      <div style="display:flex; flex-direction:column; gap:13px; width:100%;">
        
        <!-- Cabeçalho Executivo 4K Alinhado -->
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="width:38px; height:38px; border-radius:12px; background:linear-gradient(135deg, rgba(245,158,11,0.22), rgba(217,119,6,0.08)); border:1px solid rgba(245,158,11,0.35); display:flex; align-items:center; justify-content:center; box-shadow:0 4px 16px rgba(245,158,11,0.25); flex-shrink:0;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FBBF24" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
                <line x1="7" y1="7" x2="7.01" y2="7"/>
              </svg>
            </div>
            <div>
              <h3 style="font-size:15px; font-weight:800; color:#FFFFFF; margin:0; letter-spacing:-0.02em;">
                Despesas por Categoria
              </h3>
              <span style="font-size:11px; color:var(--text-dim); margin-top:2px; display:block; opacity:0.85; font-weight:500;">
                Distribuição analítica dos gastos
              </span>
            </div>
          </div>
          <span class="tag" style="${actualTotalDesp > 0 ? 'background:rgba(239,68,68,0.12); color:var(--red); border:1px solid rgba(239,68,68,0.25); box-shadow:0 2px 6px rgba(239,68,68,0.15);' : 'background:rgba(255,255,255,0.04); color:var(--text-dim); border:1px solid rgba(255,255,255,0.10);'}; font-weight:800; font-size:12px; padding:4px 10px; border-radius:8px; font-variant-numeric: tabular-nums;">
            ${fmt(actualTotalDesp)}
          </span>
        </div>

        ${cats.length > 0 ? `
        <!-- Barra de Composição Contínua Multi-Segmentos -->
        <div style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.06); border-radius:10px; padding:8px 10px;">
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:10.5px; color:var(--text-dim); margin-bottom:6px; font-weight:600;">
            <span style="display:flex; align-items:center; gap:4px;">
              <span style="width:5px; height:5px; border-radius:50%; background:var(--gold);"></span>
              Composição Visual
            </span>
            <span style="color:var(--text); font-weight:700;">${cats.length} categoria${cats.length === 1 ? '' : 's'}</span>
          </div>
          <div style="width:100%; height:6px; background:rgba(255,255,255,0.08); border-radius:4px; overflow:hidden; display:flex; gap:1.5px; box-shadow:inset 0 1px 2px rgba(0,0,0,0.3);">
            ${cats.map(c => {
              const pct = Math.max(Math.round(c.val / totalDesp * 100), 2);
              return `<div style="width:${pct}%; height:100%; background:${c.color}; border-radius:2px; transition:width 0.4s ease;" title="${c.name}: ${fmt(c.val)} (${pct}%)"></div>`;
            }).join('')}
          </div>
        </div>

        <!-- Lista Executiva em Cards com Alinhamento Preciso e Micro-Barras -->
        <div style="display:flex; flex-direction:column; gap:8px; width:100%; box-sizing:border-box;">
          ${cats.map(c => {
            const pct = Math.round(c.val / totalDesp * 100);
            const icon = getCategoryIcon(c.name);
            const count = periodTx.filter(t => t.cat === c.name && t.type === 'out').length;
            return `
            <div style="display:flex; flex-direction:column; gap:7px; padding:10px 12px; border-radius:12px; background:rgba(255,255,255,0.025); border:1px solid rgba(255,255,255,0.07); border-left:3.5px solid ${c.color}; transition:transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;" class="cat-item-card">
              <div style="display:flex; align-items:center; justify-content:space-between; width:100%; gap:10px;">
                
                <!-- Esquerda: Ícone Estilizado + Nome + Contagem -->
                <div style="display:flex; align-items:center; gap:10px; min-width:0;">
                  <span style="background:${c.color}18; color:${c.color}; border:1px solid ${c.color}35; width:34px; height:34px; border-radius:9px; display:flex; align-items:center; justify-content:center; font-size:15px; flex-shrink:0; box-shadow:0 2px 8px ${c.color}18;">
                    ${icon}
                  </span>
                  <div style="min-width:0;">
                    <div style="font-size:13px; font-weight:700; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${c.name}</div>
                    <div style="font-size:10.5px; color:var(--text-dim); font-weight:500; display:flex; align-items:center; gap:5px; margin-top:1px;">
                      <span>${count} lançamento${count === 1 ? '' : 's'}</span>
                      <span style="opacity:0.4;">•</span>
                      <span style="color:${c.color}; font-weight:700;">${pct}% do total</span>
                    </div>
                  </div>
                </div>

                <!-- Direita: Valor e Percentual em Badge Homogênea -->
                <div style="text-align:right; flex-shrink:0;">
                  <div style="font-size:13.5px; font-weight:800; color:var(--text); font-variant-numeric: tabular-nums; letter-spacing:-0.01em;">
                    ${fmt(c.val)}
                  </div>
                  <div style="display:inline-block; font-size:9.5px; font-weight:700; color:${c.color}; background:${c.color}15; border:1px solid ${c.color}30; padding:1.5px 7px; border-radius:6px; margin-top:2px;">
                    ${pct}%
                  </div>
                </div>
              </div>

              <!-- Micro-Barra de Progresso com Brilho Sutil -->
              <div style="width:100%; height:4.5px; background:rgba(255,255,255,0.06); border-radius:3px; overflow:hidden;">
                <div style="width:${pct}%; height:100%; background:${c.color}; border-radius:3px; box-shadow:0 0 8px ${c.color}40; transition:width .4s ease;"></div>
              </div>
            </div>`;
          }).join('')}
        </div>

        <!-- Box de Insight / Destaque de Concentração -->
        ${cats.length > 0 ? `
        <div style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.06); border-radius:10px; padding:9px 12px; display:flex; align-items:center; gap:9px; margin-top:2px;">
          <span style="font-size:13px; background:rgba(229,169,60,0.12); color:var(--gold); border:1px solid rgba(229,169,60,0.25); width:26px; height:26px; border-radius:7px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">💡</span>
          <div style="font-size:11px; color:var(--text-dim); min-width:0; line-height:1.35;">
            Maior concentração em <strong style="color:var(--text); font-weight:700;">${cats[0].name}</strong> (<span style="color:var(--gold); font-weight:700;">${Math.round(cats[0].val / totalDesp * 100)}%</span> dos gastos).
          </div>
        </div>` : ''}

        ` : `
        <!-- Estado Vazio Executivo 4K (Design de Alta Fidelidade) -->
        <div style="text-align:center; padding:24px 14px 10px; color:var(--text-dim); display:flex; flex-direction:column; align-items:center; justify-content:center;">
          <!-- 4K Holographic Analytics Donut SVG -->
          <div style="width:64px; height:64px; margin:0 auto 12px; border-radius:18px; background:linear-gradient(135deg, rgba(245,158,11,0.18) 0%, rgba(217,119,6,0.04) 100%); border:1px solid rgba(245,158,11,0.30); display:flex; align-items:center; justify-content:center; box-shadow:0 8px 24px -4px rgba(245,158,11,0.25), inset 0 1px 0 rgba(255,255,255,0.12);">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
              <path d="M12 2a10 10 0 0 1 10 10h-5.5a4.5 4.5 0 0 0-4.5-4.5V2z" fill="#F59E0B" opacity="0.95"/>
              <path d="M22 12a10 10 0 0 1-10 10v-5.5a4.5 4.5 0 0 0 4.5-4.5h5.5z" fill="#EF4444" opacity="0.75"/>
              <path d="M12 22A10 10 0 0 1 2 12a10 10 0 0 1 10-10v5.5a4.5 4.5 0 0 0-4.5 4.5 4.5 4.5 0 0 0 4.5 4.5v5.5z" fill="#3B82F6" opacity="0.45"/>
            </svg>
          </div>

          <h4 style="font-size:14.5px; font-weight:800; color:#FFFFFF; margin:0 0 4px 0; letter-spacing:-0.02em;">
            Nenhum gasto categorizado
          </h4>
          <p style="font-size:11.5px; color:var(--text-dim); margin:0 0 14px 0; line-height:1.45; max-width:260px;">
            Suas despesas serão agrupadas automaticamente por grupos e faixas de impacto.
          </p>

          <!-- Category Preview Micro-Chips -->
          <div style="display:flex; justify-content:center; gap:6px; flex-wrap:wrap; margin-top:16px; opacity:0.8;">
            <span style="font-size:10px; font-weight:700; background:rgba(255,255,255,0.035); border:1px solid rgba(255,255,255,0.08); padding:3px 8px; border-radius:12px; color:var(--text-dim); display:flex; align-items:center; gap:4px;">
              <span style="width:5px; height:5px; border-radius:50%; background:#EF4444; box-shadow:0 0 6px #EF4444;"></span> Alimentação
            </span>
            <span style="font-size:10px; font-weight:700; background:rgba(255,255,255,0.035); border:1px solid rgba(255,255,255,0.08); padding:3px 8px; border-radius:12px; color:var(--text-dim); display:flex; align-items:center; gap:4px;">
              <span style="width:5px; height:5px; border-radius:50%; background:#3B82F6; box-shadow:0 0 6px #3B82F6;"></span> Moradia
            </span>
            <span style="font-size:10px; font-weight:700; background:rgba(255,255,255,0.035); border:1px solid rgba(255,255,255,0.08); padding:3px 8px; border-radius:12px; color:var(--text-dim); display:flex; align-items:center; gap:4px;">
              <span style="width:5px; height:5px; border-radius:50%; background:#10B981; box-shadow:0 0 6px #10B981;"></span> Transporte
            </span>
            <span style="font-size:10px; font-weight:700; background:rgba(255,255,255,0.035); border:1px solid rgba(255,255,255,0.08); padding:3px 8px; border-radius:12px; color:var(--text-dim); display:flex; align-items:center; gap:4px;">
              <span style="width:5px; height:5px; border-radius:50%; background:#8B5CF6; box-shadow:0 0 6px #8B5CF6;"></span> Lazer
            </span>
          </div>
        </div>
        `}
      </div>

      <!-- Rodapé Alinhado com Contador e Link Interativo 4K -->
      <div style="margin-top:14px; padding-top:12px; display:flex; justify-content:space-between; align-items:center; font-size:11.5px; color:var(--text-dim); border-top:1px solid rgba(255,255,255,0.07); width:100%;">
        <span style="display:flex; align-items:center; gap:6px;">
          <span style="width:6px; height:6px; border-radius:50%; background:var(--gold); box-shadow:0 0 6px var(--gold);"></span>
          Total: <strong style="color:var(--text); font-weight:700;">${cats.length}</strong> categoria${cats.length === 1 ? '' : 's'}
        </span>
        <span style="cursor:pointer; color:var(--gold); font-weight:700; transition:all 0.2s ease; display:flex; align-items:center; gap:4px;" data-nav="transacoes" class="hover:underline">
          <span>Ver todas as despesas</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
        </span>
      </div>
    </div>

    <!-- Painel 3: Contas e Cartões (Design Executivo 4K Alinhado) -->
    <div class="panel" style="display:flex; flex-direction:column; justify-content:space-between; height:100%; box-sizing:border-box;">
      <div style="display:flex; flex-direction:column; gap:13px; width:100%;">
        
        <!-- Cabeçalho Executivo 4K Alinhado -->
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="width:38px; height:38px; border-radius:12px; background:linear-gradient(135deg, rgba(139,92,246,0.22), rgba(109,40,217,0.08)); border:1px solid rgba(139,92,246,0.35); display:flex; align-items:center; justify-content:center; box-shadow:0 4px 16px rgba(139,92,246,0.25); flex-shrink:0;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="5" width="20" height="14" rx="2"/>
                <line x1="2" y1="10" x2="22" y2="10"/>
              </svg>
            </div>
            <div>
              <h3 style="font-size:15px; font-weight:800; color:#FFFFFF; margin:0; letter-spacing:-0.02em;">
                Contas e Cartões
              </h3>
              <span style="font-size:11px; color:var(--text-dim); margin-top:2px; display:block; opacity:0.85; font-weight:500;">
                Limites, faturas e saldos consolidados
              </span>
            </div>
          </div>
          <button class="tag" data-nav="cartoes" style="font-size:11.5px; padding:5px 12px; font-weight:700; cursor:pointer; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.12); color:var(--text); border-radius:8px; transition:all 0.2s ease; display:flex; align-items:center; gap:5px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            <span>Gerenciar</span>
          </button>
        </div>

        ${accounts.length > 0 ? `
        <div class="accounts-list" style="display:flex; flex-direction:column; gap:8px; width:100%; box-sizing:border-box;">
          ${accounts.slice().sort((a,b)=>a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' })).map(a=>{
            const stats = getCardStats(a);
            return `
            <div class="acc-row" style="display:flex; flex-direction:column; width:100%; box-sizing:border-box; padding:10px 12px; background:rgba(255,255,255,0.025); border:1px solid rgba(255,255,255,0.07); border-left:3.5px solid ${a.color}; border-radius:12px; gap:8px; transition:transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;">
              
              <!-- Linha 1: Nome à Esquerda e Disponível/Saldo à Direita -->
              <div style="display:flex; align-items:center; justify-content:space-between; width:100%; box-sizing:border-box; gap:10px;">
                <div style="display:flex; align-items:center; gap:10px; min-width:0;">
                  <div class="acc-ic" style="background:${a.color}; width:34px; height:34px; border-radius:9px; font-weight:800; font-size:12px; color:#fff; display:flex; align-items:center; justify-content:center; flex-shrink:0; box-shadow:0 3px 10px rgba(0,0,0,0.35); text-shadow:0 1px 2px rgba(0,0,0,0.4);">
                    ${a.name.slice(0,2).toUpperCase()}
                  </div>
                  <div style="min-width:0;">
                    <div style="font-weight:700; font-size:13px; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${a.name}</div>
                    <div style="font-size:10.5px; color:var(--text-dim); margin-top:1px; opacity:0.85; font-weight:500;">${a.type}</div>
                  </div>
                </div>

                <div style="text-align:right; flex-shrink:0;">
                  ${stats.isCreditCard ? `
                    <div style="font-size:9.5px; font-weight:700; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.04em; opacity:0.85;">Disponível</div>
                    <div style="color:${stats.availableLimit < 200 ? 'var(--red)' : 'var(--green)'}; font-weight:800; font-size:13.5px; letter-spacing:-0.01em; font-variant-numeric: tabular-nums;">
                      ${fmt(stats.availableLimit)}
                    </div>
                  ` : `
                    <div style="font-size:9.5px; font-weight:700; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.04em; opacity:0.85;">Saldo</div>
                    <div style="color:${stats.currentBalance < 0 ? 'var(--red)' : 'var(--green)'}; font-weight:800; font-size:13.5px; font-variant-numeric: tabular-nums;">
                      ${fmt(stats.currentBalance)}
                    </div>
                  `}
                </div>
              </div>

              ${stats.isCreditCard ? `
              <!-- Linha 2: Barra de Progresso do Limite (com trilho padronizado mesmo se uso for 0%) -->
              <div style="width:100%; box-sizing:border-box; display:flex; flex-direction:column; gap:5px; padding-top:6px; border-top:1px solid rgba(255,255,255,0.06);">
                <div style="width:100%; height:4.5px; background:rgba(255,255,255,0.08); border-radius:2.5px; overflow:hidden;">
                  <div style="width:${Math.max(stats.usagePct, 0)}%; height:100%; background:${stats.usagePct >= 90 ? 'var(--red)' : stats.usagePct >= 70 ? 'var(--orange)' : 'var(--green)'}; border-radius:2.5px; transition:width .4s ease;"></div>
                </div>
                
                <!-- Linha 3: Fatura na Esquerda e Limite Total na Direita -->
                <div style="display:flex; justify-content:space-between; align-items:center; width:100%; box-sizing:border-box; font-size:11px;">
                  <div style="display:flex; align-items:center; gap:4px; background:rgba(255,255,255,0.03); padding:2px 7px; border-radius:6px;">
                    <span style="color:var(--text-dim); font-size:10px; opacity:0.85;">Fatura:</span>
                    <strong style="color:${stats.spentTotal > 0 ? 'var(--orange)' : 'var(--text-dim)'}; font-weight:700; font-variant-numeric: tabular-nums;">${fmt(stats.spentTotal)}</strong>
                  </div>
                  <div style="display:flex; align-items:center; gap:4px; background:rgba(255,255,255,0.03); padding:2px 7px; border-radius:6px;">
                    <span style="color:var(--text-dim); font-size:10px; opacity:0.85;">Limite:</span>
                    <strong style="color:var(--text); font-weight:700; font-variant-numeric: tabular-nums;">${fmt(stats.totalLimit)}</strong>
                  </div>
                </div>
              </div>
              ` : `
              <!-- Conta Corrente / Poupança / Investimento -->
              <div style="width:100%; box-sizing:border-box; background:rgba(59,130,246,0.06); border:1px solid rgba(59,130,246,0.18); border-radius:8px; padding:6px 10px; display:flex; justify-content:space-between; align-items:center;">
                <span style="font-size:10.5px; font-weight:600; color:var(--text-dim);">Saldo em Conta:</span>
                <strong style="color:${stats.currentBalance < 0 ? 'var(--red)' : 'var(--green)'}; font-weight:800; font-size:13px; font-variant-numeric: tabular-nums;">${fmt(stats.currentBalance)}</strong>
              </div>
              `}
            </div>`;
          }).join('')}
        </div>
        ` : `
        <!-- Estado Vazio Executivo 4K Titanium (Contas e Cartões) -->
        <div style="text-align:center; padding:18px 12px 10px; color:var(--text-dim); display:flex; flex-direction:column; align-items:center; justify-content:center;">
          <!-- 4K Holographic Titanium Card Graphic -->
          <div style="width:108px; height:68px; margin:0 auto 12px; border-radius:12px; background:linear-gradient(135deg, rgba(168,85,247,0.28) 0%, rgba(99,102,241,0.16) 50%, rgba(139,92,246,0.06) 100%); border:1px solid rgba(168,85,247,0.45); box-shadow:0 12px 28px -4px rgba(139,92,246,0.35), inset 0 1px 0 rgba(255,255,255,0.25); display:flex; flex-direction:column; justify-content:space-between; padding:8px 10px; box-sizing:border-box; position:relative; overflow:hidden;">
            <!-- Glow Accent Corner -->
            <div style="position:absolute; top:-15px; right:-15px; width:40px; height:40px; border-radius:50%; background:radial-gradient(circle, rgba(167,139,250,0.6) 0%, transparent 70%);"></div>
            
            <!-- Top Line: Chip & Contactless -->
            <div style="display:flex; justify-content:space-between; align-items:center; position:relative; z-index:1;">
              <div style="width:15px; height:11px; border-radius:3px; background:linear-gradient(135deg, #FBBF24, #D97706); box-shadow:0 1px 3px rgba(0,0,0,0.3); border:0.5px solid rgba(255,255,255,0.3);"></div>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.75)" stroke-width="2" stroke-linecap="round"><path d="M8.5 16.5a5 5 0 0 1 0-9"/><path d="M12 19a8.5 8.5 0 0 1 0-14"/></svg>
            </div>
            
            <!-- Bottom Line: Digits & Brand Spheres -->
            <div style="display:flex; align-items:center; justify-content:space-between; position:relative; z-index:1;">
              <span style="font-family:monospace; font-size:7.5px; letter-spacing:0.12em; color:rgba(255,255,255,0.7); font-weight:800;">•••• 4092</span>
              <div style="display:flex; align-items:center;">
                <span style="width:9px; height:9px; border-radius:50%; background:#EF4444; opacity:0.85; display:inline-block;"></span>
                <span style="width:9px; height:9px; border-radius:50%; background:#F59E0B; opacity:0.85; display:inline-block; margin-left:-3.5px;"></span>
              </div>
            </div>
          </div>

          <h4 style="font-size:14.5px; font-weight:800; color:#FFFFFF; margin:0 0 4px 0; letter-spacing:-0.02em;">
            Nenhum meio de pagamento ativo
          </h4>
          <p style="font-size:11.5px; color:var(--text-dim); margin:0 0 14px 0; line-height:1.45; max-width:270px;">
            Cadastre cartões de crédito, contas digitais ou dinheiro para acompanhar limites e faturas.
          </p>

          <!-- 3 Interactive Feature Preview Slots -->
          <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:6px; width:100%; margin-top:15px;" data-nav="cartoes">
            <div style="background:rgba(255,255,255,0.025); border:1px solid rgba(255,255,255,0.07); border-radius:10px; padding:7px 4px; text-align:center; cursor:pointer; transition:border-color 0.2s ease;">
              <div style="font-size:13px; margin-bottom:2px;">💳</div>
              <div style="font-size:9.5px; font-weight:700; color:var(--text);">Cartão Crédito</div>
              <div style="font-size:8px; color:var(--text-dim); opacity:0.8;">Limites & Fatura</div>
            </div>
            <div style="background:rgba(255,255,255,0.025); border:1px solid rgba(255,255,255,0.07); border-radius:10px; padding:7px 4px; text-align:center; cursor:pointer; transition:border-color 0.2s ease;">
              <div style="font-size:13px; margin-bottom:2px;">🏦</div>
              <div style="font-size:9.5px; font-weight:700; color:var(--text);">Conta Bancária</div>
              <div style="font-size:8px; color:var(--text-dim); opacity:0.8;">Saldos & Pix</div>
            </div>
            <div style="background:rgba(255,255,255,0.025); border:1px solid rgba(255,255,255,0.07); border-radius:10px; padding:7px 4px; text-align:center; cursor:pointer; transition:border-color 0.2s ease;">
              <div style="font-size:13px; margin-bottom:2px;">💵</div>
              <div style="font-size:9.5px; font-weight:700; color:var(--text);">Dinheiro / Espécie</div>
              <div style="font-size:8px; color:var(--text-dim); opacity:0.8;">Controle Físico</div>
            </div>
          </div>
        </div>
        `}
      </div>

      <!-- Rodapé Alinhado com Contador e Link Interativo 4K -->
      <div style="margin-top:14px; padding-top:12px; display:flex; justify-content:space-between; align-items:center; font-size:11.5px; color:var(--text-dim); border-top:1px solid rgba(255,255,255,0.07); width:100%;">
        <span style="display:flex; align-items:center; gap:6px;">
          <span style="width:6px; height:6px; border-radius:50%; background:var(--purple); box-shadow:0 0 6px var(--purple);"></span>
          Total: <strong style="color:var(--text); font-weight:700;">${accounts.length}</strong> conta${accounts.length === 1 ? '' : 's'}/cartões
        </span>
        <span style="cursor:pointer; color:var(--purple); font-weight:700; transition:all 0.2s ease; display:flex; align-items:center; gap:4px;" data-nav="cartoes" class="hover:underline">
          <span>Ver todas as contas</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
        </span>
      </div>
    </div>
  </div>

  ${pendingSummary.items.length > 0 ? `
  <!-- Mini Card Quadrado Compacto & Discreto (Posicionado com Organização Perfeita) -->
  <div class="panel due-bills-panel" style="margin-bottom:22px; padding:14px 18px; border:1px solid ${pendingSummary.overdueCount > 0 ? 'rgba(239,90,90,0.5)' : 'rgba(240,166,58,0.45)'}; background:${pendingSummary.overdueCount > 0 ? 'rgba(239,90,90,0.08)' : 'rgba(240,166,58,0.06)'}; border-radius:16px; box-shadow: 0 4px 15px rgba(0,0,0,0.2);">
    
    <!-- Cabeçalho Discreto -->
    <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:10px; padding-bottom:8px; border-bottom:1px solid var(--card-border);">
      <div style="display:flex; align-items:center; gap:6px;">
        <span style="font-size:15px;">${pendingSummary.overdueCount > 0 ? '🚨' : '⚠️'}</span>
        <h4 style="margin:0; font-size:12.5px; font-weight:800; letter-spacing:0.02em; color:${pendingSummary.overdueCount > 0 ? 'var(--red)' : 'var(--orange)'}; text-transform:uppercase;">
          CONTAS A VENCER (${pendingSummary.items.length})
        </h4>
      </div>
      <span style="font-size:11px; font-weight:700; color:var(--text-dim);">
        Total: <strong style="color:var(--red);">${fmt(pendingSummary.totalValue)}</strong>
      </span>
    </div>

    <!-- Lista Enxuta Sem Cortes -->
    <div class="due-bills-list" style="display:flex; flex-direction:column; gap:6px;">
      ${pendingSummary.items.map(item => `
        <div class="due-bill-row" style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:6px 12px; padding:8px 12px; border-radius:8px; background:var(--card); border:1px solid ${item.statusType === 'overdue' ? 'rgba(239,90,90,0.4)' : item.statusType === 'today' ? 'rgba(240,166,58,0.4)' : 'var(--card-border)'}; font-size:12px;">
          
          <div style="display:flex; align-items:center; gap:8px; flex:1; min-width:180px;">
            <!-- Sinal de Emergência -->
            <span style="font-size:13px; flex-shrink:0;" title="${item.statusText}">
              ${item.statusType === 'overdue' ? '🚨' : item.statusType === 'today' ? '⚡' : '⚠️'}
            </span>

            <div style="display:flex; align-items:center; flex-wrap:wrap; gap:4px 8px;">
              <span style="font-weight:700; color:var(--text);">${item.desc}</span>
              <!-- Vencimento na Frente -->
              <span style="font-size:11px; font-weight:700; color:${item.statusType === 'overdue' ? 'var(--red)' : 'var(--orange)'}; background:${item.statusType === 'overdue' ? 'var(--red-soft)' : 'rgba(240,166,58,0.15)'}; padding:1px 6px; border-radius:4px;">
                Vence: ${item.formattedDate}
              </span>
            </div>
          </div>

          <!-- Valor & Botão Pagar -->
          <div style="display:flex; align-items:center; gap:10px; flex-shrink:0;">
            <span style="font-size:13px; font-weight:800; color:var(--red);">${fmt(item.val)}</span>
            <button class="btn-primary" data-paytx="${item.id}" title="Marcar como Pago" style="padding:3px 8px; font-size:10.5px; font-weight:700; background:linear-gradient(135deg, var(--green), #c9862a); border:none; border-radius:6px; cursor:pointer; color:#08130c; white-space:nowrap;">
              ✅ Pagar
            </button>
          </div>
        </div>
      `).join('')}
    </div>

  </div>
  ` : ''}

  <div class="table-panel">
    <div class="panel-head"><h3>Últimas Transações</h3><span class="tag" data-nav="transacoes">Ver todas</span></div>
    ${transactionsTable(lastTx, false)}
  </div>
  `;
}

function getAccountIcon(accName) {
  if (!accName) return '💳';
  const name = accName.toLowerCase();
  if (name.includes('banco') || name.includes('brasil') || name.includes('itau') || name.includes('bradesco') || name.includes('santander') || name.includes('caixa') || name.includes('nubank') || name.includes('inter') || name.includes('sifre')) return '🏦';
  if (name.includes('dinheiro') || name.includes('espécie') || name.includes('carteira')) return '💵';
  if (name.includes('boleto') || name.includes('pix') || name.includes('outros')) return '⚡';
  return '💳';
}

function transactionsTable(list, showActions){
  if (typeof isDataLoading !== 'undefined' && isDataLoading && list.length === 0) {
    return `<div class="placeholder" style="padding:40px 20px;"><div class="big" style="font-size:30px;margin-bottom:12px;">⏳</div><h3>Carregando suas transações...</h3><p>Sincronizando seus dados financeiros com o servidor.</p></div>`;
  }
  if(list.length===0) {
    const totalAllTxs = Array.isArray(transactions) ? transactions.length : 0;
    const isFiltered = Boolean(
      (typeof document !== 'undefined') && (
        (document.getElementById('txSearch') && document.getElementById('txSearch').value.trim()) ||
        (document.getElementById('txFiltroTipo') && document.getElementById('txFiltroTipo').value) ||
        (document.getElementById('txFiltroCat') && document.getElementById('txFiltroCat').value) ||
        (document.getElementById('txFiltroStatus') && document.getElementById('txFiltroStatus').value) ||
        (document.getElementById('txFiltroConta') && document.getElementById('txFiltroConta').value)
      )
    );

    if (totalAllTxs > 0) {
      return `
      <div class="placeholder" style="padding:36px 20px; text-align:center;">
        <div class="big" style="font-size:34px; margin-bottom:10px;">🔍</div>
        <h3 style="font-size:16px; font-weight:800; color:var(--text); margin-bottom:6px;">
          ${isFiltered ? 'Nenhum lançamento encontrado para os filtros selecionados' : 'Nenhuma transação encontrada no período de ' + periodLabel()}
        </h3>
        <p style="font-size:12.5px; color:var(--text-dim); margin-bottom:16px; max-width:480px; margin-left:auto; margin-right:auto; line-height:1.5;">
          Você possui <strong style="color:var(--text);">${totalAllTxs} lançamento(s)</strong> no seu extrato geral.
        </p>
        <div style="display:flex; justify-content:center; gap:10px; flex-wrap:wrap;">
          <button type="button" class="btn-primary" onclick="window.clearAllTxFilters(true)" style="padding:8px 16px; font-size:12.5px; font-weight:700; border-radius:10px; cursor:pointer; display:inline-flex; align-items:center; gap:6px;">
            🌐 Ver Todas as Transações (Todas as Datas)
          </button>
          ${isFiltered ? `
          <button type="button" class="btn-ghost" onclick="window.clearAllTxFilters(false)" style="padding:8px 16px; font-size:12.5px; font-weight:700; border-radius:10px; cursor:pointer; border:1px solid rgba(255,255,255,0.15); color:var(--text);">
            ✕ Limpar Filtros do Mês
          </button>` : ''}
        </div>
      </div>`;
    }

    return `<div class="placeholder"><div class="big">🗂️</div><h3>Nenhuma transação encontrada</h3><p>Nenhuma transação registrada no período selecionado.</p></div>`;
  }

  const totalDespesas = list.filter(t=>t.type==='out').reduce((s,t)=>s+parseInputValue(t.val), 0);
  const totalReceitas = list.filter(t=>t.type==='in').reduce((s,t)=>s+parseInputValue(t.val), 0);
  const saldoPeriodo = totalReceitas - totalDespesas;
  const countDespesas = list.filter(t=>t.type==='out').length;
  const countReceitas = list.filter(t=>t.type==='in').length;

  return `
  <table>
    <thead>
      <tr>
        <th>Data</th>
        <th>Descrição</th>
        <th>Categoria</th>
        <th>Conta / Cartão</th>
        <th>Tipo</th>
        <th>Valor</th>
        <th>Status</th>
        ${showActions?'<th style="text-align:center;">Ações</th>':''}
      </tr>
    </thead>
    <tbody>
      ${list.map(t=>{
        const method = t.paymentMethod || detectPaymentMethodFromName(t.desc) || ((t.cat && t.cat.toLowerCase().includes('cartão')) || (t.acc && t.acc.toLowerCase().includes('cartão')) ? 'Cartão de Crédito' : (t.type === 'out' ? 'Boleto' : null));
        return `
        <tr class="trow">
          <td><span class="tx-date-badge">${formatDateBR(t.date)}</span></td>
          <td class="tx-desc">
            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
              <span>${t.desc}</span>
              ${t.type === 'out' && method ? `<span class="pill" style="padding:1.5px 6px; font-size:10px; font-weight:700; border-radius:5px; background:${method === 'Cartão de Crédito' ? 'rgba(168,85,247,0.16)' : 'rgba(245,158,11,0.16)'}; color:${method === 'Cartão de Crédito' ? '#C084FC' : '#FBBF24'}; border:1px solid ${method === 'Cartão de Crédito' ? 'rgba(168,85,247,0.35)' : 'rgba(245,158,11,0.35)'};">${method === 'Cartão de Crédito' ? '💳 Cartão' : '📄 Boleto'}</span>` : ''}
            </div>
          </td>
          <td><span class="pill cat-pill" style="background:${catColor(t.cat)}18; color:${catColor(t.cat)}; border:1px solid ${catColor(t.cat)}35">${catIcon(t.cat)} ${t.cat}</span></td>
          <td><span class="pill acc-pill">${getAccountIcon(t.acc)} ${t.acc || '—'}</span></td>
          <td><span class="type-pill ${t.type}">${t.type==='in'?'↑ Receita':'↓ Despesa'}</span></td>
          <td class="${t.type==='in'?'val-in':'val-out'}">${t.type==='in'?'+':'-'}${fmt(t.val)}</td>
          <td>
            <span class="pill status-${t.status.toLowerCase()} status-toggle-btn" data-togglestatus="${t.id}" title="Clique para alternar o status (Pendente / Pago)">
              ${t.status === 'Pendente' ? '⏳ Pendente' : (t.type === 'in' ? '✓ Recebido' : '✓ Pago')}
            </span>
          </td>
          ${showActions?`<td><div class="row-actions" style="justify-content:center;"><button data-edit="${t.id}" title="Editar Transação" class="btn-action-edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg></button><button data-del="${t.id}" title="Excluir Transação" class="btn-action-del"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg></button></div></td>`:''}
        </tr>`;
      }).join('')}
    </tbody>
    <tfoot>
      <tr class="tfoot-row">
        <td colspan="5" class="tfoot-label">TOTAL DE GASTOS (${countDespesas} despesa${countDespesas===1?'':'s'}):</td>
        <td class="tfoot-value">-${fmt(totalDespesas)}</td>
        <td colspan="${showActions?2:1}"></td>
      </tr>
    </tfoot>
  </table>

  <!-- Aba / Card com Cálculo Consolidado dos Gastos ao final -->
  <div class="tx-footer-summary">
    <div class="tx-summary-card expense">
      <div class="tx-summary-icon expense">↓</div>
      <div>
        <div class="tx-summary-label">Cálculo Total de Gastos</div>
        <div class="tx-summary-val expense">-${fmt(totalDespesas)}</div>
        <div class="tx-summary-sub">${countDespesas} lançamento(s) de despesa</div>
      </div>
    </div>

    <div class="tx-summary-card income">
      <div class="tx-summary-icon income">↑</div>
      <div>
        <div class="tx-summary-label">Total de Entradas (Receitas)</div>
        <div class="tx-summary-val income">+${fmt(totalReceitas)}</div>
        <div class="tx-summary-sub">${countReceitas} lançamento(s) de receita</div>
      </div>
    </div>

    <div class="tx-summary-card ${saldoPeriodo < 0 ? 'expense' : 'balance'}">
      <div class="tx-summary-icon ${saldoPeriodo < 0 ? 'expense' : 'balance'}">⇄</div>
      <div>
        <div class="tx-summary-label">Balanço do Período</div>
        <div class="tx-summary-val ${saldoPeriodo < 0 ? 'expense' : 'income'}">${fmt(saldoPeriodo)}</div>
        <div class="tx-summary-sub">${list.length} registro(s) no filtro</div>
      </div>
    </div>
  </div>`;
}

function pageTransacoes(){
  const periodTx = transactions.filter(inPeriod);
  const accOptsHTML = accounts.slice().sort((a,b)=>a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' })).map(a => '<option value="' + a.name + '">' + a.name + ' (' + a.type + ')</option>').join('');
  const totalDesp = periodTx.filter(t=>t.type==='out').reduce((s,t)=>s+parseInputValue(t.val),0);
  const totalRec = periodTx.filter(t=>t.type==='in').reduce((s,t)=>s+parseInputValue(t.val),0);
  const saldoPer = totalRec - totalDesp;

  return `
  <div class="page-head">
    <div>
      <h1 style="font-size:22px; font-weight:800; letter-spacing:-0.02em; margin:0; display:flex; align-items:center; gap:8px;">
        Transações — <span style="color:var(--green);">${periodLabel()}</span>
      </h1>
      <p style="font-size:12.5px; color:var(--text-dim); margin:4px 0 0 0; font-weight:500;">
        Gerencie e filtre todas as suas receitas e despesas com atualização em tempo real
      </p>
    </div>
    <div class="head-actions" style="display:flex; align-items:center; gap:10px;">
      ${periodPickerHTML()}
      <button class="btn-ghost" id="btnGerenciarCategorias" style="display:flex; align-items:center; gap:6px;">🏷️ Categorias</button>
      <button class="btn-primary" id="btnNovaTransacao" style="display:flex; align-items:center; gap:6px; font-weight:700;">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Nova Transação
      </button>
    </div>
  </div>

  <div class="kpis" id="txStatsRow" style="grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:14px; margin-bottom:18px;">
    <div class="kpi" style="padding:14px 16px;">
      <div class="row1" style="margin-bottom:6px;"><span>Total de Receitas</span><span class="ic" style="width:32px; height:32px; font-size:14px; background:rgba(16,185,129,0.14); color:var(--green);">↑</span></div>
      <div class="val" style="font-size:20px; color:var(--green); margin-bottom:2px;">${fmt(totalRec)}</div>
      <div class="sub" style="font-size:11px;">Entradas no período</div>
    </div>
    <div class="kpi" style="padding:14px 16px;">
      <div class="row1" style="margin-bottom:6px;"><span>Total de Despesas</span><span class="ic" style="width:32px; height:32px; font-size:14px; background:rgba(239,68,68,0.14); color:var(--red);">↓</span></div>
      <div class="val" style="font-size:20px; color:var(--red); margin-bottom:2px;">${fmt(totalDesp)}</div>
      <div class="sub" style="font-size:11px;">Saídas no período</div>
    </div>
    <div class="kpi" style="padding:14px 16px;">
      <div class="row1" style="margin-bottom:6px;"><span>Balanço Líquido</span><span class="ic" style="width:32px; height:32px; font-size:14px; background:${saldoPer < 0 ? 'rgba(239,68,68,0.14)' : 'rgba(59,130,246,0.14)'}; color:${saldoPer < 0 ? 'var(--red)' : 'var(--blue)'};">⇄</span></div>
      <div class="val" style="font-size:20px; color:${saldoPer < 0 ? 'var(--red)' : 'var(--green)'}; margin-bottom:2px;">${fmt(saldoPer)}</div>
      <div class="sub" style="font-size:11px;">Receitas − Despesas</div>
    </div>
    <div class="kpi" style="padding:14px 16px;">
      <div class="row1" style="margin-bottom:6px;"><span>Total de Registros</span><span class="ic" style="width:32px; height:32px; font-size:14px; background:rgba(168,85,247,0.14); color:var(--purple);">📋</span></div>
      <div class="val" style="font-size:20px; margin-bottom:2px;">${periodTx.length}</div>
      <div class="sub" style="font-size:11px;">Lançamentos no período</div>
    </div>
  </div>

  <div class="table-panel">
    <div class="filters" style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:16px; align-items:center;">
      <div style="position:relative; flex:1.5; min-width:200px;">
        <input id="txSearch" type="search" name="tx_filter_query_safe" autocomplete="one-time-code" data-lpignore="true" data-form-type="other" data-1p-ignore="true" spellcheck="false" placeholder="🔍 Buscar por descrição, valor, categoria..." style="width:100%; font-size:13px;">
      </div>
      <select id="txFiltroConta" style="flex:1; min-width:160px;"><option value="">Todas as Contas / Cartões</option>${accOptsHTML}</select>
      <select id="txFiltroTipo" style="flex:0.8; min-width:120px;"><option value="">Todos os tipos</option><option value="in">Receitas</option><option value="out">Despesas</option></select>
      <select id="txFiltroCat" style="flex:1; min-width:140px;"><option value="">Todas categorias</option>${catOptionsHTML(null)}</select>
      <select id="txFiltroStatus" style="flex:0.8; min-width:120px;"><option value="">Todos status</option><option>Pago</option><option>Recebido</option><option>Pendente</option></select>
      <button type="button" id="btnResetTxFilters" class="btn-ghost" title="Limpar filtros ativos" style="display:none; align-items:center; gap:5px; padding:7px 12px; font-size:12px; font-weight:700; border-radius:9px; border:1px solid rgba(255,255,255,0.15); color:var(--text); cursor:pointer; white-space:nowrap;">
        ✕ Limpar Filtros
      </button>
    </div>
    <div id="txTableWrap">${transactionsTable(periodTx.slice().sort((a,b)=>b.date.localeCompare(a.date)), true)}</div>
  </div>`;
}

function pageContas(){
  const list = accounts.slice().sort((a,b)=>a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
  const summary = computeCardSummary();
  
  return `
  <div class="page-head">
    <div>
      <h1 style="font-size:22px; font-weight:800; letter-spacing:-0.02em; margin:0; display:flex; align-items:center; gap:8px;">
        Cartões e Contas Bancárias
      </h1>
      <p style="font-size:12.5px; color:var(--text-dim); margin:4px 0 0 0; font-weight:500;">
        Acompanhe o limite disponível dos cartões de crédito e os saldos consolidados de suas contas
      </p>
    </div>
    <div class="head-actions" style="display:flex; align-items:center; gap:10px;">
      ${periodPickerHTML()}
      <button class="btn-primary" id="btnNovaConta" style="display:flex; align-items:center; gap:6px; font-weight:700;">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Novo Cartão / Conta
      </button>
    </div>
  </div>

  ${summary.creditCards.length > 0 ? `
  <!-- Resumo Consolidado de Limite de Cartões -->
  <div class="panel cards-summary-panel" style="margin-bottom:20px; border:1px solid rgba(232,176,75,0.25);">
    <div class="panel-head" style="margin-bottom:14px;">
      <h3 style="display:flex;align-items:center;gap:8px;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
        Visão Geral dos Cartões de Crédito
      </h3>
      <span class="tag" style="cursor:default; background:var(--green-soft); color:var(--green); font-weight:700;">${summary.creditCards.length} cartão(ões)</span>
    </div>
    <div class="kpi-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:14px;">
      <div class="kpi" style="background:rgba(255,255,255,0.03); padding:14px; border-radius:14px; border:1px solid var(--card-border);">
        <div class="row1" style="color:var(--text-dim); font-size:12px; font-weight:600;">Limite Disponível Total</div>
        <div class="val" style="font-size:22px; font-weight:800; color:var(--green); margin-top:4px;">${fmt(summary.availableLimitGeral)}</div>
        <div class="sub" style="font-size:11px; color:var(--text-faint); margin-top:2px;">Disponível para compras</div>
      </div>
      <div class="kpi" style="background:rgba(255,255,255,0.03); padding:14px; border-radius:14px; border:1px solid var(--card-border);">
        <div class="row1" style="color:var(--text-dim); font-size:12px; font-weight:600;">Fatura do Mês (${periodLabel()})</div>
        <div class="val" style="font-size:22px; font-weight:800; color:var(--orange); margin-top:4px;">${fmt(summary.spentPeriodGeral)}</div>
        <div class="sub" style="font-size:11px; color:var(--text-faint); margin-top:2px;">Gastos no mês selecionado</div>
      </div>
      <div class="kpi" style="background:rgba(255,255,255,0.03); padding:14px; border-radius:14px; border:1px solid var(--card-border);">
        <div class="row1" style="color:var(--text-dim); font-size:12px; font-weight:600;">Fatura Acumulada em Aberto</div>
        <div class="val" style="font-size:22px; font-weight:800; color:var(--red); margin-top:4px;">${fmt(summary.spentTotalGeral)}</div>
        <div class="sub" style="font-size:11px; color:var(--text-faint); margin-top:2px;">Compras menos pagamentos</div>
      </div>
      <div class="kpi" style="background:rgba(255,255,255,0.03); padding:14px; border-radius:14px; border:1px solid var(--card-border);">
        <div class="row1" style="color:var(--text-dim); font-size:12px; font-weight:600;">Limite Total Aprovado</div>
        <div class="val" style="font-size:22px; font-weight:800; color:var(--blue); margin-top:4px;">${fmt(summary.totalLimitGeral)}</div>
        <div class="sub" style="font-size:11px; color:var(--text-faint); margin-top:2px;">Soma de todos os cartões</div>
      </div>
    </div>
    <div style="margin-top:14px;">
      <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--text-dim); margin-bottom:6px;">
        <span>Comprometimento global do limite de crédito</span>
        <span style="font-weight:700; color:${summary.usagePctGeral>=90?'var(--red)':summary.usagePctGeral>=70?'var(--orange)':'var(--green)'};">${summary.usagePctGeral}% comprometido</span>
      </div>
      <div class="bar-split" style="height:8px; background:var(--card-border); border-radius:6px; overflow:hidden;">
        <div class="g" style="width:${summary.usagePctGeral}%; height:100%; background:${summary.usagePctGeral>=90?'var(--red)':summary.usagePctGeral>=70?'var(--orange)':'var(--green)'}; border-radius:6px; transition:width .3s ease;"></div>
      </div>
    </div>
  </div>
  ` : ''}

  <div class="grid3" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:20px; align-items:stretch;">
    ${list.length ? list.map(a => {
      const stats = getCardStats(a);
      const isCard = stats.isCreditCard;
      const initialName = (a.name || '').slice(0,2).toUpperCase();
      const statusColor = isCard ? (stats.availableLimit < 200 ? 'var(--red)' : 'var(--green)') : (stats.currentBalance < 0 ? 'var(--red)' : 'var(--green)');
      const heroVal = isCard ? stats.availableLimit : stats.currentBalance;
      const cardColor = a.color || (isCard ? '#8B5CF6' : '#10B981');

      return `
      <div class="acc-card">
        <div class="acc-card-accent-bar" style="background:linear-gradient(90deg, ${cardColor} 0%, rgba(59,130,246,0.6) 100%);"></div>
        <div>
          <div class="top" style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:14px;">
            <div class="id-group" style="display:flex; align-items:center; gap:12px; min-width:0;">
              <span class="acc-card-emblem" style="background:linear-gradient(135deg, ${cardColor} 0%, rgba(15,23,42,0.9) 140%);">
                ${initialName}
              </span>
              <div style="min-width:0;">
                <h3 style="font-size:16.5px; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin:0 0 4px 0; color:var(--text); letter-spacing:-0.02em;">${a.name}</h3>
                <span class="acc-card-chip ${isCard ? 'credit' : 'bank'}">
                  ${isCard ? '💳 Cartão de Crédito' : '🏦 ' + (a.type || 'Conta Bancária')}
                </span>
              </div>
            </div>
            <div class="row-actions" style="display:flex; gap:6px;">
              <button data-editacc="${a.id}" title="Editar Conta" class="btn-action-edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg></button>
              <button data-delacc="${a.id}" title="Excluir Conta" class="btn-action-del"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg></button>
            </div>
          </div>

          <div class="acc-card-metrics">
            <div class="acc-metric-hero-label">
              <span>${isCard ? 'Limite Disponível' : 'Saldo Disponível em Conta'}</span>
              <span style="display:inline-flex; align-items:center; gap:5px; font-size:10.5px; color:inherit; text-transform:none;">
                <span style="width:6px; height:6px; border-radius:50%; background:${statusColor}; display:inline-block;"></span>
                ${isCard ? (stats.availableLimit < 200 ? 'Limite Baixo' : 'Disponível') : (stats.currentBalance < 0 ? 'Negativo' : 'Positivo')}
              </span>
            </div>
            <div class="acc-metric-hero-val" style="color:${statusColor};">
              ${fmt(heroVal)}
            </div>

            ${isCard ? `
              <div class="acc-subgrid">
                <div class="acc-subgrid-col">
                  <span class="acc-subgrid-label">Fatura do Mês</span>
                  <span class="acc-subgrid-val" style="color:var(--orange);">${fmt(stats.spentTotal)}</span>
                </div>
                <div class="acc-subgrid-col" style="text-align:right;">
                  <span class="acc-subgrid-label">Limite Total</span>
                  <span class="acc-subgrid-val" style="color:var(--text);">${fmt(stats.totalLimit)}</span>
                </div>
              </div>
              <div style="margin-top:12px;">
                <div class="bar-split" style="height:7px; background:rgba(0,0,0,0.08); border-radius:5px; overflow:hidden; border:1px solid rgba(255,255,255,0.06);">
                  <div class="g" style="width:${stats.usagePct}%; height:100%; background:${stats.usagePct >= 90 ? 'linear-gradient(90deg, #EF4444, #DC2626)' : stats.usagePct >= 70 ? 'linear-gradient(90deg, #F59E0B, #D97706)' : 'linear-gradient(90deg, #10B981, #059669)'}; border-radius:5px; transition:width .4s ease;"></div>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; margin-top:5px;">
                  <span style="color:var(--text-faint); font-weight:600;">Uso do Cartão</span>
                  <span style="font-weight:800; color:${stats.usagePct >= 90 ? 'var(--red)' : stats.usagePct >= 70 ? 'var(--orange)' : 'var(--green)'};">${stats.usagePct}% utilizado</span>
                </div>
              </div>
            ` : `
              <div class="acc-subgrid">
                <div class="acc-subgrid-col">
                  <span class="acc-subgrid-label">Entradas no Mês</span>
                  <span class="acc-subgrid-val" style="color:var(--green);">+${fmt(stats.periodIn)}</span>
                </div>
                <div class="acc-subgrid-col" style="text-align:right;">
                  <span class="acc-subgrid-label">Saídas no Mês</span>
                  <span class="acc-subgrid-val" style="color:var(--red);">-${fmt(stats.spentTotal)}</span>
                </div>
              </div>
              <div style="margin-top:10px; display:flex; justify-content:space-between; align-items:center; font-size:11px; color:var(--text-faint);">
                <span>Saldo Inicial:</span>
                <strong style="color:var(--text); font-variant-numeric:tabular-nums;">${fmt(stats.initialBalance)}</strong>
              </div>
            `}
          </div>
        </div>

        <button class="acc-view-tx-btn" data-viewcardtx="${a.name}" title="Ver todos os lançamentos desta conta">
          <div class="btn-left">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><line x1="7" y1="8" x2="17" y2="8"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="7" y1="16" x2="13" y2="16"/></svg>
            <span>Ver Lançamentos</span>
            <span class="btn-count-pill">${stats.txCount}</span>
          </div>
          <div class="btn-arrow">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          </div>
        </button>
      </div>`;
    }).join('') : `<div class="placeholder"><div class="big">🏦</div><h3>Nenhuma conta cadastrada</h3><p>Cadastre suas contas bancárias e cartões de crédito para gerenciar seus saldos.</p></div>`}
  </div>`;
}

function pageOrcamentos(){
  const list = budgetStatus();
  return `
  <div class="page-head">
    <div>
      <h1 style="font-size:22px; font-weight:800; letter-spacing:-0.02em; margin:0; display:flex; align-items:center; gap:8px;">
        Orçamentos por Categoria
      </h1>
      <p style="font-size:12.5px; color:var(--text-dim); margin:4px 0 0 0; font-weight:500;">
        Defina e acompanhe limites de gastos para manter seu planejamento sob controle — <strong style="color:var(--green);">${periodLabel()}</strong>
      </p>
    </div>
    <div class="head-actions" style="display:flex; align-items:center; gap:10px;">
      ${periodPickerHTML()}
      <button class="btn-primary" id="btnNovoOrcamento" style="display:flex; align-items:center; gap:6px; font-weight:700;">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Novo Orçamento
      </button>
    </div>
  </div>
  <div class="cat-cards" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:18px;">
    ${list.length ? list.map(b => {
      const color = b.pct >= 100 ? 'var(--red)' : b.pct >= 80 ? 'var(--orange)' : 'var(--green)';
      const remaining = b.limit - b.spent;
      const isOver = remaining < 0;
      return `
      <div class="budget-card">
        <div>
          <div class="top" style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px; gap:10px;">
            <div class="id-group" style="display:flex; align-items:center; gap:10px; min-width:0;">
              <span class="dot" style="background:${catColor(b.category)}; width:34px; height:34px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:16px; box-shadow:0 2px 8px ${catColor(b.category)}35;">
                ${catIcon(b.category)}
              </span>
              <div style="min-width:0;">
                <h4 style="font-size:15px; font-weight:800; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${b.category}</h4>
                <span class="pill" style="font-size:10.5px; padding:2px 8px; border-radius:6px; background:${b.pct>=100?'rgba(239,68,68,0.14)':b.pct>=80?'rgba(245,158,11,0.14)':'rgba(16,185,129,0.14)'}; color:${color}; font-weight:700; border:1px solid ${b.pct>=100?'rgba(239,68,68,0.3)':b.pct>=80?'rgba(245,158,11,0.3)':'rgba(16,185,129,0.3)'};">
                  ${b.pct>=100 ? '🚨 Excedido' : b.pct>=80 ? '⚠️ Alerta' : '✓ Normal'} (${b.pct}%)
                </span>
              </div>
            </div>
            <div class="row-actions" style="display:flex; gap:6px;">
              <button data-editorc="${b.id}" title="Editar Orçamento" class="btn-action-edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg></button>
              <button data-delorc="${b.id}" title="Excluir Orçamento" class="btn-action-del"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg></button>
            </div>
          </div>
          
          <div style="margin:14px 0 10px;">
            <div style="display:flex; justify-content:space-between; align-items:baseline;">
              <span style="font-size:22px; font-weight:800; color:${color}; font-variant-numeric:tabular-nums;">${fmt(b.spent)}</span>
              <span style="font-size:13px; color:var(--text-faint); font-weight:600;">Limite: ${fmt(b.limit)}</span>
            </div>
            <div class="bar-split" style="height:7px; background:rgba(255,255,255,0.08); border-radius:5px; overflow:hidden; margin-top:8px;">
              <div class="g" style="width:${Math.min(b.pct, 100)}%; background:${color}; border-radius:5px; transition:width .4s ease;"></div>
            </div>
          </div>
        </div>

        <div style="margin-top:10px; padding-top:10px; border-top:1px solid rgba(255,255,255,0.06); display:flex; justify-content:space-between; align-items:center; font-size:11.5px;">
          <span style="color:var(--text-dim); font-weight:500;">
            ${isOver ? 'Excedido em:' : 'Restante disponível:'}
          </span>
          <strong style="color:${isOver ? 'var(--red)' : 'var(--green)'}; font-weight:800; font-variant-numeric:tabular-nums;">
            ${isOver ? '-' + fmt(Math.abs(remaining)) : fmt(remaining)}
          </strong>
        </div>
      </div>`;
    }).join('') : `<div class="placeholder"><div class="big">◔</div><h3>Nenhum orçamento definido</h3><p>Crie limites mensais por categoria para controlar suas despesas e poupar mais.</p></div>`}
  </div>`;
}

function pageMetas(){
  return `
  <div class="page-head">
    <div>
      <h1 style="font-size:22px; font-weight:800; letter-spacing:-0.02em; margin:0; display:flex; align-items:center; gap:8px;">
        Metas e Objetivos Financeiros
      </h1>
      <p style="font-size:12.5px; color:var(--text-dim); margin:4px 0 0 0; font-weight:500;">
        Planeje e alcance seus sonhos com metas estruturadas e controle de progresso
      </p>
    </div>
    <div class="head-actions">
      <button class="btn-primary" id="btnNovaMeta" style="display:flex; align-items:center; gap:6px; font-weight:700;">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Nova Meta
      </button>
    </div>
  </div>
  <div class="cat-cards" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(290px, 1fr)); gap:18px;">
    ${goals.length ? goals.map(g => {
      const pct = Math.min(100, Math.round(g.current / g.target * 100));
      const remaining = Math.max(0, g.target - g.current);
      const isCompleted = pct >= 100;
      return `
      <div class="goal-card">
        <div>
          <div class="top" style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px; gap:10px;">
            <div style="min-width:0;">
              <h3 style="font-size:16px; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--text); letter-spacing:-0.01em;">
                🎯 ${g.name}
              </h3>
              <div style="font-size:11.5px; color:var(--text-faint); margin-top:2px; font-weight:600;">
                📅 Prazo: ${formatDateBR(g.deadline)}
              </div>
            </div>
            <div class="row-actions" style="display:flex; gap:6px;">
              <button data-editmeta="${g.id}" title="Editar Meta" class="btn-action-edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg></button>
              <button data-delmeta="${g.id}" title="Excluir Meta" class="btn-action-del"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg></button>
            </div>
          </div>

          <div style="margin:14px 0 10px;">
            <div style="display:flex; justify-content:space-between; align-items:baseline;">
              <span style="font-size:22px; font-weight:800; color:var(--green); font-variant-numeric:tabular-nums;">${fmt(g.current)}</span>
              <span style="font-size:13px; color:var(--text-faint); font-weight:600;">Alvo: ${fmt(g.target)}</span>
            </div>
            <div class="bar-split" style="height:7px; background:rgba(255,255,255,0.08); border-radius:5px; overflow:hidden; margin-top:8px;">
              <div class="g" style="width:${pct}%; background:${isCompleted ? 'linear-gradient(90deg, #10B981, #34D399)' : 'linear-gradient(90deg, #3B82F6, #60A5FA)'}; border-radius:5px; transition:width .4s ease;"></div>
            </div>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; font-size:11.5px; margin-bottom:12px;">
            <span class="pill" style="font-size:11px; padding:2px 8px; border-radius:6px; background:${isCompleted ? 'rgba(16,185,129,0.16)' : 'rgba(59,130,246,0.16)'}; color:${isCompleted ? 'var(--green)' : 'var(--blue)'}; font-weight:700;">
              ${isCompleted ? '🎉 Concluída (100%)' : pct + '% concluído'}
            </span>
            <span style="color:var(--text-faint); font-weight:600;">
              ${isCompleted ? 'Meta atingida!' : 'Faltam ' + fmt(remaining)}
            </span>
          </div>
        </div>

        <button class="btn-ghost" style="width:100%; padding:10px; font-weight:700; border-radius:10px; font-size:13px; display:flex; align-items:center; justify-content:center; gap:6px;" data-addcontrib="${g.id}">
          💰 Adicionar valor à meta
        </button>
      </div>`;
    }).join('') : `<div class="placeholder"><div class="big">🎯</div><h3>Nenhuma meta cadastrada</h3><p>Defina objetivos de economia (ex: Reserva de Emergência, Viagem, Carro Novo) e acompanhe seu avanço.</p></div>`}
  </div>`;
}

function pageRelatorios(){
  const list = transactions.filter(inPeriod);
  const allCats = despesasPorCategoria(list);
  const totalReceitas = list.filter(t=>t.type==='in').reduce((s,t)=>s+(parseFloat(t.val)||0),0);
  const totalDespesas = list.filter(t=>t.type==='out').reduce((s,t)=>s+(parseFloat(t.val)||0),0);
  const resultado = totalReceitas - totalDespesas;
  const savingsPct = totalReceitas > 0 ? Math.max(0, Math.round((resultado / totalReceitas) * 100)) : 0;

  const totalReceitasGeral = transactions.filter(t=>t.type==='in').reduce((s,t)=>s+(parseFloat(t.val)||0),0);
  const totalDespesasGeral = transactions.filter(t=>t.type==='out').reduce((s,t)=>s+(parseFloat(t.val)||0),0);
  const resultadoGeral = totalReceitasGeral - totalDespesasGeral;

  const isAllDates = currentPeriod.month === 0;

  return `
  <div class="page-head">
    <div>
      <h1 style="font-size:22px; font-weight:800; letter-spacing:-0.02em; margin:0; display:flex; align-items:center; gap:8px;">
        Relatórios e Análises Financeiras
      </h1>
      <p style="font-size:12.5px; color:var(--text-dim); margin:4px 0 0 0; font-weight:500;">
        Análise consolidada de receitas, despesas e distribuição percentual — <strong style="color:var(--green);">${periodLabel()}</strong>
      </p>
    </div>
    <div class="head-actions" style="display:flex; align-items:center; gap:10px;">
      ${periodPickerHTML()}
    </div>
  </div>

  <div class="kpis" style="grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:16px; margin-bottom:20px;">
    <div class="kpi kpi-income">
      <div class="row1"><span>Total de Receitas</span><span class="ic" style="background:rgba(16,185,129,0.14); color:var(--green);">↑</span></div>
      <div class="val" style="color:var(--green);">${fmt(totalReceitas)}</div>
      <div class="sub">${isAllDates ? 'Consolidado histórico geral' : periodLabel()}</div>
    </div>
    <div class="kpi kpi-expense">
      <div class="row1"><span>Total de Despesas</span><span class="ic" style="background:rgba(239,68,68,0.14); color:var(--red);">↓</span></div>
      <div class="val" style="color:var(--red);">${fmt(totalDespesas)}</div>
      <div class="sub">${isAllDates ? 'Consolidado histórico geral' : periodLabel()}</div>
    </div>
    <div class="kpi kpi-net">
      <div class="row1"><span>Balanço do Período</span><span class="ic" style="background:${resultado < 0 ? 'rgba(239,68,68,0.14)' : 'rgba(59,130,246,0.14)'}; color:${resultado < 0 ? 'var(--red)' : 'var(--blue)'};">⇄</span></div>
      <div class="val" style="color:${resultado < 0 ? 'var(--red)' : 'var(--green)'};">${fmt(resultado)}</div>
      <div class="sub">${isAllDates ? 'Resultado acumulado geral' : 'Receitas menos Despesas do mês'}</div>
    </div>
    <div class="kpi kpi-balance">
      <div class="row1"><span>Taxa de Poupança</span><span class="ic" style="background:rgba(168,85,247,0.14); color:var(--purple);">📈</span></div>
      <div class="val" style="color:var(--purple);">${savingsPct}%</div>
      <div class="sub">da receita economizada</div>
    </div>
  </div>

  ${!isAllDates ? `
  <div class="panel" style="margin-bottom:20px; padding:16px 20px; background:rgba(255,255,255,0.025); border:1px solid var(--card-border); border-radius:14px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:14px;">
    <div style="font-size:13px; color:var(--text-dim); line-height:1.5;">
      💡 <strong>Comparativo Geral Histórico (Todas as Datas):</strong> Receitas: <strong style="color:var(--green);">${fmt(totalReceitasGeral)}</strong> | Despesas: <strong style="color:var(--red);">${fmt(totalDespesasGeral)}</strong> | Saldo Acumulado: <strong style="color:${resultadoGeral<0?'var(--red)':'var(--green)'};">${fmt(resultadoGeral)}</strong>
    </div>
    <button class="btn-ghost" onclick="currentPeriod={year:new Date().getFullYear(), month:0}; try{localStorage.setItem('fin_current_period', JSON.stringify(currentPeriod));}catch(e){} render();" style="font-size:12px; font-weight:700; padding:6px 14px; border-radius:8px; cursor:pointer;">
      🌐 Ver Histórico Completo
    </button>
  </div>
  ` : ''}

  <div class="table-panel">
    <div class="panel-head">
      <h3>Despesas por Categoria — ${periodLabel()}</h3>
      <span class="tag" style="font-weight:700;">${list.filter(t=>t.type==='out').length} despesa(s) no período</span>
    </div>
    ${allCats.length ? `
    <table>
      <thead>
        <tr>
          <th>Categoria</th>
          <th>Total Gasto</th>
          <th>Distribuição Percentual</th>
        </tr>
      </thead>
      <tbody>
        ${allCats.map(c=>`
          <tr class="trow">
            <td>
              <span class="pill cat-pill" style="background:${c.color}18; color:${c.color}; border:1px solid ${c.color}35">
                ${catIcon(c.name)} ${c.name}
              </span>
            </td>
            <td class="val-out">${fmt(c.val)}</td>
            <td>
              <div style="display:flex; align-items:center; gap:12px;">
                <div class="bar-split" style="flex:1; max-width:180px; height:8px; background:rgba(255,255,255,0.08); border-radius:4px; overflow:hidden;">
                  <div class="g" style="width:${Math.round(c.val/(totalDespesas||1)*100)}%; height:100%; background:${c.color}; border-radius:4px;"></div>
                </div>
                <span style="font-weight:800; font-size:12.5px; color:var(--text); min-width:40px;">${Math.round(c.val/(totalDespesas||1)*100)}%</span>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
      <tfoot>
        <tr class="tfoot-row">
          <td class="tfoot-label">TOTAL DAS DESPESAS DO PERÍODO:</td>
          <td class="tfoot-value">-${fmt(totalDespesas)}</td>
          <td style="padding:14px 12px; font-weight:800; color:var(--text);">100%</td>
        </tr>
      </tfoot>
    </table>
    ` : `
    <div class="placeholder"><div class="big">📊</div><h3>Nenhuma despesa no período</h3><p>Não foram encontradas despesas cadastradas para ${periodLabel()}.</p></div>
    `}
  </div>`;
}

function pageRecorrentes(){
  if (typeof autoCompleteAllRecurringMonths === 'function') {
    if (autoCompleteAllRecurringMonths()) {
      saveUserData();
    }
  }
  const totalDespRec = recurringList.filter(r=>r.type==='out').reduce((s,r)=>s+parseInputValue(r.val),0);
  const totalRecRec = recurringList.filter(r=>r.type==='in').reduce((s,r)=>s+parseInputValue(r.val),0);
  const totalLctos = recurringList.length;
  const totalComPrazo = recurringList.filter(r => (r.totalMonths && parseInt(r.totalMonths) > 0)).length;
  const totalContinuos = totalLctos - totalComPrazo;
  const totalConcluidos = recurringList.filter(r => {
    const tm = parseInt(r.totalMonths) || 0;
    if (tm <= 0) return false;
    const lTxs = transactions.filter(t => t.recurringId === r.id || (t.desc && (t.desc === r.desc || t.desc.startsWith(r.desc + ' ('))));
    const pCount = lTxs.filter(t => t.status === 'Pago' || t.status === 'Recebido').length;
    return pCount >= tm;
  }).length;

  return `
  <div class="page-head">
    <div>
      <h1 style="font-size:22px; font-weight:800; letter-spacing:-0.02em; margin:0; display:flex; align-items:center; gap:8px;">
        Lançamentos Recorrentes & Assinaturas
      </h1>
      <p style="font-size:12.5px; color:var(--text-dim); margin:4px 0 0 0; font-weight:500;">
        Automatize contas fixas, parcelamentos e rendimentos com controle exato de meses e aplicação em 1 clique
      </p>
    </div>
    <div class="head-actions" style="display:flex; align-items:center; gap:10px;">
      ${periodPickerHTML()}
      <button class="btn-primary" id="btnNovoRecorrente" style="display:flex; align-items:center; gap:6px; font-weight:700;">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Novo Recorrente
      </button>
    </div>
  </div>

  <div class="kpis" style="grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:14px; margin-bottom:18px;">
    <div class="kpi" style="padding:14px 16px;">
      <div class="row1" style="margin-bottom:6px;"><span>Despesas Fixas / Mês</span><span class="ic" style="width:32px; height:32px; font-size:14px; background:rgba(239,68,68,0.14); color:var(--red); display:inline-flex; align-items:center; justify-content:center; border-radius:10px;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg></span></div>
      <div class="val" style="font-size:20px; color:var(--red); margin-bottom:2px;">${fmt(totalDespRec)}</div>
      <div class="sub" style="font-size:11px;">Total de saídas programadas</div>
    </div>
    <div class="kpi" style="padding:14px 16px;">
      <div class="row1" style="margin-bottom:6px;"><span>Receitas Fixas / Mês</span><span class="ic" style="width:32px; height:32px; font-size:14px; background:rgba(16,185,129,0.14); color:var(--green); display:inline-flex; align-items:center; justify-content:center; border-radius:10px;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg></span></div>
      <div class="val" style="font-size:20px; color:var(--green); margin-bottom:2px;">${fmt(totalRecRec)}</div>
      <div class="sub" style="font-size:11px;">Total de entradas programadas</div>
    </div>
    <div class="kpi" style="padding:14px 16px;">
      <div class="row1" style="margin-bottom:6px;"><span>Total Recorrentes</span><span class="ic" style="width:32px; height:32px; font-size:14px; background:rgba(168,85,247,0.14); color:var(--purple); display:inline-flex; align-items:center; justify-content:center; border-radius:10px;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg></span></div>
      <div class="val" style="font-size:20px; margin-bottom:2px;">${totalLctos}</div>
      <div class="sub" style="font-size:11px;">${totalComPrazo} com prazo · ${totalContinuos} contínuos</div>
    </div>
    <div class="kpi" style="padding:14px 16px;">
      <div class="row1" style="margin-bottom:6px;"><span>Status de Conclusão</span><span class="ic" style="width:32px; height:32px; font-size:14px; background:rgba(59,130,246,0.14); color:var(--blue); display:inline-flex; align-items:center; justify-content:center; border-radius:10px;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></span></div>
      <div class="val" style="font-size:20px; color:var(--blue); margin-bottom:2px;">${totalConcluidos} / ${totalComPrazo || totalLctos}</div>
      <div class="sub" style="font-size:11px;">${totalConcluidos} contratos 100% aplicados</div>
    </div>
  </div>

  <div class="table-panel">
    ${recurringList.length ? `
    <table>
      <thead>
        <tr>
          <th>Descrição</th>
          <th>Categoria</th>
          <th>Conta de Cobrança</th>
          <th>Frequência</th>
          <th>Vencimento</th>
          <th>Duração Cadastrada</th>
          <th>Progresso / Meses</th>
          <th>Tipo</th>
          <th>Valor</th>
          <th style="text-align:center;">Ações Rápidas</th>
        </tr>
      </thead>
      <tbody>
        ${recurringList.map(r=>{
          const totalM = r.totalMonths ? parseInt(r.totalMonths) : 0;
          const isFixed = totalM > 0;
          const linkedTxs = transactions.filter(t => t.recurringId === r.id || (t.desc && (t.desc === r.desc || t.desc.startsWith(r.desc + ' ('))));
          const paidCount = linkedTxs.filter(t => t.status === 'Pago' || t.status === 'Recebido').length;
          const pendingCount = linkedTxs.filter(t => t.status === 'Pendente').length;
          const remainingToPay = isFixed ? Math.max(0, totalM - paidCount) : pendingCount;
          const paidPct = isFixed ? Math.min(100, Math.round((paidCount / totalM) * 100)) : (paidCount > 0 ? 100 : 0);
          const isFullyPaid = isFixed && paidCount >= totalM;
          const isIncome = r.type === 'in';
          const method = !isIncome ? (r.paymentMethod || detectPaymentMethodFromName(r.desc) || ((r.cat && r.cat.toLowerCase().includes('cartão')) || (r.acc && r.acc.toLowerCase().includes('cartão')) ? 'Cartão de Crédito' : 'Boleto')) : null;
          const paidWord = isIncome ? 'recebida' : 'paga';
          const paidWordPlural = isIncome ? 'recebidas' : 'pagas';

          return `
          <tr class="trow">
            <td class="tx-desc">
              <div style="display:flex; flex-direction:column; gap:4px;">
                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                  <span style="font-weight:700;">${r.desc}</span>
                  ${method ? `
                    <span class="pill" style="padding:2px 8px; font-size:10px; font-weight:700; border-radius:6px; background:${method === 'Cartão de Crédito' ? 'rgba(168,85,247,0.18)' : 'rgba(245,158,11,0.18)'}; color:${method === 'Cartão de Crédito' ? '#C084FC' : '#FBBF24'}; border:1px solid ${method === 'Cartão de Crédito' ? 'rgba(168,85,247,0.4)' : 'rgba(245,158,11,0.4)'};">
                      ${method === 'Cartão de Crédito' ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:3px;"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>Cartão de Crédito' : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:3px;"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>Boleto'}
                    </span>
                  ` : ''}
                  ${isFixed ? `<span class="pill" style="padding:2px 8px; font-size:10px; font-weight:700; border-radius:6px; background:${isFullyPaid ? 'rgba(16,185,129,0.14)' : 'rgba(245,158,11,0.14)'}; color:${isFullyPaid ? 'var(--green)' : '#F59E0B'}; border:1px solid ${isFullyPaid ? 'rgba(16,185,129,0.25)' : 'rgba(245,158,11,0.25)'};">${paidCount}/${totalM} ${isFullyPaid ? '✓ Concluído' : paidWordPlural}</span>` : ''}
                </div>
                ${isFixed ? `
                  <details style="font-size:10.5px; margin-top:2px;">
                    <summary style="cursor:pointer; color:var(--blue); font-weight:600; user-select:none; display:inline-flex; align-items:center; gap:4px;">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg> Cronograma mês a mês (1 a ${totalM})
                    </summary>
                    <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(140px, 1fr)); gap:4px; margin-top:6px; padding:6px; background:rgba(0,0,0,0.25); border-radius:8px; border:1px solid var(--card-border); max-height:160px; overflow-y:auto;">
                      ${(function(){
                        const items = [];
                        const sM = r.startMonth || 1;
                        const sY = r.startYear || new Date().getFullYear();
                        for(let k=1; k<=totalM; k++){
                          const mZero = (sM - 1) + (k - 1);
                          const y = sY + Math.floor(mZero / 12);
                          const m = (mZero % 12) + 1;
                          const targetTx = linkedTxs.find(t => t.installment === (k + '/' + totalM) || (t.desc && t.desc.includes('(' + k + '/' + totalM + ')')));
                          const isPaid = targetTx && (targetTx.status === 'Pago' || targetTx.status === 'Recebido');
                          const mName = MONTHS[m-1] ? MONTHS[m-1].substring(0,3) : m;
                          items.push(
                            `<div style="padding:3px 6px; border-radius:5px; background:${isPaid ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.10)'}; border:1px solid ${isPaid ? 'rgba(16,185,129,0.25)' : 'rgba(245,158,11,0.25)'}; display:flex; justify-content:space-between; align-items:center;">` +
                              `<span>Mês ${k}: <strong style="color:var(--text);">${mName}/${y}</strong></span>` +
                              `<span style="font-weight:700; font-size:9.5px; color:${isPaid ? 'var(--green)' : '#F59E0B'}">${isPaid ? (isIncome ? '✓ Recebido' : '✓ Pago') : '⏳ Pendente'}</span>` +
                            `</div>`
                          );
                        }
                        return items.join('');
                      })()}
                    </div>
                  </details>
                ` : ''}
              </div>
            </td>
            <td><span class="pill cat-pill" style="background:${catColor(r.cat)}18; color:${catColor(r.cat)}; border:1px solid ${catColor(r.cat)}35;">${catIcon(r.cat)} ${r.cat}</span></td>
            <td><span class="pill acc-pill">${getAccountIcon(r.acc)} ${r.acc}</span></td>
            <td><span class="pill" style="background:rgba(255,255,255,0.06); color:var(--text); font-weight:600;">${r.freq || 'Mensal'}</span></td>
            <td><span class="pill" style="background:rgba(245,158,11,0.14); color:var(--orange); font-weight:700;">Dia ${r.day}</span></td>
            <td>
              ${isFixed ? `
                <div style="display:flex; flex-direction:column; gap:2px;">
                  <span class="pill" style="background:rgba(59,130,246,0.12); color:var(--blue); font-weight:700; font-size:11px;">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:3px;"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>${totalM} ${totalM === 1 ? 'mês' : 'meses'}
                  </span>
                  ${r.startMonth && r.startYear ? `<span style="font-size:10px; color:var(--text-dim);">Início: ${MONTHS[r.startMonth-1] ? MONTHS[r.startMonth-1].substring(0,3) : r.startMonth}/${r.startYear}</span>` : ''}
                </div>
              ` : `
                <span class="pill" style="background:rgba(255,255,255,0.06); color:var(--text-dim); font-weight:600; font-size:11px;">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle; margin-right:3px;"><path d="M18.178 8c5.096 0 5.096 8 0 8-5.095 0-7.133-8-12.739-8-4.585 0-4.585 8 0 8 5.606 0 7.644-8 12.74-8z"/></svg>Contínuo
                </span>
              `}
            </td>
            <td>
              ${isFixed ? `
                <div style="min-width:160px; display:flex; flex-direction:column; gap:5px;">
                  <!-- 1. PRIMEIRO: O que ja foi pago -->
                  <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; font-weight:800;">
                    <span style="display:inline-flex; align-items:center; gap:4px; color:${isFullyPaid ? 'var(--green)' : (paidCount > 0 ? 'var(--green)' : 'var(--text-dim)')};">
                      ${isFullyPaid ? '✓ 100% Concluído' : (paidCount > 0 ? (`✓ ${paidCount}/${totalM} ${paidCount === 1 ? paidWord : paidWordPlural}`) : (`0/${totalM} ${paidWordPlural}`))}
                    </span>
                    <span style="color:${isFullyPaid ? 'var(--green)' : (paidCount > 0 ? 'var(--green)' : 'var(--text-dim)')}; font-weight:800;">
                      ${paidPct}% ${isIncome ? 'recebido' : 'pago'}
                    </span>
                  </div>
                  <!-- Barra verde de progresso pago -->
                  <div class="rec-progress-bar" style="height:6px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden;">
                    <div class="rec-progress-fill" style="width:${paidPct}%; height:100%; border-radius:3px; background:${isFullyPaid ? 'var(--green)' : (paidPct > 0 ? 'var(--green)' : 'transparent')}; transition:width .4s ease;"></div>
                  </div>
                  <!-- 2. DEPOIS: O que ainda falta pagar -->
                  <div style="font-size:10.5px; display:flex; justify-content:space-between; align-items:center;">
                    <span style="color:${remainingToPay > 0 ? '#F59E0B' : 'var(--green)'}; font-weight:700; display:inline-flex; align-items:center; gap:3px;">
                      ${remainingToPay > 0 ? (`<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>Falta ${isIncome ? 'receber' : 'pagar'}: ${remainingToPay} ${remainingToPay === 1 ? 'parcela' : 'parcelas'}`) : '✓ Todas quitadas'}
                    </span>
                    ${remainingToPay > 0 ? `<span style="color:#F59E0B; font-size:10px; font-weight:700;">${100 - paidPct}%</span>` : ''}
                  </div>
                </div>
              ` : `
                <div style="display:flex; flex-direction:column; gap:2px;">
                  <span class="pill" style="background:rgba(16,185,129,0.12); color:var(--green); font-size:11px; font-weight:700;">
                    ✓ ${paidCount} ${paidCount === 1 ? paidWord : paidWordPlural}
                  </span>
                  ${pendingCount > 0 ? `<span style="font-size:10px; color:#F59E0B; font-weight:600;">${pendingCount} pendente${pendingCount === 1 ? '' : 's'}</span>` : ''}
                </div>
              `}
            </td>
            <td><span class="type-pill ${r.type}">${r.type==='in'?'↑ Receita':'↓ Despesa'}</span></td>
            <td class="${r.type==='in'?'val-in':'val-out'}">${r.type==='in'?'+':'-'}${fmt(r.val)}</td>
            <td>
              <div class="row-actions" style="justify-content:center; gap:6px;">
                <button data-editrec="${r.id}" title="Editar Recorrente" class="btn-action-edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg></button>
                <button data-delrec="${r.id}" title="Excluir Recorrente" class="btn-action-del"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg></button>
              </div>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>` : `
    <div class="placeholder"><div class="big">🔄</div><h3>Nenhum lançamento recorrente</h3><p>Cadastre despesas e receitas fixas com prazo determinado ou contínuo (ex: Aluguel 12 meses, Seguro 10 meses, Internet, Salário) para lançar rapidamente a cada mês.</p></div>
    `}
  </div>`;
}

function pageImportar(){
  return `
  <div class="page-head">
    <div>
      <h1 style="font-size:22px; font-weight:800; letter-spacing:-0.02em; margin:0; display:flex; align-items:center; gap:8px;">
        Importar Extratos (OFX / CSV)
      </h1>
      <p style="font-size:12.5px; color:var(--text-dim); margin:4px 0 0 0; font-weight:500;">
        Importe extratos do seu banco de forma rápida e segura para conciliação automática
      </p>
    </div>
  </div>

  <div class="panel" style="margin-bottom:22px; padding:22px;">
    <div style="display:flex; align-items:center; gap:10px; margin-bottom:18px; padding:12px 16px; background:rgba(59,130,246,0.08); border:1px solid rgba(59,130,246,0.2); border-radius:12px;">
      <span style="font-size:20px;">💡</span>
      <div style="font-size:12.5px; color:var(--text); line-height:1.4;">
        Formato CSV esperado: <code style="background:rgba(255,255,255,0.08); padding:3px 8px; border-radius:6px; font-size:12px; font-weight:700; color:var(--green);">data,descricao,valor</code>. Arquivos padrão bancário <strong>.OFX</strong> e <strong>.TXT</strong> também são aceitos automaticamente.
      </div>
    </div>

    <div class="field-row" style="margin-bottom:18px; display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:16px;">
      <div class="field" style="margin:0;">
        <label style="font-size:13px; font-weight:700; margin-bottom:8px; display:block; color:var(--text);">Conta / Cartão de Destino</label>
        <select id="impConta" style="width:100%; font-size:13.5px; padding:10px 14px; height:46px; border-radius:10px; background:var(--bg); border:1px solid var(--card-border); color:var(--text); font-weight:600;">
          ${accounts.map(a=>`<option>${a.name} — ${a.type}</option>`).join('')}
        </select>
      </div>
      <div class="field" style="margin:0;">
        <label style="font-size:13px; font-weight:700; margin-bottom:8px; display:block; color:var(--text);">Categoria Padrão</label>
        <select id="impCategoria" style="width:100%; font-size:13.5px; padding:10px 14px; height:46px; border-radius:10px; background:var(--bg); border:1px solid var(--card-border); color:var(--text); font-weight:600;">
          ${categories.map(c=>`<option>${c.name}</option>`).join('')}
        </select>
      </div>
    </div>

    <div id="importDropZone" onclick="document.getElementById('importFile').click()" style="border: 2px dashed rgba(34, 197, 94, 0.4); border-radius: 18px; padding: 36px 20px; text-align: center; cursor: pointer; background: rgba(34, 197, 94, 0.03); transition: all 0.25s ease; position: relative;">
      <input type="file" id="importFile" accept=".csv,.ofx,.txt" style="display:none;">
      <span style="font-size: 42px; display: block; margin-bottom: 12px; filter: drop-shadow(0 4px 12px rgba(34,197,94,0.3));">☁️</span>
      <p style="margin:0; font-weight:800; font-size:16px; color:var(--text);">Arraste seus arquivos bancários para cá ou <span style="color:var(--green); text-decoration:underline;">clique para navegar</span></p>
      <div style="display:flex; justify-content:center; gap:8px; margin-top:10px;">
        <span class="pill" style="background:rgba(255,255,255,0.06); font-size:11px; font-weight:700;">.OFX</span>
        <span class="pill" style="background:rgba(255,255,255,0.06); font-size:11px; font-weight:700;">.CSV</span>
        <span class="pill" style="background:rgba(255,255,255,0.06); font-size:11px; font-weight:700;">.TXT</span>
      </div>
    </div>

    <div id="importPreview" style="margin-top:20px;"></div>
  </div>`;
}

function getAttachmentCoverHtml(a, t){
  const isImage = (a.type && a.type.startsWith('image/')) || (a.dataUrl && a.dataUrl.startsWith('data:image/'));
  if (isImage && a.dataUrl) {
    return `<img src="${a.dataUrl}" style="width:100%; height:150px; object-fit:cover; border-radius:12px; border:1px solid var(--card-border); transition:transform 0.2s ease;">`;
  }

  const nameSearch = ((a.name || '') + ' ' + (t ? t.desc : '')).toLowerCase();
  
  let bName = 'Fatura / Comprovante';
  let bSub = 'Documento Digital';
  let bBg = 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)';
  let accentColor = '#38bdf8';
  let logoBadge = `<div style="width:40px; height:40px; border-radius:10px; background:rgba(56,189,248,0.18); border:1px solid rgba(56,189,248,0.35); display:flex; align-items:center; justify-content:center; font-size:20px;">📄</div>`;

  if (nameSearch.includes('tim')) {
    bName = 'TIM Brasil';
    bSub = 'Fatura Telefonia / GSM';
    bBg = 'linear-gradient(135deg, #021b3b 0%, #004691 100%)';
    accentColor = '#60a5fa';
    logoBadge = `<div style="width:44px; height:40px; border-radius:10px; background:#0056b3; border:1px solid rgba(255,255,255,0.3); display:flex; align-items:center; justify-content:center; font-size:15px; font-weight:900; color:#fff; font-family:sans-serif; letter-spacing:1px; box-shadow:0 4px 10px rgba(0,0,0,0.3);">TIM</div>`;
  } else if (nameSearch.includes('claro')) {
    bName = 'Claro Telecom';
    bSub = 'Fatura Fixo / Móvel';
    bBg = 'linear-gradient(135deg, #3f0415 0%, #be123c 100%)';
    accentColor = '#fecdd3';
    logoBadge = `<div style="width:48px; height:40px; border-radius:10px; background:#e11d48; border:1px solid rgba(255,255,255,0.3); display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:900; color:#fff; font-family:sans-serif; box-shadow:0 4px 10px rgba(0,0,0,0.3);">claro_</div>`;
  } else if (nameSearch.includes('vivo')) {
    bName = 'Vivo Telefonia';
    bSub = 'Fatura Móvel / Fibra';
    bBg = 'linear-gradient(135deg, #2e0854 0%, #6d28d9 100%)';
    accentColor = '#ddd6fe';
    logoBadge = `<div style="width:44px; height:40px; border-radius:10px; background:#7c3aed; border:1px solid rgba(255,255,255,0.3); display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:900; color:#fff; font-family:sans-serif; box-shadow:0 4px 10px rgba(0,0,0,0.3);">vivo</div>`;
  } else if (nameSearch.includes('nu') || nameSearch.includes('nubank')) {
    bName = 'Nubank';
    bSub = 'Fatura Cartão de Crédito';
    bBg = 'linear-gradient(135deg, #2a0346 0%, #7609bc 100%)';
    accentColor = '#e9d5ff';
    logoBadge = `<div style="width:40px; height:40px; border-radius:10px; background:#820ad1; border:1px solid rgba(255,255,255,0.3); display:flex; align-items:center; justify-content:center; font-size:17px; font-weight:900; color:#fff; font-family:sans-serif; box-shadow:0 4px 10px rgba(0,0,0,0.3);">Nu</div>`;
  } else if (nameSearch.includes('inter')) {
    bName = 'Banco Inter';
    bSub = 'Fatura / Extrato Conta';
    bBg = 'linear-gradient(135deg, #381005 0%, #ea580c 100%)';
    accentColor = '#ffedd5';
    logoBadge = `<div style="width:44px; height:40px; border-radius:10px; background:#f97316; border:1px solid rgba(255,255,255,0.3); display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:900; color:#fff; font-family:sans-serif; box-shadow:0 4px 10px rgba(0,0,0,0.3);">inter</div>`;
  } else if (nameSearch.includes('itau') || nameSearch.includes('itaú')) {
    bName = 'Itaú Unibanco';
    bSub = 'Fatura Cartão / Comprovante';
    bBg = 'linear-gradient(135deg, #381005 0%, #c2410c 100%)';
    accentColor = '#fed7aa';
    logoBadge = `<div style="width:42px; height:40px; border-radius:10px; background:#ec5c00; border:1px solid rgba(255,255,255,0.3); display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:900; color:#fff; font-family:sans-serif; box-shadow:0 4px 10px rgba(0,0,0,0.3);">Itaú</div>`;
  } else if (nameSearch.includes('bradesco')) {
    bName = 'Bradesco';
    bSub = 'Fatura Cartão / Extrato';
    bBg = 'linear-gradient(135deg, #3f0415 0%, #cc092f 100%)';
    accentColor = '#fecdd3';
    logoBadge = `<div style="width:46px; height:40px; border-radius:10px; background:#dc2626; border:1px solid rgba(255,255,255,0.3); display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:900; color:#fff; font-family:sans-serif; box-shadow:0 4px 10px rgba(0,0,0,0.3);">Brad</div>`;
  } else if (nameSearch.includes('santander')) {
    bName = 'Santander';
    bSub = 'Fatura Cartão / Extrato';
    bBg = 'linear-gradient(135deg, #380707 0%, #dc2626 100%)';
    accentColor = '#fecdd3';
    logoBadge = `<div style="width:42px; height:40px; border-radius:10px; background:#ec0000; border:1px solid rgba(255,255,255,0.3); display:flex; align-items:center; justify-content:center; font-size:15px; font-weight:900; color:#fff; font-family:sans-serif; box-shadow:0 4px 10px rgba(0,0,0,0.3);">S</div>`;
  } else if (nameSearch.includes('bb') || nameSearch.includes('banco do brasil')) {
    bName = 'Banco do Brasil';
    bSub = 'Comprovante / Extrato';
    bBg = 'linear-gradient(135deg, #101c42 0%, #1d4ed8 100%)';
    accentColor = '#fef08a';
    logoBadge = `<div style="width:40px; height:40px; border-radius:10px; background:#1e3a8a; border:1px solid #facc15; display:flex; align-items:center; justify-content:center; font-size:15px; font-weight:900; color:#facc15; font-family:sans-serif; box-shadow:0 4px 10px rgba(0,0,0,0.3);">BB</div>`;
  } else if (nameSearch.includes('caixa') || nameSearch.includes('cef')) {
    bName = 'CAIXA Econômica';
    bSub = 'Comprovante de Pagamento';
    bBg = 'linear-gradient(135deg, #093752 0%, #0284c7 100%)';
    accentColor = '#bae6fd';
    logoBadge = `<div style="width:44px; height:40px; border-radius:10px; background:#005ca9; border:1px solid rgba(255,255,255,0.3); display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:900; color:#fff; font-family:sans-serif; box-shadow:0 4px 10px rgba(0,0,0,0.3);">CAIXA</div>`;
  } else if (nameSearch.includes('enel') || nameSearch.includes('cemig') || nameSearch.includes('copel') || nameSearch.includes('cpfl') || nameSearch.includes('light') || nameSearch.includes('luz') || nameSearch.includes('energia')) {
    bName = 'Energia Elétrica';
    bSub = 'Conta de Luz';
    bBg = 'linear-gradient(135deg, #361502 0%, #ca8a04 100%)';
    accentColor = '#fef08a';
    logoBadge = `<div style="width:40px; height:40px; border-radius:10px; background:rgba(234,179,8,0.25); border:1px solid rgba(234,179,8,0.5); display:flex; align-items:center; justify-content:center; font-size:20px; color:#fef08a;">⚡</div>`;
  } else if (nameSearch.includes('sabesp') || nameSearch.includes('sanepar') || nameSearch.includes('copasa') || nameSearch.includes('agua') || nameSearch.includes('água')) {
    bName = 'Água / Saneamento';
    bSub = 'Conta de Água';
    bBg = 'linear-gradient(135deg, #062337 0%, #0284c7 100%)';
    accentColor = '#bae6fd';
    logoBadge = `<div style="width:40px; height:40px; border-radius:10px; background:rgba(2,132,199,0.25); border:1px solid rgba(2,132,199,0.5); display:flex; align-items:center; justify-content:center; font-size:20px; color:#bae6fd;">💧</div>`;
  } else if (nameSearch.includes('internet') || nameSearch.includes('fibra') || nameSearch.includes('wifi')) {
    bName = 'Internet & Fibra';
    bSub = 'Fatura Conectividade';
    bBg = 'linear-gradient(135deg, #052733 0%, #0891b2 100%)';
    accentColor = '#cffaff';
    logoBadge = `<div style="width:40px; height:40px; border-radius:10px; background:rgba(8,145,178,0.25); border:1px solid rgba(8,145,178,0.5); display:flex; align-items:center; justify-content:center; font-size:20px; color:#cffaff;">🌐</div>`;
  }

  return `
  <div style="width:100%; height:150px; background:${bBg}; border-radius:14px; border:1px solid rgba(255,255,255,0.14); padding:14px 16px; position:relative; overflow:hidden; display:flex; flex-direction:column; justify-content:space-between; box-shadow:0 8px 24px rgba(0,0,0,0.35), inset 0 1px 1px rgba(255,255,255,0.2); transition:all 0.3s ease;">
    <div style="position:absolute; top:0; left:0; right:0; height:3px; background:linear-gradient(90deg, transparent, ${accentColor}, transparent);"></div>
    <div style="position:absolute; right:-15px; bottom:-15px; font-size:80px; opacity:0.06; user-select:none; pointer-events:none; font-weight:900;">📄</div>

    <div style="display:flex; align-items:center; justify-content:space-between; z-index:2;">
      <div style="display:flex; align-items:center; gap:12px; max-width:80%;">
        ${logoBadge}
        <div style="text-align:left;">
          <div style="font-size:15px; font-weight:900; color:#ffffff; line-height:1.2; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            ${bName}
          </div>
          <div style="font-size:11.5px; font-weight:600; color:rgba(255,255,255,0.75); margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            ${bSub}
          </div>
        </div>
      </div>
      <div style="background:rgba(0,0,0,0.4); backdrop-filter:blur(6px); border:1px solid rgba(255,255,255,0.18); padding:3px 8px; border-radius:6px; font-size:10.5px; font-weight:800; color:#ffffff; display:flex; align-items:center; gap:4px;">
        <span style="color:#ef4444; font-size:12px;">📄</span> PDF
      </div>
    </div>

    <div style="background:rgba(0,0,0,0.22); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:8px 12px; z-index:2; backdrop-filter:blur(4px);">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:5px;">
        <span style="font-size:11px; color:rgba(255,255,255,0.8); font-weight:700; display:flex; align-items:center; gap:4px;">
          <span>🧾</span> Recibo / Fatura Digital
        </span>
        <span style="font-size:10px; color:#4ade80; font-weight:800; background:rgba(74,222,128,0.15); padding:2px 6px; border-radius:4px;">VERIFICADO</span>
      </div>
      <div style="height:3px; background:rgba(255,255,255,0.2); border-radius:2px; width:65%; margin-bottom:4px;"></div>
      <div style="height:3px; background:rgba(255,255,255,0.12); border-radius:2px; width:40%;"></div>
    </div>
  </div>`;
}

function pageAnexos(){
  const sortedTx = transactions.slice().sort((a,b)=>b.date.localeCompare(a.date));
  return `
  <div class="page-head">
    <div>
      <h1 style="font-size:22px; font-weight:800; letter-spacing:-0.02em; margin:0; display:flex; align-items:center; gap:8px;">
        Anexos & Comprovantes Digitais
      </h1>
      <p style="font-size:12.5px; color:var(--text-dim); margin:4px 0 0 0; font-weight:500;">
        Cadastre comprovantes, faturas em PDF e recibos vinculados aos seus lançamentos
      </p>
    </div>
  </div>

  <div class="panel" style="margin-bottom:22px; padding:26px;">
    <div style="margin-bottom:18px;">
      <h3 style="font-size:16.5px; font-weight:800; display:flex; align-items:center; gap:8px; margin:0; color:#FFFFFF;">
        <span>📎</span> Vincular & Enviar Novo Comprovante
      </h3>
      <p style="font-size:12.5px; color:var(--text-dim); margin-top:4px;">
        Selecione uma transação existente ou envie um anexo avulso para guarda segura.
      </p>
    </div>

    <div style="margin-bottom:18px;">
      <label style="font-size:13px; font-weight:700; margin-bottom:8px; display:block; color:var(--text);">Vincular a uma Transação (Opcional)</label>
      <select id="attTx" style="width:100%; font-size:13.5px; padding:11px 16px; height:48px; border-radius:14px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.14); color:var(--text); font-weight:600; backdrop-filter:blur(16px); box-shadow:inset 0 1px 1px rgba(255,255,255,0.15);">
        <option value="0">Nenhuma (Anexo Avulso / Recibo Padrão)</option>
        ${sortedTx.map(t=>`<option value="${t.id}">${formatDateBR(t.date)} — ${t.desc} (${fmt(t.val)})</option>`).join('')}
      </select>
    </div>

    <div id="attDropZone" style="border: 2px dashed rgba(96, 165, 250, 0.4); border-radius: 22px; padding: 42px 20px; text-align: center; cursor: pointer; background: linear-gradient(135deg, rgba(255, 255, 255, 0.04) 0%, rgba(59, 130, 246, 0.06) 50%, rgba(16, 185, 129, 0.04) 100%); backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px); box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.22), 0 10px 30px rgba(0,0,0,0.3); transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1); position: relative;">
      <input type="file" id="attFile" multiple accept="image/*,.pdf,.doc,.docx,.txt" style="display:none;">
      <div style="display:inline-flex; align-items:center; justify-content:center; width:64px; height:64px; border-radius:50%; background:linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(59,130,246,0.25) 100%); border:1px solid rgba(255,255,255,0.35); box-shadow:0 8px 24px rgba(59,130,246,0.35); margin-bottom:14px;">
        <span style="font-size: 32px; display: block; filter: drop-shadow(0 2px 8px rgba(255,255,255,0.5));">☁️</span>
      </div>
      <p style="margin:0; font-weight:800; font-size:16px; color:#FFFFFF; letter-spacing:-0.01em;">Arraste comprovantes para cá ou <span style="color:#60A5FA; text-decoration:underline;">clique para anexar</span></p>
      <div style="display:flex; justify-content:center; gap:8px; margin-top:12px;">
        <span class="pill" style="background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:#E2E8F0; padding:4px 12px; border-radius:999px; font-size:11px; font-weight:700; backdrop-filter:blur(10px);">PNG / JPG / WEBP</span>
        <span class="pill" style="background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:#E2E8F0; padding:4px 12px; border-radius:999px; font-size:11px; font-weight:700; backdrop-filter:blur(10px);">PDF</span>
        <span class="pill" style="background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:#E2E8F0; padding:4px 12px; border-radius:999px; font-size:11px; font-weight:700; backdrop-filter:blur(10px);">DOCX / TXT</span>
      </div>
    </div>
  </div>

  <div style="margin-bottom:14px; display:flex; align-items:center; justify-content:space-between;">
    <h3 style="font-size:17px; font-weight:800;">Comprovantes Armazenados (${attachments.length})</h3>
  </div>

  <div class="cat-cards" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(290px, 1fr)); gap:18px;">
    ${attachments.length? attachments.map(a=>{
      const t = transactions.find(x=>x.id===a.txId);
      const isImage = (a.type && a.type.startsWith('image/')) || (a.dataUrl && a.dataUrl.startsWith('data:image/'));
      const isPdf = (a.type && a.type.includes('pdf')) || (a.dataUrl && a.dataUrl.startsWith('data:application/pdf')) || (a.name && a.name.toLowerCase().endsWith('.pdf'));

      return `
      <div class="budget-card" style="min-height:260px;">
        <div>
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
            <span class="pill" style="font-size:11px; padding:3px 9px; border-radius:8px; background:${isPdf ? 'rgba(239,68,68,0.14)' : isImage ? 'rgba(59,130,246,0.14)' : 'rgba(168,85,247,0.14)'}; color:${isPdf ? 'var(--red)' : isImage ? 'var(--blue)' : 'var(--purple)'}; font-weight:700;">
              ${isPdf ? '📄 Fatura PDF' : isImage ? '🖼️ Imagem Anexa' : '📎 Documento'}
            </span>
            <button data-delatt="${a.id}" title="Excluir Anexo" class="btn-action-del">🗑</button>
          </div>

          <div style="cursor:pointer; text-align:center; margin-bottom:12px;" data-previewatt="${a.id}" title="Clique para Visualizar">
            ${getAttachmentCoverHtml(a, t)}
          </div>

          <h4 style="font-size:14.5px; font-weight:800; margin-bottom:8px; word-break:break-word; color:var(--text); line-height:1.3;">${a.name}</h4>
          
          <div style="margin-top:10px;">
            <label style="display:block; font-size:11.5px; color:var(--text-faint); margin-bottom:4px; font-weight:700;">Transação Vinculada:</label>
            <select data-relinkatt="${a.id}" style="width:100%; font-size:12.5px; padding:6px 10px; border-radius:8px; background:var(--bg); border:1px solid var(--card-border); color:var(--text); font-weight:600;">
              <option value="0" ${!a.txId ? 'selected' : ''}>Sem vincular (Anexo Avulso)</option>
              ${sortedTx.map(tx => `<option value="${tx.id}" ${tx.id === a.txId ? 'selected' : ''}>${formatDateBR(tx.date)} — ${tx.desc}</option>`).join('')}
            </select>
          </div>
        </div>

        <div style="display:flex; align-items:center; gap:8px; margin-top:14px; padding-top:12px; border-top:1px solid rgba(255,255,255,0.06);">
          ${a.dataUrl ? `
            <a href="${a.dataUrl}" download="${a.name || 'comprovante'}" class="btn-primary" style="flex:1.2; padding:8px 12px; font-size:12.5px; font-weight:700; text-decoration:none; display:inline-flex; align-items:center; justify-content:center; gap:6px; border-radius:8px;" title="Baixar Arquivo">
              📥 Baixar
            </a>
            <button data-previewatt="${a.id}" class="btn-ghost" style="flex:1; padding:8px 12px; font-size:12.5px; font-weight:700; border-radius:8px; display:inline-flex; align-items:center; justify-content:center; gap:6px;" title="Visualizar">
              👁️ Ver
            </button>
          ` : `
            <span style="font-size:12px; color:var(--text-faint);">Sem arquivo salvo</span>
          `}
        </div>
      </div>
      `;
    }).join('') : `
      <div class="placeholder" style="grid-column:1/-1; padding:40px 20px;">
        <div class="big">📎</div>
        <h3>Nenhum anexo cadastrado</h3>
        <p>Utilize o formulário acima para enviar comprovantes ou recibos das suas transações.</p>
      </div>
    `}
  </div>`;
}

function pageAlertas(){
  const bstat = budgetStatus();
  return `
  <div class="page-head">
    <div>
      <h1 style="font-size:22px; font-weight:800; letter-spacing:-0.02em; margin:0; display:flex; align-items:center; gap:8px;">
        Alertas de Orçamento
      </h1>
      <p style="font-size:12.5px; color:var(--text-dim); margin:4px 0 0 0; font-weight:500;">
        Avisos inteligentes acionados automaticamente quando o gasto se aproxima do limite — <strong style="color:var(--green);">${periodLabel()}</strong>
      </p>
    </div>
    <div class="head-actions">
      <button class="btn-primary" id="btnNovoAlerta" style="display:flex; align-items:center; gap:6px; font-weight:700;">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Novo Alerta
      </button>
    </div>
  </div>
  <div class="cat-cards" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:18px;">
    ${alerts.length ? alerts.map(al => {
      const b = bstat.find(x => x.category === al.category);
      const pct = b ? b.pct : null;
      const triggered = pct !== null && pct >= al.threshold;
      return `
      <div class="budget-card" style="border-color:${triggered ? 'rgba(239,68,68,0.45)' : 'rgba(255,255,255,0.09)'};">
        <div>
          <div class="top" style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px; gap:10px;">
            <div class="id-group" style="display:flex; align-items:center; gap:10px; min-width:0;">
              <span class="dot" style="background:${triggered ? 'var(--red)' : 'var(--green)'}; width:34px; height:34px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:16px;">
                ${triggered ? '⚠️' : '🔔'}
              </span>
              <div style="min-width:0;">
                <h4 style="font-size:15px; font-weight:800; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${al.category}</h4>
                <span class="pill" style="font-size:10.5px; padding:2px 8px; border-radius:6px; background:${triggered ? 'rgba(239,68,68,0.16)' : 'rgba(16,185,129,0.16)'}; color:${triggered ? 'var(--red)' : 'var(--green)'}; font-weight:700; border:1px solid ${triggered ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)'};">
                  ${triggered ? '🚨 Gatilho Acionado' : '✓ Monitoramento OK'}
                </span>
              </div>
            </div>
            <div class="row-actions" style="display:flex; gap:6px;">
              <button data-editalert="${al.id}" title="Editar Alerta" class="btn-action-edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg></button>
              <button data-delalert="${al.id}" title="Excluir Alerta" class="btn-action-del"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg></button>
            </div>
          </div>

          <div style="margin:14px 0 10px;">
            <div style="font-size:12px; color:var(--text-dim); margin-bottom:4px;">
              Gatilho: Dispara ao atingir <strong style="color:var(--text);">${al.threshold}%</strong> do orçamento
            </div>
            ${b ? `
              <div style="display:flex; justify-content:space-between; align-items:baseline; margin-top:8px;">
                <span style="font-size:20px; font-weight:800; color:${triggered ? 'var(--red)' : 'var(--green)'}; font-variant-numeric:tabular-nums;">${fmt(b.spent)}</span>
                <span style="font-size:12.5px; color:var(--text-faint); font-weight:600;">Limite: ${fmt(b.limit)}</span>
              </div>
              <div class="bar-split" style="height:7px; background:rgba(255,255,255,0.08); border-radius:5px; overflow:hidden; margin-top:8px;">
                <div class="g" style="width:${Math.min(pct, 100)}%; background:${triggered ? 'var(--red)' : 'var(--green)'}; border-radius:5px; transition:width .4s ease;"></div>
              </div>
              <div style="text-align:right; font-size:11px; color:${triggered ? 'var(--red)' : 'var(--text-faint)'}; font-weight:700; margin-top:4px;">
                ${pct}% consumido
              </div>
            ` : `
              <div style="font-size:12px; color:var(--text-faint); margin-top:10px; padding:8px 10px; background:rgba(255,255,255,0.03); border-radius:8px;">
                Sem orçamento ativo cadastrado para esta categoria
              </div>
            `}
          </div>
        </div>
      </div>`;
    }).join('') : `<div class="placeholder"><div class="big">🔔</div><h3>Nenhum alerta configurado</h3><p>Crie alertas para ser avisado automaticamente quando os gastos de qualquer categoria atingirem percentuais críticos.</p></div>`}
  </div>`;
}

function pageConfig(){
  const uData = (registeredUsers || []).find(x => x && x.email && currentUser && x.email.toLowerCase() === currentUser.email.toLowerCase()) || currentUser || {};
  const currentName = uData.name || (currentUser ? currentUser.name : '') || '';
  const currentEmail = uData.email || (currentUser ? currentUser.email : '') || '';
  const rawCpf = uData.cpf || (currentUser ? currentUser.cpf : '') || '';
  const cleanCpf = rawCpf.replace(/D/g, '');
  const formattedCpf = cleanCpf.length === 11 ? cleanCpf.replace(/(d{3})(d{3})(d{3})(d{2})/, '$1.$2.$3-$4') : rawCpf;
  const currentBirthDate = uData.birth_date || uData.birthDate || (currentUser ? (currentUser.birth_date || currentUser.birthDate) : '') || '';
  const rawPhone = uData.phone || (currentUser ? currentUser.phone : '') || '';
  const cleanPhone = rawPhone.replace(/D/g, '');
  const formattedPhone = cleanPhone.length === 11 ? cleanPhone.replace(/(d{2})(d{5})(d{4})/, '($1) $2-$3') : (cleanPhone.length === 10 ? cleanPhone.replace(/(d{2})(d{4})(d{4})/, '($1) $2-$3') : rawPhone);
  const currentCreatedAt = uData.created_at || (currentUser ? currentUser.created_at : '') || '';
  const formattedCreated = currentCreatedAt ? new Date(currentCreatedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Ativa';
  const roleName = uData.role || (currentUser ? currentUser.role : 'Usuário');

  return `
  <div class="page-head">
    <div>
      <h1 style="font-size:22px; font-weight:800; letter-spacing:-0.02em; margin:0; display:flex; align-items:center; gap:8px;">
        Minha Conta
      </h1>
      <p style="font-size:12.5px; color:var(--text-dim); margin:4px 0 0 0; font-weight:500;">
        Dados cadastrais, titularidade KYC, segurança, preferências visuais e conformidade com LGPD
      </p>
    </div>
  </div>

  ${isViewingOtherUser ? `
  <div class="panel" style="margin-bottom:18px; padding:16px 20px; background:rgba(59,130,246,0.08); border:1px solid rgba(59,130,246,0.25);">
    <p class="cfg-hint" style="margin:0; font-size:13px; color:var(--text);">
      👁️ Você está em modo de visualização dos dados de <strong style="color:var(--green);">${currentUser ? currentUser.name : ''}</strong>. As configurações da conta só podem ser editadas pelo próprio titular.
    </p>
  </div>` : `
  <div class="cfg-proportional-container" style="display:grid; grid-template-columns:minmax(0, 1.35fr) minmax(0, 1fr); gap:20px; align-items:start;">
    <!-- 1. DADOS CADASTRAIS & TITULARIDADE (Coluna Principal - Ampla e Proporcional ao Volume de Dados) -->
    <div class="panel" style="padding:22px; display:flex; flex-direction:column; gap:16px;">
      <div class="panel-head" style="margin-bottom:0; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
        <h3 style="display:flex; align-items:center; gap:8px; font-size:16px; font-weight:800; margin:0;">
          <span style="font-size:18px;">👤</span> Dados Cadastrais & Titularidade
        </h3>
      </div>

      <!-- Nome Completo (Largura Total) -->
      <div class="field" style="margin-bottom:0;">
        <label style="font-size:12px; font-weight:700; margin-bottom:6px; display:block; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.04em;">Nome Completo do Titular</label>
        <input id="cfgName" value="${currentName}" placeholder="Seu nome completo" autocomplete="name" style="width:100%; height:44px; font-size:13.5px; font-weight:700;">
      </div>

      <!-- Grid de 2 Colunas para Dados do Titular -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:14px;">
        <!-- CPF -->
        <div class="field" style="margin-bottom:0;">
          <label style="font-size:12px; font-weight:700; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.04em;">
            <span>CPF (Receita Federal)</span>
            <span style="font-size:10.5px; color:#34d399; font-weight:800; text-transform:none;">✓ Autenticado</span>
          </label>
          <input id="cfgCpf" value="${formattedCpf}" placeholder="000.000.000-00" maxlength="14" style="width:100%; height:44px; font-size:13.5px; font-family:monospace; font-weight:700;">
        </div>

        <!-- Data de Nascimento -->
        <div class="field" style="margin-bottom:0;">
          <label style="font-size:12px; font-weight:700; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.04em;">
            <span>Data de Nascimento</span>
            <span style="font-size:10.5px; color:var(--text-dim); text-transform:none;">Maioridade Legal</span>
          </label>
          <input id="cfgBirthDate" type="date" value="${currentBirthDate}" style="width:100%; height:44px; font-size:13.5px; font-weight:600;">
        </div>

        <!-- Celular / WhatsApp 2FA -->
        <div class="field" style="margin-bottom:0;">
          <label style="font-size:12px; font-weight:700; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.04em;">
            <span>Celular com DDD (2FA)</span>
            <span style="font-size:10.5px; color:var(--text-dim); text-transform:none;">Segurança</span>
          </label>
          <input id="cfgPhone" value="${formattedPhone}" placeholder="(00) 00000-0000" maxlength="15" style="width:100%; height:44px; font-size:13.5px; font-family:monospace; font-weight:700;">
        </div>

        <!-- E-mail Cadastrado -->
        <div class="field" style="margin-bottom:0;">
          <label style="font-size:12px; font-weight:700; margin-bottom:6px; display:block; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.04em;">E-mail Cadastrado</label>
          <input id="cfgEmail" type="text" value="${currentEmail}" placeholder="seu.email@exemplo.com" autocomplete="email" style="width:100%; height:44px; font-size:13.5px; font-weight:600;">
        </div>
      </div>

      <!-- Registro de Conformidade LGPD & Abertura da Conta -->
      <div style="background:rgba(0,0,0,0.32); border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:12px 16px; font-size:12px; display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:10px;">
        <div style="display:flex; flex-direction:column; gap:2px;">
          <span style="color:var(--text-dim); font-size:11px;">Termos & Proteção LGPD</span>
          <span style="color:#34d399; font-weight:800; display:inline-flex; align-items:center; gap:5px;">
            <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:#10b981;"></span>
            Aceito & Registrado
          </span>
        </div>
        <div style="display:flex; flex-direction:column; gap:2px;">
          <span style="color:var(--text-dim); font-size:11px;">Perfil de Acesso</span>
          <span style="color:#60a5fa; font-weight:800;">${roleName}</span>
        </div>
        <div style="display:flex; flex-direction:column; gap:2px;">
          <span style="color:var(--text-dim); font-size:11px;">Data de Abertura</span>
          <span style="color:var(--text); font-weight:700;">${formattedCreated}</span>
        </div>
      </div>
    </div>

    <!-- COLUNA SECUNDÁRIA: SEGURANÇA & APARÊNCIA (Compactos, Proporcionais e Sem Espaço Vazio) -->
    <div style="display:flex; flex-direction:column; gap:18px;">
      <!-- 2. Alterar Senha -->
      <div class="panel" style="padding:22px;">
        <div class="panel-head" style="margin-bottom:10px;">
          <h3 style="display:flex; align-items:center; gap:8px; font-size:16px; font-weight:800; margin:0;">
            <span>🔒</span> Segurança & Senha
          </h3>
        </div>
        <p class="cfg-hint" style="font-size:12px; margin-bottom:14px; color:var(--text-dim);">
          Preencha apenas se desejar trocar sua senha de acesso
        </p>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:12px;">
          <div class="field" style="margin-bottom:0;">
            <label style="font-size:12px; font-weight:700; margin-bottom:6px; display:block; color:var(--text-dim);">Nova Senha</label>
            <div class="pass-field">
              <input id="cfgPassword" type="password" placeholder="••••••••" minlength="6" autocomplete="new-password" style="width:100%; height:44px; font-size:13.5px;">
              <button type="button" class="pass-toggle" id="cfgPasswordToggle" tabindex="-1" aria-label="Mostrar senha">${EYE_ICON}</button>
            </div>
          </div>
          <div class="field" style="margin-bottom:0;">
            <label style="font-size:12px; font-weight:700; margin-bottom:6px; display:block; color:var(--text-dim);">Confirmar Senha</label>
            <div class="pass-field">
              <input id="cfgPasswordConfirm" type="password" placeholder="••••••••" minlength="6" autocomplete="new-password" style="width:100%; height:44px; font-size:13.5px;">
              <button type="button" class="pass-toggle" id="cfgPasswordConfirmToggle" tabindex="-1" aria-label="Mostrar senha">${EYE_ICON}</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 3. Aparência & Escala da Tela -->
      <div class="panel" style="padding:22px;">
        <div class="panel-head" style="margin-bottom:12px;">
          <h3 style="display:flex; align-items:center; gap:8px; font-size:16px; font-weight:800; margin:0;">
            <span>🎨</span> Aparência & Escala da Tela
          </h3>
        </div>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:12px; margin-bottom:12px;">
          <div class="field" style="margin-bottom:0;">
            <label style="font-size:12px; font-weight:700; margin-bottom:6px; display:block; color:var(--text-dim);">Tema Visual</label>
            <select id="cfgTheme" style="width:100%; height:44px; font-size:13px; font-weight:600;">
              <option value="dark">🌙 Escuro (Alta Performance)</option>
              <option value="light">☀️ Claro (Executivo Clean)</option>
            </select>
          </div>
          <div class="field" style="margin-bottom:0;">
            <label style="font-size:12px; font-weight:700; margin-bottom:6px; display:block; color:var(--text-dim);">Tamanho de Visualização</label>
            <select id="cfgScale" style="width:100%; height:44px; font-size:13px; font-weight:600;">
              <option value="auto">⚡ Auto (Adequar ao Dispositivo)</option>
              <option value="80%">🔍 80% (Compacto)</option>
              <option value="90%">🔍 90% (Reduzido)</option>
              <option value="100%">🔍 100% (Padrão 1:1)</option>
              <option value="110%">🔍 110% (Ampliado)</option>
              <option value="125%">🔍 125% (Grande)</option>
              <option value="150%">🔍 150% (Extra Grande)</option>
            </select>
          </div>
        </div>
        <div id="cfgDeviceInfo"></div>
      </div>
    </div>
  </div>

  <div class="cfg-save-bar" style="margin-top:24px; display:flex; justify-content:flex-end;">
    <button class="btn-primary" id="btnSalvarConfig" style="padding:12px 28px; font-size:14px; font-weight:800; border-radius:12px; display:flex; align-items:center; gap:8px;">
      <span>💾</span> Salvar Todas as Configurações
    </button>
  </div>`}
  `;
}

/* ==================== Aba 4K: Central de Funções & Permissões ==================== */
let currentFuncoesRoleFilter = 'all';

function setFuncoesRoleFilter(roleFilter, btnEl) {
  currentFuncoesRoleFilter = roleFilter;
  document.querySelectorAll('.funcoes-filter-btn').forEach(b => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
  
  const cols = document.querySelectorAll('.perm-matrix-th, .perm-matrix-td');
  cols.forEach(col => {
    const roleAttr = col.getAttribute('data-perm-role');
    if (!roleAttr || currentFuncoesRoleFilter === 'all') {
      col.style.display = '';
      col.style.opacity = '1';
      col.style.background = '';
    } else if (roleAttr === currentFuncoesRoleFilter) {
      col.style.display = '';
      col.style.opacity = '1';
      col.style.background = 'rgba(232,176,75,0.08)';
    } else {
      col.style.display = 'none';
    }
  });
}

async function changeUserRoleFromFuncoes(email, newRole) {
  await syncUsersWithServer();
  const u = registeredUsers.find(x => x.email.toLowerCase() === (email || '').toLowerCase());
  if (!u) {
    if (typeof showToast === 'function') showToast('Usuário não encontrado');
    return;
  }
  const oldRole = u.role;
  u.role = newRole;
  await saveUsersToServer();
  if (typeof logActivity === 'function') {
    logActivity('Alteração de Função', 'Usuário / Permissões', 'Administrador alterou a função do usuário ' + u.email + ' (' + u.name + ') de ' + oldRole + ' para ' + newRole);
  }
  if (typeof showLoginSuccessPopup === 'function') {
    showLoginSuccessPopup('Função do usuário ' + u.name + ' alterada para ' + newRole + '!');
  } else if (typeof showToast === 'function') {
    showToast('Função de ' + u.name + ' alterada para ' + newRole + '!');
  }
  render();
}

function exportPermissionsMatrixCSV() {
  const rows = [
    ['Modulo', 'Administrador', 'Gerente Financeiro', 'Usuario / Operador', 'Auditor'],
    ['Dashboard Executivo', 'Total (Criar/Editar/Excluir)', 'Total', 'Total Próprio', 'Somente Leitura'],
    ['Gestão de Transações & Cartões', 'Total (Qualquer Usuário)', 'Total Próprio', 'Total Próprio', 'Somente Leitura'],
    ['Orçamentos, Metas & Relatórios', 'Total + Exportação 4K', 'Total + Exportação', 'Total Próprio', 'Exportação CSV/PDF'],
    ['Gerenciamento de Usuários & Contas', 'Controle Total + Modo Espelho', 'Sem Acesso', 'Sem Acesso', 'Lista de Contas'],
    ['Central de Funções & Permissões', 'Controle Total (Nível 1)', 'Sem Acesso', 'Sem Acesso', 'Sem Acesso'],
    ['Logs de Auditoria & Segurança', 'Auditoria Geral + Filtro IP/Email', 'Logs Próprios', 'Sem Acesso', 'Leitura de Eventos']
  ];
  let csvContent = 'data:text/csv;charset=utf-8,' + rows.map(function(e){ return e.map(function(x){ return '"' + x + '"'; }).join(','); }).join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', 'matriz_de_permissoes_' + new Date().toISOString().slice(0,10) + '.csv');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  if (typeof showToast === 'function') showToast('Matriz de Permissões exportada em CSV com sucesso!');
}

function pageFuncoes(){
  const isAdmin = currentUser && currentUser.role === 'Administrador';
  if(!isAdmin || isViewingOtherUser){
    return `<div class="placeholder"><div class="big">🔒</div><h3>Acesso restrito</h3><p>Esta área de Gestão de Funções é exclusiva para administradores.</p></div>`;
  }
  const userRole = (currentUser && currentUser.role) || 'Usuário';
  const totalUsers = registeredUsers ? registeredUsers.length : 1;
  const adminCount = registeredUsers ? registeredUsers.filter(u => u.role === 'Administrador').length : 1;
  const managerCount = registeredUsers ? registeredUsers.filter(u => u.role === 'Gerente Financeiro').length : 0;
  const auditorCount = registeredUsers ? registeredUsers.filter(u => u.role === 'Auditor').length : 0;
  const standardCount = totalUsers - adminCount - managerCount - auditorCount;

  return `
  <div class="page-head" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:14px; margin-bottom:20px;">
    <div>
      <h1 style="display:flex; align-items:center; gap:10px; font-size:22px; font-weight:800; color:var(--text);">
        <span style="display:inline-flex; align-items:center; justify-content:center; width:36px; height:36px; border-radius:10px; background:linear-gradient(135deg, rgba(232,176,75,0.25), rgba(201,134,42,0.15)); border:1px solid rgba(232,176,75,0.4); color:#fbbf24; font-size:18px;">🛡️</span>
        Central de Funções & Permissões
      </h1>
      <p style="font-size:13.5px; color:var(--text-dim); margin:4px 0 0 0;">Gerencie papéis de usuários, atribuição rápida de funções, matriz de controle de acessos e permissões do sistema em tempo real.</p>
    </div>
    <div style="display:flex; gap:10px; align-items:center;">
      <span class="tag" style="background:rgba(232,176,75,0.15); color:#fbbf24; border:1px solid rgba(232,176,75,0.3); font-weight:700; padding:6px 14px; border-radius:20px; font-size:12px;">
        👑 Modo Administrador (Acesso Irrestrito)
      </span>
      <button onclick="exportPermissionsMatrixCSV()" class="btn-ghost" style="height:36px; padding:0 14px; border-radius:10px; border-color:rgba(232,176,75,0.3); color:#fbbf24; font-size:12.5px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:6px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        <span>Exportar CSV</span>
      </button>
    </div>
  </div>

  <!-- Cards de Resumo Executivo das Funções 4K -->
  <div class="kpis" style="margin-bottom:20px;">
    <div class="kpi" style="border:1px solid rgba(232,176,75,0.25); background:linear-gradient(135deg, rgba(20,24,33,0.9), rgba(12,16,24,0.95)); shadow:0 10px 30px rgba(0,0,0,0.5);">
      <div class="kpi-head"><span class="lbl">Sua Função Atual</span><span class="ic" style="background:rgba(232,176,75,0.2); color:#fbbf24;">👑</span></div>
      <div class="val" style="color:#fbbf24; font-size:22px;">${userRole}</div>
      <div class="sub" style="color:var(--text-dim); margin-top:4px;">Nível de Privilégio: Acesso Total (Nível 1)</div>
    </div>
    <div class="kpi" style="border:1px solid rgba(16,185,129,0.25); background:linear-gradient(135deg, rgba(20,24,33,0.9), rgba(12,16,24,0.95));">
      <div class="kpi-head"><span class="lbl">Administradores</span><span class="ic" style="background:rgba(16,185,129,0.2); color:#10b981;">👥</span></div>
      <div class="val" style="color:#10b981; font-size:22px;">${adminCount} Admin${adminCount===1?'':'s'}</div>
      <div class="sub" style="color:var(--text-dim); margin-top:4px;">Gestores com Acesso Irrestrito</div>
    </div>
    <div class="kpi" style="border:1px solid rgba(59,130,246,0.25); background:linear-gradient(135deg, rgba(20,24,33,0.9), rgba(12,16,24,0.95));">
      <div class="kpi-head"><span class="lbl">Operadores & Outras Funções</span><span class="ic" style="background:rgba(59,130,246,0.2); color:#3b82f6;">👤</span></div>
      <div class="val" style="color:#3b82f6; font-size:22px;">${totalUsers - adminCount} Usuário${(totalUsers - adminCount)===1?'':'s'}</div>
      <div class="sub" style="color:var(--text-dim); margin-top:4px;">${standardCount} Operadores · ${managerCount} Gerentes · ${auditorCount} Auditores</div>
    </div>
  </div>

  <!-- Atribuição Direta de Funções aos Usuários -->
  <div class="panel" style="margin-bottom:20px; border:1px solid rgba(232,176,75,0.25); background:var(--card);">
    <div class="panel-head" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
      <div>
        <h3 style="font-size:16px; font-weight:700; color:var(--text);">⚡ Atribuição Direta de Funções aos Usuários</h3>
        <p class="cfg-hint" style="margin-top:4px;">Altere o perfil e nível de acesso de qualquer usuário cadastrado instantaneamente.</p>
      </div>
      <span class="tag" style="background:rgba(16,185,129,0.15); color:#34D399; border-color:rgba(16,185,129,0.3); font-weight:700;">${totalUsers} Conta(s) no Sistema</span>
    </div>
    
    <div class="table-panel" style="padding:0; border:none; background:transparent; overflow-x:auto;">
      <table style="width:100%; border-collapse:collapse; text-align:left;">
        <thead>
          <tr style="border-bottom:1px solid var(--card-border); background:rgba(0,0,0,0.3);">
            <th style="padding:14px 16px; color:var(--text-dim); font-size:12px; text-transform:uppercase;">Usuário</th>
            <th style="padding:14px 16px; color:var(--text-dim); font-size:12px; text-transform:uppercase;">E-mail</th>
            <th style="padding:14px 16px; color:var(--text-dim); font-size:12px; text-transform:uppercase;">Função Atual</th>
            <th style="padding:14px 16px; color:#fbbf24; font-size:12px; text-transform:uppercase;">Alterar Função do Usuário</th>
          </tr>
        </thead>
        <tbody>
          ${(registeredUsers || []).map(u => {
            const isMe = currentUser && u.email.toLowerCase() === currentUser.email.toLowerCase();
            return `
            <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
              <td style="padding:14px 16px; font-weight:600; color:var(--text);">
                <div style="display:flex; align-items:center; gap:10px;">
                  <div style="width:32px; height:32px; border-radius:50%; background:linear-gradient(135deg, #3b82f6, #1d4ed8); display:flex; align-items:center; justify-content:center; color:#fff; font-weight:800; font-size:12px;">
                    ${u.name.slice(0,2).toUpperCase()}
                  </div>
                  <div>
                    <span>${u.name}</span>
                    ${isMe ? ' <span style="font-size:10px; color:#fbbf24; background:rgba(232,176,75,0.15); padding:1px 6px; border-radius:6px; font-weight:700;">Você</span>' : ''}
                  </div>
                </div>
              </td>
              <td style="padding:14px 16px; color:var(--text-dim); font-size:13px;">${u.email}</td>
              <td style="padding:14px 16px;">
                <span class="role-badge ${u.role==='Administrador'?'admin':'user'}" style="font-size:12px; padding:4px 10px;">${u.role}</span>
              </td>
              <td style="padding:14px 16px;">
                <select onchange="changeUserRoleFromFuncoes('${u.email}', this.value)" style="height:36px; padding:0 12px; border-radius:10px; background:var(--input-bg, rgba(0,0,0,0.4)); border:1px solid rgba(232,176,75,0.3); color:#fbbf24; font-weight:700; font-size:13px; cursor:pointer;">
                  <option value="Administrador" ${u.role==='Administrador'?'selected':''}>👑 Administrador (Acesso Irrestrito)</option>
                  <option value="Gerente Financeiro" ${u.role==='Gerente Financeiro'?'selected':''}>💼 Gerente Financeiro</option>
                  <option value="Usuário" ${u.role==='Usuário'?'selected':''}>👤 Usuário / Operador Padrão</option>
                  <option value="Auditor" ${u.role==='Auditor'?'selected':''}>🔍 Auditor (Somente Leitura)</option>
                </select>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  </div>

  <!-- Matriz de Permissões por Função do Sistema -->
  <div class="panel" style="margin-bottom:20px; border:1px solid rgba(232,176,75,0.25); background:var(--card);">
    <div class="panel-head" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
      <div>
        <h3 style="font-size:16px; font-weight:700; color:var(--text);">Matriz de Permissões e Capacidades do Sistema</h3>
        <p class="cfg-hint" style="margin-top:4px;">Tabela detalhada de acessos, privilégios de edição e permissões ativas para cada nível de usuário.</p>
      </div>
      <div style="display:flex; gap:6px; flex-wrap:wrap;">
        <button onclick="setFuncoesRoleFilter('all', this)" class="funcoes-filter-btn active" style="padding:4px 10px; border-radius:8px; font-size:11.5px; font-weight:700; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:#fff; cursor:pointer;">Todas</button>
        <button onclick="setFuncoesRoleFilter('admin', this)" class="funcoes-filter-btn" style="padding:4px 10px; border-radius:8px; font-size:11.5px; font-weight:700; background:rgba(232,176,75,0.12); border:1px solid rgba(232,176,75,0.3); color:#fbbf24; cursor:pointer;">👑 Administrador</button>
        <button onclick="setFuncoesRoleFilter('gerente', this)" class="funcoes-filter-btn" style="padding:4px 10px; border-radius:8px; font-size:11.5px; font-weight:700; background:rgba(16,185,129,0.12); border:1px solid rgba(16,185,129,0.3); color:#34d399; cursor:pointer;">💼 Gerente</button>
        <button onclick="setFuncoesRoleFilter('usuario', this)" class="funcoes-filter-btn" style="padding:4px 10px; border-radius:8px; font-size:11.5px; font-weight:700; background:rgba(59,130,246,0.12); border:1px solid rgba(59,130,246,0.3); color:#60a5fa; cursor:pointer;">👤 Usuário</button>
        <button onclick="setFuncoesRoleFilter('auditor', this)" class="funcoes-filter-btn" style="padding:4px 10px; border-radius:8px; font-size:11.5px; font-weight:700; background:rgba(192,132,252,0.12); border:1px solid rgba(192,132,252,0.3); color:#c084fc; cursor:pointer;">🔍 Auditor</button>
      </div>
    </div>
    
    <div class="table-panel" style="padding:0; border:none; background:transparent; overflow-x:auto;">
      <table style="width:100%; border-collapse:collapse; text-align:left;">
        <thead>
          <tr style="border-bottom:1px solid var(--card-border); background:rgba(0,0,0,0.25);">
            <th style="padding:14px 16px; color:var(--text-dim); font-size:12px; text-transform:uppercase; letter-spacing:0.05em;">Módulo do Sistema</th>
            <th class="perm-matrix-th" data-perm-role="admin" style="padding:14px 16px; color:#fbbf24; font-size:12px; text-transform:uppercase; letter-spacing:0.05em;">👑 Administrador</th>
            <th class="perm-matrix-th" data-perm-role="gerente" style="padding:14px 16px; color:#34d399; font-size:12px; text-transform:uppercase; letter-spacing:0.05em;">💼 Gerente Financeiro</th>
            <th class="perm-matrix-th" data-perm-role="usuario" style="padding:14px 16px; color:#60a5fa; font-size:12px; text-transform:uppercase; letter-spacing:0.05em;">👤 Usuário / Operador</th>
            <th class="perm-matrix-th" data-perm-role="auditor" style="padding:14px 16px; color:#c084fc; font-size:12px; text-transform:uppercase; letter-spacing:0.05em;">🔍 Auditor (Leitura)</th>
          </tr>
        </thead>
        <tbody>
          <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
            <td style="padding:14px 16px; font-weight:600; color:var(--text);"><span style="margin-right:8px;">📊</span> Dashboard Executivo</td>
            <td class="perm-matrix-td" data-perm-role="admin" style="padding:14px 16px;"><span class="funcoes-badge full">✅ Total (Criar/Editar/Excluir)</span></td>
            <td class="perm-matrix-td" data-perm-role="gerente" style="padding:14px 16px;"><span class="funcoes-badge full">✅ Total</span></td>
            <td class="perm-matrix-td" data-perm-role="usuario" style="padding:14px 16px;"><span class="funcoes-badge full">✅ Total Próprio</span></td>
            <td class="perm-matrix-td" data-perm-role="auditor" style="padding:14px 16px;"><span class="funcoes-badge read">👁️ Somente Leitura</span></td>
          </tr>
          <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
            <td style="padding:14px 16px; font-weight:600; color:var(--text);"><span style="margin-right:8px;">💳</span> Gestão de Transações & Cartões</td>
            <td class="perm-matrix-td" data-perm-role="admin" style="padding:14px 16px;"><span class="funcoes-badge full">✅ Total (Qualquer Usuário)</span></td>
            <td class="perm-matrix-td" data-perm-role="gerente" style="padding:14px 16px;"><span class="funcoes-badge full">✅ Total Próprio</span></td>
            <td class="perm-matrix-td" data-perm-role="usuario" style="padding:14px 16px;"><span class="funcoes-badge full">✅ Total Próprio</span></td>
            <td class="perm-matrix-td" data-perm-role="auditor" style="padding:14px 16px;"><span class="funcoes-badge read">👁️ Somente Leitura</span></td>
          </tr>
          <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
            <td style="padding:14px 16px; font-weight:600; color:var(--text);"><span style="margin-right:8px;">🎯</span> Orçamentos, Metas & Relatórios</td>
            <td class="perm-matrix-td" data-perm-role="admin" style="padding:14px 16px;"><span class="funcoes-badge full">✅ Total + Exportação 4K</span></td>
            <td class="perm-matrix-td" data-perm-role="gerente" style="padding:14px 16px;"><span class="funcoes-badge full">✅ Total + Exportação</span></td>
            <td class="perm-matrix-td" data-perm-role="usuario" style="padding:14px 16px;"><span class="funcoes-badge full">✅ Total Próprio</span></td>
            <td class="perm-matrix-td" data-perm-role="auditor" style="padding:14px 16px;"><span class="funcoes-badge read">👁️ Exportação CSV/PDF</span></td>
          </tr>
          <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
            <td style="padding:14px 16px; font-weight:600; color:var(--text);"><span style="margin-right:8px;">👥</span> Gerenciamento de Usuários & Contas</td>
            <td class="perm-matrix-td" data-perm-role="admin" style="padding:14px 16px;"><span class="funcoes-badge full">✅ Controle Total + Modo Espelho 👁️</span></td>
            <td class="perm-matrix-td" data-perm-role="gerente" style="padding:14px 16px;"><span class="funcoes-badge lock">🔒 Sem Acesso</span></td>
            <td class="perm-matrix-td" data-perm-role="usuario" style="padding:14px 16px;"><span class="funcoes-badge lock">🔒 Sem Acesso</span></td>
            <td class="perm-matrix-td" data-perm-role="auditor" style="padding:14px 16px;"><span class="funcoes-badge read">👁️ Lista de Contas</span></td>
          </tr>
          <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
            <td style="padding:14px 16px; font-weight:600; color:var(--text);"><span style="margin-right:8px;">🛡️</span> Central de Funções & Permissões</td>
            <td class="perm-matrix-td" data-perm-role="admin" style="padding:14px 16px;"><span class="funcoes-badge full">✅ Controle Total (Nível 1)</span></td>
            <td class="perm-matrix-td" data-perm-role="gerente" style="padding:14px 16px;"><span class="funcoes-badge lock">🔒 Sem Acesso</span></td>
            <td class="perm-matrix-td" data-perm-role="usuario" style="padding:14px 16px;"><span class="funcoes-badge lock">🔒 Sem Acesso</span></td>
            <td class="perm-matrix-td" data-perm-role="auditor" style="padding:14px 16px;"><span class="funcoes-badge lock">🔒 Sem Acesso</span></td>
          </tr>
          <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
            <td style="padding:14px 16px; font-weight:600; color:var(--text);"><span style="margin-right:8px;">📜</span> Logs de Auditoria & Segurança</td>
            <td class="perm-matrix-td" data-perm-role="admin" style="padding:14px 16px;"><span class="funcoes-badge full">✅ Auditoria Geral + Filtro IP/Email</span></td>
            <td class="perm-matrix-td" data-perm-role="gerente" style="padding:14px 16px;"><span class="funcoes-badge read">👁️ Logs Próprios</span></td>
            <td class="perm-matrix-td" data-perm-role="usuario" style="padding:14px 16px;"><span class="funcoes-badge lock">🔒 Sem Acesso</span></td>
            <td class="perm-matrix-td" data-perm-role="auditor" style="padding:14px 16px;"><span class="funcoes-badge read">👁️ Leitura de Eventos</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- Central de Rotinas & Automação Funcional 4K -->
  <div class="cfg-grid" style="margin-bottom:20px;">
    <div class="panel" style="border:1px solid rgba(232,176,75,0.2); background:var(--card);">
      <div class="panel-head"><h3>⚡ Status das Rotinas Funcionais</h3></div>
      <div style="display:flex; flex-direction:column; gap:12px; margin-top:8px;">
        <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; background:rgba(0,0,0,0.25); border-radius:10px; border:1px solid var(--card-border);">
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="width:10px; height:10px; border-radius:50%; background:#10b981; box-shadow:0 0 10px #10b981;"></span>
            <div><strong style="font-size:13.5px; color:var(--text);">Persistência SQL Server / JSON</strong><div style="font-size:11px; color:var(--text-faint);">Sincronização em tempo real</div></div>
          </div>
          <span style="font-size:11px; font-weight:700; color:#10b981; background:rgba(16,185,129,0.15); padding:3px 8px; border-radius:6px;">Online</span>
        </div>
        <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; background:rgba(0,0,0,0.25); border-radius:10px; border:1px solid var(--card-border);">
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="width:10px; height:10px; border-radius:50%; background:#3b82f6; box-shadow:0 0 10px #3b82f6;"></span>
            <div><strong style="font-size:13.5px; color:var(--text);">Engine de Funções & Permissões</strong><div style="font-size:11px; color:var(--text-faint);">Validação de Acesso JWT / Sessão</div></div>
          </div>
          <span style="font-size:11px; font-weight:700; color:#3b82f6; background:rgba(59,130,246,0.15); padding:3px 8px; border-radius:6px;">Ativo</span>
        </div>
        <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; background:rgba(0,0,0,0.25); border-radius:10px; border:1px solid var(--card-border);">
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="width:10px; height:10px; border-radius:50%; background:#f59e0b; box-shadow:0 0 10px #f59e0b;"></span>
            <div><strong style="font-size:13.5px; color:var(--text);">Auditoria beacon & API Logs</strong><div style="font-size:11px; color:var(--text-faint);">Rastreamento de ações do sistema</div></div>
          </div>
          <span style="font-size:11px; font-weight:700; color:#f59e0b; background:rgba(245,158,11,0.15); padding:3px 8px; border-radius:6px;">Gravando</span>
        </div>
      </div>
    </div>

    <div class="panel" style="border:1px solid rgba(232,176,75,0.2); background:var(--card);">
      <div class="panel-head"><h3>🛠️ Ferramentas & Teste de Função</h3></div>
      <p class="cfg-hint" style="margin-bottom:14px;">Utilize as ferramentas abaixo para validar o estado e o recálculo imediato de todas as funções ativas.</p>
      <div style="display:flex; flex-direction:column; gap:10px;">
        <button class="btn-primary" onclick="if(typeof recalculateAllBalances==='function') recalculateAllBalances(); showLoginSuccessPopup('Saldos e funções reprocessados com sucesso!');" style="display:flex; align-items:center; justify-content:center; gap:8px;">
          <span>🔄</span> Recalcular Saldos & Projeções
        </button>
        <button class="btn-ghost" onclick="syncUsersWithServer().then(()=>showLoginSuccessPopup('Funções de usuários atualizadas com o servidor!'));" style="display:flex; align-items:center; justify-content:center; gap:8px; border-color:rgba(232,176,75,0.3); color:#fbbf24;">
          <span>⚡</span> Sincronizar Tabela de Funções & Usuários
        </button>
      </div>
    </div>
  </div>`;
}

/* ==================== Admin: Usuários Cadastrados ==================== */
function getUserActivitySummary(email){
  const data = loadFromStorage('nexus_data_' + email, null);
  if(!data) return { hasData:false, txCount:0, accCount:0, budCount:0, goalCount:0, lastDate:null };
  const txs = data.transactions || [];
  let lastDate = null;
  txs.forEach(t=>{ if(t.date && (!lastDate || t.date > lastDate)) lastDate = t.date; });
  return {
    hasData:true,
    txCount: txs.length,
    accCount: (data.accounts||[]).length,
    budCount: (data.budgets||[]).length,
    goalCount: (data.goals||[]).length,
    lastDate
  };
}

let currentAdminUserFilter = 'all';
let currentAdminUserSearch = '';

function setAdminUserFilter(filterType, btnEl) {
  currentAdminUserFilter = filterType;
  document.querySelectorAll('.admin-filter-btn').forEach(b => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
  applyAdminUserFiltering();
}

function handleAdminUserSearch(query) {
  currentAdminUserSearch = (query || '').toLowerCase().trim();
  applyAdminUserFiltering();
}

function applyAdminUserFiltering() {
  const cards = document.querySelectorAll('.user-card-4k');
  cards.forEach(card => {
    const email = (card.getAttribute('data-user-email') || '').toLowerCase();
    const name = (card.querySelector('.user-card-name') ? card.querySelector('.user-card-name').textContent : '').toLowerCase();
    const cpf = (card.getAttribute('data-user-cpf') || '').toLowerCase();
    const phone = (card.getAttribute('data-user-phone') || '').toLowerCase();
    const role = card.getAttribute('data-user-role') || '';
    const status = card.getAttribute('data-user-status') || '';

    let matchesFilter = true;
    if (currentAdminUserFilter === 'admin') matchesFilter = (role === 'admin');
    else if (currentAdminUserFilter === 'user') matchesFilter = (role === 'user');
    else if (currentAdminUserFilter === 'active') matchesFilter = (status === 'active');
    else if (currentAdminUserFilter === 'inactive') matchesFilter = (status === 'inactive');

    let matchesSearch = true;
    if (currentAdminUserSearch) {
      const q = currentAdminUserSearch.toLowerCase();
      const qDigits = q.replace(/D/g, '');
      matchesSearch = email.includes(q) || name.includes(q) || (qDigits && (cpf.includes(qDigits) || phone.includes(qDigits))) || cpf.includes(q) || phone.includes(q);
    }

    card.style.display = (matchesFilter && matchesSearch) ? 'flex' : 'none';
  });
}

function pageUsuarios(){
  const isAdmin = currentUser && currentUser.role === 'Administrador';
  if(!isAdmin || isViewingOtherUser){
    return `<div class="placeholder"><div class="big">🔒</div><h3>Acesso restrito</h3><p>Esta área é exclusiva para administradores.</p></div>`;
  }

  // Deduplica e garante lista limpa com dados do SQL Server
  const userMap = new Map();
  (registeredUsers || []).forEach(u => {
    if (u && u.email) userMap.set(u.email.toLowerCase(), u);
  });
  const users = Array.from(userMap.values());

  const totalUsers = users.length;
  const adminCount = users.filter(u => u.role === 'Administrador').length;
  const activeCount = users.filter(u => u.active !== false).length;
  const inactiveCount = totalUsers - activeCount;

  return `
  <div class="page-head" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; margin-bottom:22px;">
    <div>
      <h1 style="font-size:23px; font-weight:900; letter-spacing:-0.02em; margin:0; display:flex; align-items:center; gap:10px; color:var(--text);">
        <span style="display:inline-flex; align-items:center; justify-content:center; width:36px; height:36px; border-radius:12px; background:linear-gradient(135deg, rgba(59,130,246,0.25), rgba(37,99,235,0.12)); border:1px solid rgba(96,165,250,0.35);">👥</span>
        Central de Usuários & Correção Cadastral
      </h1>
      <p style="font-size:13.5px; color:var(--text-dim); margin:5px 0 0 0; font-weight:500;">
        Autocadastro ativo. O próprio usuário cria a conta; utilize este painel para auditar ou corrigir eventuais dados necessários.
      </p>
    </div>
    <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
      <button id="btnNovoUsuarioAdmin" onclick="openAdminCreateUserModal()" style="display:inline-flex; align-items:center; gap:9px; height:42px; padding:0 20px; border-radius:14px; background:linear-gradient(135deg, #3B82F6 0%, #2563EB 50%, #1D4ED8 100%); color:#ffffff; font-size:13px; font-weight:800; border:1px solid rgba(255,255,255,0.25); cursor:pointer; box-shadow:0 8px 24px -4px rgba(59,130,246,0.5); transition:all 0.25s cubic-bezier(0.16, 1, 0.3, 1);">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        <span>Cadastrar Manualmente</span>
      </button>
      <button class="btn-ghost" onclick="syncUsersWithServer().then(render)" style="display:inline-flex; align-items:center; gap:6px; font-weight:700; height:42px; border-radius:14px;">
        🔄 Atualizar Lista
      </button>
    </div>
  </div>

  <div class="kpis" style="grid-template-columns:repeat(auto-fit, minmax(210px, 1fr)); gap:16px; margin-bottom:22px;">
    <div class="kpi" style="position:relative; overflow:hidden; padding:20px 22px; border-radius:20px; background:linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(15,23,42,0.68) 50%, rgba(10,15,29,0.80) 100%); backdrop-filter:blur(24px); -webkit-backdrop-filter:blur(24px); border:1px solid rgba(255,255,255,0.13); box-shadow:0 16px 40px -10px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.22);">
      <div class="row1" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="font-size:13px; font-weight:700; color:var(--text-dim); letter-spacing:0.02em;">Total de Usuários</span>
        <div style="width:38px; height:38px; border-radius:50%; background:linear-gradient(135deg, rgba(59,130,246,0.25), rgba(37,99,235,0.15)); border:1.5px solid rgba(96,165,250,0.4); display:flex; align-items:center; justify-content:center; box-shadow:0 0 16px rgba(59,130,246,0.3); font-size:16px;">👥</div>
      </div>
      <div class="val" style="font-size:28px; font-weight:900; color:var(--text); margin-bottom:2px; letter-spacing:-0.02em;">${totalUsers}</div>
      <div class="sub" style="font-size:12px; color:#60A5FA; font-weight:600; margin-top:4px;">Contas sincronizadas</div>
    </div>

    <div class="kpi" style="position:relative; overflow:hidden; padding:20px 22px; border-radius:20px; background:linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(15,23,42,0.68) 50%, rgba(10,15,29,0.80) 100%); backdrop-filter:blur(24px); -webkit-backdrop-filter:blur(24px); border:1px solid rgba(255,255,255,0.13); box-shadow:0 16px 40px -10px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.22);">
      <div class="row1" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="font-size:13px; font-weight:700; color:var(--text-dim); letter-spacing:0.02em;">Administradores</span>
        <div style="width:38px; height:38px; border-radius:50%; background:linear-gradient(135deg, rgba(245,158,11,0.25), rgba(217,119,6,0.15)); border:1.5px solid rgba(251,191,36,0.4); display:flex; align-items:center; justify-content:center; box-shadow:0 0 16px rgba(245,158,11,0.3); font-size:16px;">👑</div>
      </div>
      <div class="val" style="font-size:28px; font-weight:900; color:#FBBF24; margin-bottom:2px; letter-spacing:-0.02em;">${adminCount}</div>
      <div class="sub" style="font-size:12px; color:#FDE68A; font-weight:600; margin-top:4px;">Gestão do sistema</div>
    </div>

    <div class="kpi" style="position:relative; overflow:hidden; padding:20px 22px; border-radius:20px; background:linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(15,23,42,0.68) 50%, rgba(10,15,29,0.80) 100%); backdrop-filter:blur(24px); -webkit-backdrop-filter:blur(24px); border:1px solid rgba(255,255,255,0.13); box-shadow:0 16px 40px -10px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.22);">
      <div class="row1" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="font-size:13px; font-weight:700; color:var(--text-dim); letter-spacing:0.02em;">Usuários Ativos</span>
        <div style="width:38px; height:38px; border-radius:50%; background:linear-gradient(135deg, rgba(16,185,129,0.25), rgba(5,150,105,0.15)); border:1.5px solid rgba(52,211,153,0.4); display:flex; align-items:center; justify-content:center; box-shadow:0 0 16px rgba(16,185,129,0.3); font-size:16px;">✅</div>
      </div>
      <div class="val" style="font-size:28px; font-weight:900; color:#34D399; margin-bottom:2px; letter-spacing:-0.02em;">${activeCount}</div>
      <div class="sub" style="font-size:12px; color:#A7F3D0; font-weight:600; margin-top:4px;">Acesso liberado</div>
    </div>

    <div class="kpi" style="position:relative; overflow:hidden; padding:20px 22px; border-radius:20px; background:linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(15,23,42,0.68) 50%, rgba(10,15,29,0.80) 100%); backdrop-filter:blur(24px); -webkit-backdrop-filter:blur(24px); border:1px solid rgba(255,255,255,0.13); box-shadow:0 16px 40px -10px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.22);">
      <div class="row1" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="font-size:13px; font-weight:700; color:var(--text-dim); letter-spacing:0.02em;">Desativados</span>
        <div style="width:38px; height:38px; border-radius:50%; background:linear-gradient(135deg, rgba(239,68,68,0.25), rgba(185,28,28,0.15)); border:1.5px solid rgba(248,113,113,0.4); display:flex; align-items:center; justify-content:center; box-shadow:0 0 16px rgba(239,68,68,0.3); font-size:16px;">🚫</div>
      </div>
      <div class="val" style="font-size:28px; font-weight:900; color:#F87171; margin-bottom:2px; letter-spacing:-0.02em;">${inactiveCount}</div>
      <div class="sub" style="font-size:12px; color:#FECACA; font-weight:600; margin-top:4px;">Acesso bloqueado</div>
    </div>
  </div>

  <div class="admin-toolbar-panel" style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.12); border-radius:18px; padding:12px 16px; backdrop-filter:blur(20px); -webkit-backdrop-filter:blur(20px); box-shadow:0 8px 30px rgba(0,0,0,0.35); margin-bottom:20px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px;">
    <div class="admin-search-wrap" style="position:relative; flex:1; min-width:260px;">
      <svg style="position:absolute; left:14px; top:50%; transform:translateY(-50%); width:16px; height:16px; color:#94A3B8; pointer-events:none;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="text" id="adminUserSearchInput" class="admin-search-input" placeholder="Buscar por nome, e-mail, CPF ou WhatsApp..." oninput="handleAdminUserSearch(this.value)" autocomplete="off" spellcheck="false" value="${currentAdminUserSearch}" style="width:100%; height:42px; padding:0 14px 0 40px; border-radius:12px; background:var(--input-bg, rgba(255,255,255,0.05)); border:1px solid rgba(255,255,255,0.14); color:var(--text); font-size:13.5px; font-weight:600; outline:none; transition:all 0.2s ease;">
    </div>
    <div class="admin-filter-bar" style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
      <button class="admin-filter-btn ${currentAdminUserFilter==='all'?'active':''}" onclick="setAdminUserFilter('all', this)">Todos (${totalUsers})</button>
      <button class="admin-filter-btn ${currentAdminUserFilter==='admin'?'active':''}" onclick="setAdminUserFilter('admin', this)">Admins (${adminCount})</button>
      <button class="admin-filter-btn ${currentAdminUserFilter==='user'?'active':''}" onclick="setAdminUserFilter('user', this)">Usuários (${totalUsers - adminCount})</button>
      <button class="admin-filter-btn ${currentAdminUserFilter==='active'?'active':''}" onclick="setAdminUserFilter('active', this)">Ativos (${activeCount})</button>
      <button class="admin-filter-btn ${currentAdminUserFilter==='inactive'?'active':''}" onclick="setAdminUserFilter('inactive', this)">Desativados (${inactiveCount})</button>
    </div>
  </div>

  <div class="panel" style="margin-bottom:0; padding:24px 26px;">
    <div class="panel-head" style="margin-bottom:14px; display:flex; justify-content:space-between; align-items:center;">
      <h3 style="font-size:16.5px; font-weight:800; color:var(--text); display:flex; align-items:center; gap:8px;">
        <span>📋</span> Lista Geral de Contas & Correção Cadastral
      </h3>
      <span class="tag" style="cursor:default; font-weight:800; font-size:12px; padding:5px 14px; border-radius:20px; background:rgba(59,130,246,0.15); border:1px solid rgba(59,130,246,0.35); color:#60A5FA;">${totalUsers} cadastrado(s)</span>
    </div>
    <p class="cfg-hint" style="margin-bottom:18px; font-size:13px; color:var(--text-dim); line-height:1.5;">
      💡 O autocadastro é feito pelo próprio usuário. Caso precise corrigir nome, CPF, e-mail, telefone/WhatsApp ou redefinir senha, clique em <strong>✏️ Corrigir Dados</strong>.
    </p>
    <div class="user-admin-list">
      ${users.map(u=>{
        const stats = getUserActivitySummary(u.email);
        const isAdminUser = u.role === 'Administrador';
        const isInactive = u.active === false;
        const isSelf = currentUser && currentUser.email && u.email && (currentUser.email.toLowerCase() === u.email.toLowerCase());
        const initials = (u.name || 'U').trim().split(/\\s+/).map(w => w[0]).filter(Boolean).slice(0,2).join('').toUpperCase() || 'US';

        const rawCpf = String(u.cpf || '').replace(/\\D/g, '');
        const rawPhone = String(u.phone || '').replace(/\\D/g, '');
        const formattedCpf = rawCpf.length === 11 ? rawCpf.replace(/(\\d{3})(\\d{3})(\\d{3})(\\d{2})/, '$1.$2.$3-$4') : (u.cpf || '');
        const formattedPhone = rawPhone.length === 11 ? rawPhone.replace(/(\\d{2})(\\d{5})(\\d{4})/, '($1) $2-$3') : (rawPhone.length === 10 ? rawPhone.replace(/(\\d{2})(\\d{4})(\\d{4})/, '($1) $2-$3') : (u.phone || ''));

        return `
        <div class="user-card-4k ${isInactive ? 'inactive' : ''}" data-user-email="${(u.email||'').toLowerCase()}" data-user-cpf="${rawCpf}" data-user-phone="${rawPhone}" data-user-role="${isAdminUser ? 'admin' : 'user'}" data-user-status="${isInactive ? 'inactive' : 'active'}">
          <div class="user-card-left">
            <div class="user-card-avatar ${isAdminUser ? 'admin-av' : 'user-av'}">
              ${initials}
              <span class="user-status-dot ${isInactive ? 'offline' : 'online'}"></span>
            </div>
            <div class="user-card-info">
              <div class="user-card-name-row">
                <span class="user-card-name">${u.name}</span>
                <span class="role-badge ${isAdminUser ? 'admin' : 'user'}">${u.role}</span>
                ${isInactive ? '<span class="role-badge inactive">Desativado</span>' : ''}
              </div>
              <div class="user-card-email" style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-top:3px;">
                <span>✉️ ${u.email}</span>
                ${formattedCpf ? `<span style="font-size:12px; color:var(--text-dim); background:rgba(255,255,255,0.06); padding:2px 8px; border-radius:6px; border:1px solid rgba(255,255,255,0.1);">🪪 CPF: <strong style="color:var(--text);">${formattedCpf}</strong></span>` : '<span style="font-size:11.5px; color:#94A3B8; font-style:italic;">(Sem CPF)</span>'}
                ${formattedPhone ? `<span style="font-size:12px; color:#34D399; background:rgba(16,185,129,0.12); padding:2px 8px; border-radius:6px; border:1px solid rgba(16,185,129,0.3);">📱 <strong style="color:#6EE7B7;">${formattedPhone}</strong></span>` : ''}
              </div>
              <div class="user-card-stats-strip" style="margin-top:6px;">
                ${stats.hasData ? `
                  <span class="user-stat-chip">Transações: <strong>${stats.txCount}</strong></span>
                  <span class="user-stat-chip">Contas: <strong>${stats.accCount}</strong></span>
                  <span class="user-stat-chip">Orçamentos: <strong>${stats.budCount}</strong></span>
                  <span class="user-stat-chip">Metas: <strong>${stats.goalCount}</strong></span>
                  ${stats.lastDate ? `<span class="user-stat-chip">Última mov: <strong>${formatDateBR(stats.lastDate)}</strong></span>` : ''}
                ` : '<span class="user-stat-chip">Ainda sem movimentações</span>'}
                <span class="user-stat-chip user-last-login-chip" style="background:rgba(59,130,246,0.14); border:1px solid rgba(96,165,250,0.35); color:#93C5FD; display:inline-flex; align-items:center; gap:5px;">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  Último login: <strong style="color:#FFFFFF;">${formatDateTimeWithSeconds(u.last_login)}</strong>
                </span>
              </div>
            </div>
          </div>
          <div class="user-card-right">
            ${rawPhone ? `
              <a href="https://wa.me/55${rawPhone}" target="_blank" class="user-card-btn" style="background:rgba(16,185,129,0.14); border:1px solid rgba(16,185,129,0.35); color:#34D399; text-decoration:none; display:inline-flex; align-items:center; gap:5px; padding:0 12px; height:38px; border-radius:10px;" title="Conversar no WhatsApp">
                <span>💬 WhatsApp</span>
              </a>
            ` : ''}
            ${!isSelf ? `
              <button type="button" class="user-card-btn btn-espelho" data-viewuser="${u.email}" onclick="viewUserData('${u.email}')" title="Visualizar conta em Modo Espelho">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                <span>Espelho</span>
              </button>
              <button type="button" class="user-card-btn ${isInactive ? 'btn-ativar' : 'btn-desativar'}" data-toggleuser="${u.email}" onclick="toggleUserActive('${u.email}')" title="${isInactive ? 'Ativar usuário' : 'Desativar usuário'}">
                ${isInactive ? `
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  <span>Ativar</span>
                ` : `
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                  <span>Desativar</span>
                `}
              </button>
              <button type="button" class="user-card-btn btn-excluir" data-deluser="${u.email}" onclick="deleteUserAdmin('${u.email}')" title="Excluir usuário permanentemente">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                <span>Excluir</span>
              </button>
            ` : `
              <span class="user-stat-chip" style="background:rgba(245,158,11,0.15); color:#FBBF24; border:1px solid rgba(245,158,11,0.3); font-weight:800; font-size:12px; padding:6px 14px; border-radius:12px; height:38px;">⭐ Sua Conta (Atual)</span>
            `}
            <button type="button" class="user-card-btn btn-editar" data-edituser="${u.email}" onclick="openUserAdminModal('${u.email}')" title="Corrigir dados do cadastro" style="background:linear-gradient(135deg, #3B82F6, #1D4ED8); color:#ffffff; font-weight:800; border:none; box-shadow:0 4px 14px rgba(59,130,246,0.35);">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              <span>Corrigir Dados</span>
            </button>
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

/* ==================== Logs de Auditoria do Sistema ==================== */
let systemLogs = [];

async function logActivity(action, entity, details) {
  if (!currentUser) return;
  const logEntry = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    user_name: currentUser.name || 'Usuário',
    user_email: currentUser.email || '',
    action: action,
    entity: entity,
    details: details
  };

  systemLogs.unshift(logEntry);
  try {
    saveToStorage('nexus_system_logs', systemLogs.slice(0, 500));
  } catch(e){}

  try {
    const payload = JSON.stringify({
      userName: currentUser.name,
      userEmail: currentUser.email,
      action: action,
      entity: entity,
      details: details
    });

    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon(window.location.origin + '/api/logs', blob);
    } else {
      fetch(window.location.origin + '/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true
      }).catch(() => {});
    }
  } catch(e) {}
}

async function loadSystemLogs() {
  try {
    const res = await fetch(window.location.origin + '/api/logs');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        systemLogs = data.filter(l => !l.details || !l.details.includes('salvou e sincronizou suas alterações'));
        saveToStorage('nexus_system_logs', systemLogs.slice(0, 500));
        return systemLogs;
      }
    }
  } catch(e) {}

  const cached = loadFromStorage('nexus_system_logs', null);
  if (Array.isArray(cached) && cached.length > 0) {
    systemLogs = cached.filter(l => !l.details || !l.details.includes('salvou e sincronizou suas alterações'));
  }
  return systemLogs;
}

function renderLogsTable(list) {
  if (!list || list.length === 0) {
    return '<div class="placeholder"><div class="big">📜</div><h3>Nenhum registro de log encontrado</h3><p>As ações e alterações dos usuários serão registradas aqui em tempo real.</p></div>';
  }

  let rowsHtml = list.map(function(l) {
    const dateStr = l.timestamp ? new Date(l.timestamp).toLocaleString('pt-BR') : '—';
    let actionBadgeClass = 'var(--purple)';
    let actionBg = 'rgba(155,107,216,0.15)';
    const actLower = (l.action || '').toLowerCase();
    if (actLower.includes('cria') || actLower.includes('novo') || actLower.includes('adiç')) {
      actionBadgeClass = 'var(--green)';
      actionBg = 'var(--green-soft)';
    } else if (actLower.includes('ediç') || actLower.includes('alter')) {
      actionBadgeClass = 'var(--orange)';
      actionBg = 'rgba(232,176,75,0.15)';
    } else if (actLower.includes('excl') || actLower.includes('remov') || actLower.includes('desativ')) {
      actionBadgeClass = 'var(--red)';
      actionBg = 'var(--red-soft)';
    } else if (actLower.includes('login') || actLower.includes('acesso')) {
      actionBadgeClass = 'var(--blue)';
      actionBg = 'rgba(74,144,226,0.15)';
    }

    let formattedDetails = (l.details || '');
    if (formattedDetails.includes('➔')) {
      const parts = formattedDetails.split(' | ');
      formattedDetails = parts.map(function(part) {
        if (part.includes('➔')) {
          const colonIdx = part.indexOf(': ');
          let fieldName = '';
          let valsStr = part;
          if (colonIdx !== -1) {
            fieldName = part.substring(0, colonIdx);
            valsStr = part.substring(colonIdx + 2);
          }
          const arrowIdx = valsStr.indexOf('➔');
          const oldV = arrowIdx !== -1 ? valsStr.substring(0, arrowIdx).trim() : '';
          const newV = arrowIdx !== -1 ? valsStr.substring(arrowIdx + 1).trim() : '';

          return '<span style="display:inline-flex; align-items:center; margin:2px 4px 2px 0; padding:4px 9px; background:rgba(255,255,255,0.04); border-radius:8px; border:1px solid rgba(255,255,255,0.08); font-size:12px;">'
            + (fieldName ? '<strong style="color:var(--text-dim); margin-right:5px;">' + fieldName + ':</strong> ' : '')
            + '<span style="color:#ef5a5a; text-decoration:line-through; margin-right:4px; opacity:0.85;">' + oldV + '</span>'
            + '<span style="color:#e8b04b; font-weight:bold; margin:0 5px;">➔</span>'
            + '<span style="color:#3ec7c7; font-weight:700;">' + newV + '</span>'
            + '</span>';
        }
        return '<span style="display:inline-block; margin:2px 0;">' + part + '</span>';
      }).join(' ');
    }

    return '<tr class="trow">'
      + '<td style="font-size:12px; color:var(--text-dim); white-space:nowrap;">' + dateStr + '</td>'
      + '<td><div style="display:flex; flex-direction:column;"><strong style="font-size:12.5px;">' + (l.user_name || 'Usuário') + '</strong><span style="font-size:11px; color:var(--text-faint);">' + (l.user_email || '—') + '</span></div></td>'
      + '<td><span class="pill" style="background:' + actionBg + '; color:' + actionBadgeClass + '; font-weight:700;">' + l.action + '</span></td>'
      + '<td><span class="pill" style="background:rgba(255,255,255,0.05); color:var(--text-dim); font-weight:600;">' + l.entity + '</span></td>'
      + '<td style="font-size:12.5px; line-height:1.5;">' + formattedDetails + '</td>'
      + '</tr>';
  }).join('');

  return '<table id="logsTable"><thead><tr><th style="width:160px;">Data e Hora</th><th style="width:200px;">Usuário (Login)</th><th style="width:130px;">Ação</th><th style="width:150px;">Módulo / Entidade</th><th>Informações Alteradas / Detalhes</th></tr></thead><tbody>' + rowsHtml + '</tbody></table>';
}

function filterLogsTable() {
  const query = (document.getElementById('logSearch') ? document.getElementById('logSearch').value : '').toLowerCase().trim();
  const actSel = (document.getElementById('logFilterAction') ? document.getElementById('logFilterAction').value : '').toLowerCase().trim();
  const entSel = (document.getElementById('logFilterEntity') ? document.getElementById('logFilterEntity').value : '').toLowerCase().trim();

  const filtered = systemLogs.filter(l => {
    const textStr = ((l.user_name||'') + ' ' + (l.user_email||'') + ' ' + (l.action||'') + ' ' + (l.entity||'') + ' ' + (l.details||'')).toLowerCase();
    const matchSearch = !query || textStr.includes(query);
    const matchAct = !actSel || (l.action || '').toLowerCase().includes(actSel);
    const matchEnt = !entSel || (l.entity || '').toLowerCase().includes(entSel);
    return matchSearch && matchAct && matchEnt;
  });

  const wrap = document.getElementById('logTableWrap');
  if (wrap) wrap.innerHTML = renderLogsTable(filtered);
}

function pageLogs(){
  const isAdmin = currentUser && currentUser.role === 'Administrador';
  if(!isAdmin || isViewingOtherUser){
    return `<div class="placeholder"><div class="big">🔒</div><h3>Acesso restrito</h3><p>Esta área de logs é exclusiva para administradores.</p></div>`;
  }

  const logs = systemLogs;
  const countTotal = logs.length;
  const countCriacao = logs.filter(l => (l.action||'').toLowerCase().includes('cria') || (l.action||'').toLowerCase().includes('novo')).length;
  const countEdicao = logs.filter(l => (l.action||'').toLowerCase().includes('ediç') || (l.action||'').toLowerCase().includes('altera')).length;
  const countExclusao = logs.filter(l => (l.action||'').toLowerCase().includes('excl') || (l.action||'').toLowerCase().includes('remov')).length;

  return `
  <div class="page-head">
    <div>
      <h1 style="font-size:22px; font-weight:800; letter-spacing:-0.02em; margin:0; display:flex; align-items:center; gap:8px;">
        Logs & Auditoria do Sistema
      </h1>
      <p style="font-size:12.5px; color:var(--text-dim); margin:4px 0 0 0; font-weight:500;">
        Histórico completo de auditoria com rastreabilidade de acessos, logins e alterações de dados
      </p>
    </div>
    <div class="head-actions">
      <button class="btn-ghost" onclick="loadSystemLogs().then(render)" style="display:flex; align-items:center; gap:6px; font-weight:700;">🔄 Atualizar Logs</button>
    </div>
  </div>

  <div class="kpis" style="grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:14px; margin-bottom:20px;">
    <div class="kpi" style="padding:14px 16px;">
      <div class="row1" style="margin-bottom:6px;"><span>Total de Registros</span><span class="ic" style="width:32px; height:32px; font-size:14px; background:rgba(74,144,226,.14); color:var(--blue);">📋</span></div>
      <div class="val" style="font-size:22px; color:var(--blue); margin-bottom:2px;">${countTotal}</div>
      <div class="sub" style="font-size:11px;">Eventos registrados</div>
    </div>
    <div class="kpi" style="padding:14px 16px;">
      <div class="row1" style="margin-bottom:6px;"><span>Criações</span><span class="ic" style="width:32px; height:32px; font-size:14px; background:rgba(16,185,129,0.14); color:var(--green);">➕</span></div>
      <div class="val" style="font-size:22px; color:var(--green); margin-bottom:2px;">${countCriacao}</div>
      <div class="sub" style="font-size:11px;">Novos dados</div>
    </div>
    <div class="kpi" style="padding:14px 16px;">
      <div class="row1" style="margin-bottom:6px;"><span>Edições</span><span class="ic" style="width:32px; height:32px; font-size:14px; background:rgba(232,176,75,0.14); color:var(--orange);">✎</span></div>
      <div class="val" style="font-size:22px; color:var(--orange); margin-bottom:2px;">${countEdicao}</div>
      <div class="sub" style="font-size:11px;">Registros alterados</div>
    </div>
    <div class="kpi" style="padding:14px 16px;">
      <div class="row1" style="margin-bottom:6px;"><span>Exclusões</span><span class="ic" style="width:32px; height:32px; font-size:14px; background:rgba(239,68,68,0.14); color:var(--red);">🗑</span></div>
      <div class="val" style="font-size:22px; color:var(--red); margin-bottom:2px;">${countExclusao}</div>
      <div class="sub" style="font-size:11px;">Registros removidos</div>
    </div>
  </div>

  <div class="table-panel">
    <div class="panel-head" style="margin-bottom:14px;">
      <h3>Trilha de Auditoria Detalhada</h3>
      <span class="tag" style="font-weight:700;">${logs.length} evento(s)</span>
    </div>
    <div class="filters" style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:16px; align-items:center;">
      <div style="position:relative; flex:1.5; min-width:200px;">
        <input id="logSearch" placeholder="🔍 Buscar por usuário, e-mail, ação ou detalhe..." onkeyup="filterLogsTable()" style="width:100%; font-size:13px;">
      </div>
      <select id="logFilterAction" onchange="filterLogsTable()" style="flex:1; min-width:140px;">
        <option value="">Todas as ações</option>
        <option value="cria">Criação</option>
        <option value="ediç">Edição</option>
        <option value="excl">Exclusão</option>
        <option value="login">Login / Acesso</option>
      </select>
      <select id="logFilterEntity" onchange="filterLogsTable()" style="flex:1; min-width:140px;">
        <option value="">Todas as entidades</option>
        <option value="transa">Transação</option>
        <option value="conta">Conta / Cartão</option>
        <option value="categor">Categoria</option>
        <option value="orçament">Orçamento</option>
        <option value="meta">Meta</option>
        <option value="usuár">Usuário</option>
      </select>
    </div>

    <div id="logTableWrap">
      ${renderLogsTable(logs)}
    </div>
  </div>
  `;
}

/* ==================== Módulo de Ordens de Serviço (O.S.) & Suporte ==================== */
let systemOrdens = [];
let systemTecnicos = [];

async function syncOrdensWithServer() {
  return loadSystemOrdens();
}

async function syncTecnicosWithServer() {
  return loadSystemTecnicos();
}

async function loadSystemTecnicos() {
  try {
    const res = await fetch(window.location.origin + '/api/tecnicos');
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.tecnicos)) {
        systemTecnicos = data.tecnicos;
        saveToStorage('nexus_tecnicos', systemTecnicos);
        updateTecnicosBadge();
        return systemTecnicos;
      }
    }
  } catch(e) {}

  const cached = loadFromStorage('nexus_tecnicos', null);
  if (Array.isArray(cached) && cached.length > 0) {
    systemTecnicos = cached;
    updateTecnicosBadge();
  }
  return systemTecnicos;
}

function updateTecnicosBadge() {
  const badge = document.getElementById('tecnicosBadgeCount');
  if (badge) {
    const activeCount = (systemTecnicos || []).filter(t => t.active !== false).length;
    badge.textContent = activeCount;
  }
}

async function loadSystemOrdens() {
  try {
    const res = await fetch(window.location.origin + '/api/ordens');
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.ordens)) {
        systemOrdens = data.ordens;
        saveToStorage('nexus_ordens_servico', systemOrdens);
        updateOrdensBadge();
        return systemOrdens;
      }
    }
  } catch(e) {}

  const cached = loadFromStorage('nexus_ordens_servico', null);
  if (Array.isArray(cached) && cached.length > 0) {
    systemOrdens = cached;
    updateOrdensBadge();
  }
  return systemOrdens;
}

function updateOrdensBadge() {
  const badge = document.getElementById('osBadgeCount');
  if (!badge) return;
  const pendingCount = (systemOrdens || []).filter(o => (o.status || '').toLowerCase() === 'pendente').length;
  if (pendingCount > 0) {
    badge.textContent = pendingCount;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

// Helper para sanitização no cliente
function escapeOsHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, function(m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
  });
}

window.switchOsModalTab = function(tab) {
  const btnAbrir = document.getElementById('tabBtnNovaOrdem');
  const btnConsultar = document.getElementById('tabBtnConsultarOrdem');
  const boxForm = document.getElementById('boxNovaOrdemForm');
  const boxSuccess = document.getElementById('boxNovaOrdemSuccess');
  const boxConsultar = document.getElementById('boxConsultarOrdem');
  const feedback = document.getElementById('osFormFeedback');

  if (boxSuccess) boxSuccess.style.display = 'none';
  if (feedback) feedback.style.display = 'none';

  if (tab === 'consultar') {
    if (btnAbrir) btnAbrir.classList.remove('active');
    if (btnConsultar) btnConsultar.classList.add('active');
    if (boxForm) boxForm.style.display = 'none';
    if (boxConsultar) boxConsultar.style.display = 'block';
    const queryInput = document.getElementById('osConsultarQuery');
    if (queryInput) setTimeout(() => queryInput.focus(), 60);
  } else {
    if (btnAbrir) btnAbrir.classList.add('active');
    if (btnConsultar) btnConsultar.classList.remove('active');
    if (boxForm) boxForm.style.display = 'block';
    if (boxConsultar) boxConsultar.style.display = 'none';
    const nameInput = document.getElementById('osClientName');
    if (nameInput) setTimeout(() => nameInput.focus(), 60);
  }
};

window.consultarProtocoloRecente = function() {
  const protoEl = document.getElementById('osSuccessProtocol');
  const proto = protoEl ? protoEl.textContent.trim().replace('#', '') : '';
  switchOsModalTab('consultar');
  const queryInput = document.getElementById('osConsultarQuery');
  if (queryInput && proto) {
    queryInput.value = proto;
    executarConsultaOrdens();
  }
};

// Abertura e Consulta de O.S. (Público na Tela de Login)
window.openNovaOrdemModal = function(preselectedTypeOrTab) {
  const overlay = document.getElementById('overlayNovaOrdem');
  if (!overlay) return;
  
  const formBox = document.getElementById('boxNovaOrdemForm');
  const successBox = document.getElementById('boxNovaOrdemSuccess');
  const feedback = document.getElementById('osFormFeedback');
  const form = document.getElementById('formNovaOrdem');
  
  if (formBox) formBox.style.display = 'block';
  if (successBox) successBox.style.display = 'none';
  if (feedback) feedback.style.display = 'none';
  if (form) form.reset();

  overlay.classList.add('show');
  overlay.style.display = 'flex';

  if (preselectedTypeOrTab === 'consultar') {
    switchOsModalTab('consultar');
  } else {
    switchOsModalTab('abrir');
    if (preselectedTypeOrTab && preselectedTypeOrTab !== 'abrir') {
      const typeSelect = document.getElementById('osServiceType');
      if (typeSelect) {
        for (let i = 0; i < typeSelect.options.length; i++) {
          if (typeSelect.options[i].value.toLowerCase().includes(preselectedTypeOrTab.toLowerCase())) {
            typeSelect.selectedIndex = i;
            break;
          }
        }
      }
    }
  }
};

window.executarConsultaOrdens = async function(e) {
  if (e && e.preventDefault) e.preventDefault();

  const queryInput = document.getElementById('osConsultarQuery');
  const btn = document.getElementById('btnExecutarConsultaOs');
  const feedback = document.getElementById('osConsultarFeedback');
  const resultsWrap = document.getElementById('osConsultarResultados');

  const query = (queryInput?.value || '').trim();
  if (!query) {
    if (feedback) {
      feedback.style.background = 'rgba(239,68,68,0.18)';
      feedback.style.color = '#FCA5A5';
      feedback.style.border = '1px solid rgba(239,68,68,0.4)';
      feedback.textContent = 'Por favor, digite seu Nome Completo ou E-mail cadastrado.';
      feedback.style.display = 'block';
    }
    return;
  }

  if (feedback) feedback.style.display = 'none';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Buscando...';
  }
  if (resultsWrap) {
    resultsWrap.innerHTML = '<div style="text-align:center; padding:30px 14px; color:#94A3B8;"><div style="font-size:26px; margin-bottom:8px;">⏳</div>Localizando suas ordens de serviço...</div>';
  }

  try {
    const res = await fetch(window.location.origin + '/api/ordens/consultar?query=' + encodeURIComponent(query));
    const data = await res.json();

    if (res.ok && data.success) {
      const list = data.ordens || [];
      if (list.length === 0) {
        resultsWrap.innerHTML = `
          <div style="text-align:center; padding:30px 14px; color:#94A3B8; background:rgba(255,255,255,0.02); border-radius:14px; border:1px dashed rgba(255,255,255,0.12);">
            <div style="font-size:32px; margin-bottom:6px;">📭</div>
            <h4 style="font-size:15px; color:var(--text); margin:0 0 4px 0; font-weight:800;">Nenhum chamado encontrado</h4>
            <p style="font-size:12px; margin:0; line-height:1.4;">Não encontramos nenhuma O.S. aberta para "<strong>${escapeOsHtml(query)}</strong>". Verifique se digitou o mesmo nome ou e-mail cadastrado.</p>
          </div>
        `;
      } else {
        let cardsHtml = `
          <div style="font-size:12px; font-weight:800; color:#93C5FD; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
            <span>${list.length} chamado(s) encontrado(s):</span>
            <span style="font-size:11px; color:#94A3B8;">Atualizado em tempo real</span>
          </div>
        `;

        list.forEach(o => {
          let statusBg = 'rgba(234,179,8,0.15)', statusColor = '#FBBF24', statusBorder = 'rgba(234,179,8,0.35)', statusLabel = '⏳ Pendente';
          const st = (o.status || '').toLowerCase();
          if (st.includes('anda')) {
            statusBg = 'rgba(59,130,246,0.18)'; statusColor = '#60A5FA'; statusBorder = 'rgba(59,130,246,0.4)'; statusLabel = '⚙️ Em Andamento';
          } else if (st.includes('concl') || st.includes('final')) {
            statusBg = 'rgba(16,185,129,0.18)'; statusColor = '#34D399'; statusBorder = 'rgba(16,185,129,0.4)'; statusLabel = '✅ Concluído';
          } else if (st.includes('canc') || st.includes('recus')) {
            statusBg = 'rgba(239,68,68,0.15)'; statusColor = '#F87171'; statusBorder = 'rgba(239,68,68,0.35)'; statusLabel = '❌ Cancelado';
          }

          let dateFormatted = o.created_at ? new Date(o.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Data não informada';

          cardsHtml += `
            <div class="os-consult-card">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px; gap:8px; flex-wrap:wrap;">
                <div style="display:flex; align-items:center; gap:8px;">
                  <span style="font-weight:900; font-family:monospace; font-size:12.5px; padding:3px 9px; border-radius:6px; background:rgba(59,130,246,0.18); color:#93C5FD; border:1px solid rgba(59,130,246,0.35);">
                    #${o.protocol || o.id}
                  </span>
                  <span style="font-size:11.5px; color:#94A3B8;">${dateFormatted}</span>
                </div>
                <span style="display:inline-flex; align-items:center; gap:5px; padding:3px 10px; border-radius:999px; font-size:11.5px; font-weight:800; background:${statusBg}; color:${statusColor}; border:1px solid ${statusBorder};">
                  ${statusLabel}
                </span>
              </div>

              <h4 style="font-size:14.5px; font-weight:800; color:#FFFFFF; margin:0 0 6px 0;">
                ${escapeOsHtml(o.title || 'Solicitação sem assunto')}
              </h4>

              <div style="display:flex; gap:12px; font-size:12px; color:#CBD5E1; margin-bottom:10px; flex-wrap:wrap; align-items:center;">
                <span><strong>Solicitante:</strong> ${escapeOsHtml(o.client_name || 'Anônimo')}</span>
                <span><strong>Tipo:</strong> ${escapeOsHtml(o.service_type || 'Geral')}</span>
                <span><strong>Prioridade:</strong> ${escapeOsHtml(o.priority || 'Normal')}</span>
                ${o.tecnico_responsavel ? `<span style="color:#38BDF8; font-weight:700;"><strong>👷 Técnico Responsável:</strong> ${escapeOsHtml(o.tecnico_responsavel)}</span>` : '<span style="color:#94A3B8; font-style:italic;">(Aguardando atribuição de técnico)</span>'}
              </div>

              <div style="background:rgba(0,0,0,0.25); border-radius:10px; padding:10px 12px; font-size:12px; color:#E2E8F0; margin-bottom:10px; line-height:1.45; border:1px solid rgba(255,255,255,0.06);">
                <span style="display:block; font-size:10.5px; font-weight:800; color:#94A3B8; text-transform:uppercase; margin-bottom:3px;">Descrição do seu pedido:</span>
                ${escapeOsHtml(o.description || 'Sem descrição informada.')}
              </div>

              ${o.admin_notes ? `
                <div style="background:linear-gradient(135deg, rgba(16,185,129,0.12), rgba(5,150,105,0.08)); border:1.5px solid rgba(52,211,153,0.35); border-radius:12px; padding:12px; margin-top:10px;">
                  <div style="display:flex; align-items:center; gap:6px; font-size:11.5px; font-weight:800; color:#34D399; margin-bottom:4px; text-transform:uppercase;">
                    <span>💬 Parecer / Resposta da Equipe Técnica:</span>
                  </div>
                  <div style="font-size:12.5px; color:#F1F5F9; font-weight:600; line-height:1.45;">
                    ${escapeOsHtml(o.admin_notes)}
                  </div>
                </div>
              ` : `
                <div style="font-size:11.5px; color:#94A3B8; font-style:italic; margin-top:6px;">
                  ℹ️ Chamado em triagem. Aguarde o retorno técnico nesta mesma tela.
                </div>
              `}
            </div>
          `;
        });

        resultsWrap.innerHTML = cardsHtml;
      }
    } else {
      resultsWrap.innerHTML = '<div style="color:#F87171; text-align:center; padding:20px;">' + (data.message || 'Erro ao consultar ordens.') + '</div>';
    }
  } catch(err) {
    resultsWrap.innerHTML = '<div style="color:#F87171; text-align:center; padding:20px;">Falha de comunicação com o servidor. Verifique sua conexão.</div>';
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🔍 Buscar O.S.';
    }
  }
};

window.closeNovaOrdemModal = function() {
  const overlay = document.getElementById('overlayNovaOrdem');
  if (!overlay) return;
  overlay.classList.remove('show');
  setTimeout(() => overlay.style.display = 'none', 200);
};

window.enviarNovaOrdem = async function(e) {
  if (e && e.preventDefault) e.preventDefault();
  const btn = document.getElementById('btnSubmitOs');
  const feedback = document.getElementById('osFormFeedback');

  const clientName = (document.getElementById('osClientName')?.value || '').trim();
  const clientEmail = (document.getElementById('osClientEmail')?.value || '').trim();
  const clientPhone = (document.getElementById('osClientPhone')?.value || '').trim();
  const clientCpf = (document.getElementById('osClientCpf')?.value || '').trim();
  const serviceType = document.getElementById('osServiceType')?.value || 'Melhoria no Sistema';
  const priority = document.getElementById('osPriority')?.value || 'Normal';
  const title = (document.getElementById('osTitle')?.value || '').trim();
  const description = (document.getElementById('osDescription')?.value || '').trim();

  if (!clientName || !clientEmail || !title || !description) {
    if (feedback) {
      feedback.className = 'auth-feedback-banner error';
      feedback.textContent = 'Por favor, preencha todos os campos obrigatórios (*).';
      feedback.style.display = 'block';
    }
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Enviando Ordem de Serviço...';
  }

  try {
    const res = await fetch(window.location.origin + '/api/ordens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: clientName,
        client_email: clientEmail,
        client_phone: clientPhone,
        client_cpf: clientCpf,
        service_type: serviceType,
        priority: priority,
        canal_atendimento: 'Portal Web / Login',
        title: title,
        description: description
      })
    });

    const result = await res.json();
    if (res.ok && result.success) {
      const formBox = document.getElementById('boxNovaOrdemForm');
      const successBox = document.getElementById('boxNovaOrdemSuccess');
      const protocolEl = document.getElementById('osSuccessProtocol');

      if (protocolEl) protocolEl.textContent = result.protocol || '#OS-CONFIRMADO';
      if (formBox) formBox.style.display = 'none';
      if (successBox) successBox.style.display = 'block';

      if (typeof syncOrdensWithServer === 'function') {
        syncOrdensWithServer();
      }
    } else {
      if (feedback) {
        feedback.className = 'auth-feedback-banner error';
        feedback.textContent = result.message || 'Erro ao registrar ordem de serviço. Tente novamente.';
        feedback.style.display = 'block';
      }
    }
  } catch(err) {
    if (feedback) {
      feedback.className = 'auth-feedback-banner error';
      feedback.textContent = 'Falha de comunicação com o servidor. Verifique sua conexão.';
      feedback.style.display = 'block';
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Enviar Ordem de Serviço 🚀';
    }
  }
};

window.copyOsProtocol = function() {
  const protocolEl = document.getElementById('osSuccessProtocol');
  if (!protocolEl) return;
  const proto = protocolEl.textContent.trim();
  navigator.clipboard.writeText(proto).then(() => {
    showToast('Protocolo ' + proto + ' copiado para a área de transferência!');
  }).catch(() => {
    showToast('Protocolo: ' + proto);
  });
};

window.currentOsTabFilter = 'todas';

window.setOsStatusTab = function(tab) {
  window.currentOsTabFilter = tab || 'todas';
  const btns = document.querySelectorAll('.os-status-tab-btn');
  btns.forEach(b => {
    if (b.getAttribute('data-tab') === tab) {
      b.classList.add('active');
    } else {
      b.classList.remove('active');
    }
  });
  filterOrdensTable();
};

function renderOrdensTable(list) {
  if (!list || list.length === 0) {
    return '<div class="placeholder"><div class="big">📋</div><h3>Nenhuma Ordem de Serviço encontrada</h3><p>Quando os usuários abrirem solicitações de suporte ou melhorias, elas aparecerão listadas aqui em tempo real.</p></div>';
  }

  let html = '<div style="overflow-x:auto;">';
  html += '<table style="width:100%; border-collapse:collapse; text-align:left;">';
  html += '<thead><tr style="border-bottom:1px solid var(--card-border); text-align:left;">';
  html += '<th style="padding:12px 14px; font-size:11px; text-transform:uppercase; color:var(--text-dim); font-weight:800;">Protocolo</th>';
  html += '<th style="padding:12px 14px; font-size:11px; text-transform:uppercase; color:var(--text-dim); font-weight:800;">Data & Canal</th>';
  html += '<th style="padding:12px 14px; font-size:11px; text-transform:uppercase; color:var(--text-dim); font-weight:800;">Solicitante</th>';
  html += '<th style="padding:12px 14px; font-size:11px; text-transform:uppercase; color:var(--text-dim); font-weight:800;">Demanda / Assunto</th>';
  html += '<th style="padding:12px 14px; font-size:11px; text-transform:uppercase; color:var(--text-dim); font-weight:800;">Técnico Responsável</th>';
  html += '<th style="padding:12px 14px; font-size:11px; text-transform:uppercase; color:var(--text-dim); font-weight:800;">Prioridade</th>';
  html += '<th style="padding:12px 14px; font-size:11px; text-transform:uppercase; color:var(--text-dim); font-weight:800;">Status</th>';
  html += '<th style="padding:12px 14px; font-size:11px; text-transform:uppercase; color:var(--text-dim); font-weight:800; text-align:right;">Ações</th>';
  html += '</tr></thead><tbody>';

  list.forEach(o => {
    let statusBg = 'rgba(234,179,8,0.15)', statusColor = '#FBBF24', statusBorder = 'rgba(234,179,8,0.35)', statusLabel = '⏳ Pendente';
    const st = (o.status || '').toLowerCase();
    if (st.includes('anda')) {
      statusBg = 'rgba(59,130,246,0.18)'; statusColor = '#60A5FA'; statusBorder = 'rgba(59,130,246,0.4)'; statusLabel = '⚙️ Em Andamento';
    } else if (st.includes('concl') || st.includes('final')) {
      statusBg = 'rgba(16,185,129,0.18)'; statusColor = '#34D399'; statusBorder = 'rgba(16,185,129,0.4)'; statusLabel = '✅ Concluído';
    } else if (st.includes('canc') || st.includes('recus')) {
      statusBg = 'rgba(239,68,68,0.15)'; statusColor = '#F87171'; statusBorder = 'rgba(239,68,68,0.35)'; statusLabel = '❌ Cancelado';
    }

    let prioBg = 'rgba(16,185,129,0.12)', prioColor = '#34D399', prioBorder = 'rgba(16,185,129,0.3)';
    const prio = (o.priority || '').toLowerCase();
    if (prio.includes('urg')) {
      prioBg = 'rgba(239,68,68,0.18)'; prioColor = '#F87171'; prioBorder = 'rgba(239,68,68,0.4)';
    } else if (prio.includes('alt')) {
      prioBg = 'rgba(245,158,11,0.18)'; prioColor = '#FBBF24'; prioBorder = 'rgba(245,158,11,0.4)';
    }

    const dateFormatted = o.created_at ? new Date(o.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Hoje';
    const cleanPhone = String(o.client_phone || '').replace(/D/g, '');
    const protoClean = escapeOsHtml(o.protocol || o.id);

    html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.05); transition:background 0.15s ease;" onmouseover="this.style.background='rgba(255,255,255,0.03)'" onmouseout="this.style.background='transparent'">';
    
    html += '<td style="padding:13px 14px; white-space:nowrap;">';
    html += '<div style="display:inline-flex; align-items:center; gap:5px;">';
    html += '<span style="font-weight:800; font-family:monospace; font-size:12px; padding:3px 8px; border-radius:6px; background:rgba(59,130,246,0.12); color:#93C5FD; border:1px solid rgba(59,130,246,0.3);">#' + protoClean + '</span>';
    html += '<button type="button" onclick="copyProtocolText('' + protoClean + '')" style="background:none; border:none; cursor:pointer; font-size:13px; padding:2px; color:var(--text-dim);" title="Copiar Protocolo">📋</button>';
    html += '</div></td>';

    html += '<td style="padding:13px 14px; font-size:12px; color:var(--text-dim); white-space:nowrap;">';
    html += '<div>' + dateFormatted + '</div>';
    html += '<span style="display:inline-block; margin-top:3px; font-size:10.5px; font-weight:700; color:#38BDF8; padding:1px 6px; border-radius:4px; background:rgba(56,189,248,0.12); border:1px solid rgba(56,189,248,0.25);">' + escapeOsHtml(o.canal_atendimento || 'Portal Web') + '</span>';
    html += '</td>';

    html += '<td style="padding:13px 14px;">';
    html += '<div style="font-weight:700; color:var(--text); font-size:13px;">' + escapeOsHtml(o.client_name || 'Anônimo') + '</div>';
    html += '<div style="font-size:11.5px; color:var(--text-dim); margin-top:1px;"><a href="mailto:' + escapeOsHtml(o.client_email || '') + '" style="color:var(--text-dim); text-decoration:none;">' + escapeOsHtml(o.client_email || '') + '</a></div>';
    if (cleanPhone) {
      html += '<div style="font-size:11px; margin-top:2px;"><a href="https://wa.me/55' + cleanPhone + '" target="_blank" style="color:#34D399; font-weight:700; text-decoration:none;">📱 ' + escapeOsHtml(o.client_phone) + '</a></div>';
    }
    if (o.client_cpf) {
      html += '<div style="font-size:10.5px; color:#A78BFA; font-weight:700; margin-top:2px;">🪪 CPF: ' + escapeOsHtml(o.client_cpf) + '</div>';
    }
    html += '</td>';

    html += '<td style="padding:13px 14px; max-width:280px;">';
    html += '<div style="display:inline-block; padding:2px 7px; border-radius:4px; font-size:10.5px; font-weight:800; background:rgba(59,130,246,0.12); color:#93C5FD; margin-bottom:3px;">' + escapeOsHtml(o.service_type || 'Melhoria') + '</div>';
    html += '<div style="font-weight:700; color:var(--text); font-size:12.5px;">' + escapeOsHtml(o.title || 'Sem título') + '</div>';
    if (o.description) {
      html += '<div style="font-size:11px; color:var(--text-dim); margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="' + escapeOsHtml(o.description) + '">' + escapeOsHtml(o.description) + '</div>';
    }
    html += '</td>';

    html += '<td style="padding:13px 14px; white-space:nowrap;">';
    if (o.tecnico_responsavel) {
      html += '<div style="font-weight:800; color:#38BDF8; font-size:12.5px; display:inline-flex; align-items:center; gap:4px;">👷 ' + escapeOsHtml(o.tecnico_responsavel) + '</div>';
      html += '<div style="font-size:10.5px; color:var(--text-dim); margin-top:2px;">' + (o.assumido_em ? ('Assumido ' + new Date(o.assumido_em).toLocaleDateString('pt-BR')) : 'Em atendimento') + '</div>';
    } else {
      html += '<button type="button" onclick="quickAssumirOrdemPrompt('' + o.id + '')" style="display:inline-flex; align-items:center; gap:4px; padding:5px 12px; border-radius:8px; background:rgba(245,158,11,0.15); color:#FBBF24; border:1px solid rgba(245,158,11,0.4); font-size:11.5px; font-weight:800; cursor:pointer;" title="Assumir esta Ordem de Serviço">';
      html += '<span>⚡ Assumir Chamado</span></button>';
    }
    html += '</td>';

    html += '<td style="padding:13px 14px; white-space:nowrap;">';
    html += '<span style="display:inline-block; padding:3px 9px; border-radius:999px; font-size:11px; font-weight:800; background:' + prioBg + '; color:' + prioColor + '; border:1px solid ' + prioBorder + ';">' + escapeOsHtml(o.priority || 'Normal') + '</span>';
    html += '</td>';

    html += '<td style="padding:13px 14px; white-space:nowrap;">';
    html += '<span style="display:inline-flex; align-items:center; gap:5px; padding:3px 10px; border-radius:999px; font-size:11.5px; font-weight:800; background:' + statusBg + '; color:' + statusColor + '; border:1px solid ' + statusBorder + ';">' + statusLabel + '</span>';
    if (o.concluido_em) {
      html += '<div style="font-size:10px; color:#34D399; margin-top:2px;">Finalizado ' + new Date(o.concluido_em).toLocaleDateString('pt-BR') + '</div>';
    }
    html += '</td>';

    html += '<td style="padding:13px 14px; text-align:right; white-space:nowrap;">';
    html += '<div style="display:flex; gap:5px; justify-content:flex-end; align-items:center;">';
    html += '<button type="button" onclick="openOrdemAdminModal('' + o.id + '')" style="padding:6px 11px; border-radius:8px; background:linear-gradient(135deg, #3B82F6, #1D4ED8); color:#ffffff; font-size:11.5px; font-weight:800; border:none; cursor:pointer; box-shadow:0 2px 8px rgba(59,130,246,0.3);" title="Atender Chamado">👁️ Atender</button>';
    if (!st.includes('concl') && !st.includes('canc')) {
      html += '<button type="button" onclick="quickConcluirOrdem('' + o.id + '')" style="padding:6px 9px; border-radius:8px; background:rgba(16,185,129,0.18); color:#34D399; border:1px solid rgba(16,185,129,0.35); font-size:11.5px; font-weight:800; cursor:pointer;" title="Concluir O.S. Agora">✓ Concluir</button>';
    }
    html += '<button type="button" onclick="imprimirFichaOrdem('' + o.id + '')" style="padding:6px 8px; border-radius:8px; background:rgba(56,189,248,0.12); color:#38BDF8; border:1px solid rgba(56,189,248,0.3); font-size:11.5px; cursor:pointer;" title="Imprimir Ficha O.S.">🖨️</button>';
    html += '<button type="button" onclick="excluirOrdemAdmin('' + o.id + '')" style="padding:6px 8px; border-radius:8px; background:rgba(239,68,68,0.12); color:#F87171; border:1px solid rgba(239,68,68,0.25); font-size:11.5px; cursor:pointer;" title="Excluir O.S.">🗑️</button>';
    html += '</div></td>';

    html += '</tr>';
  });

  html += '</tbody></table></div>';
  return html;
}

function filterOrdensTable() {
  const query = (document.getElementById('osSearchInput')?.value || '').toLowerCase().trim();
  const statusFilter = (document.getElementById('osFilterStatus')?.value || '').toLowerCase().trim();
  const tecnicoFilter = (document.getElementById('osFilterTecnico')?.value || '').toLowerCase().trim();
  const typeFilter = (document.getElementById('osFilterType')?.value || '').toLowerCase().trim();
  const priorityFilter = (document.getElementById('osFilterPriority')?.value || '').toLowerCase().trim();
  const tabFilter = window.currentOsTabFilter || 'todas';

  const filtered = (systemOrdens || []).filter(o => {
    const text = ((o.protocol||'') + ' ' + (o.client_name||'') + ' ' + (o.client_email||'') + ' ' + (o.client_phone||'') + ' ' + (o.client_cpf||'') + ' ' + (o.title||'') + ' ' + (o.description||'') + ' ' + (o.tecnico_responsavel||'')).toLowerCase();
    const matchQuery = !query || text.includes(query);

    const st = (o.status || '').toLowerCase();
    let matchTab = true;
    if (tabFilter === 'pendente') matchTab = st === 'pendente';
    else if (tabFilter === 'andamento') matchTab = st.includes('anda');
    else if (tabFilter === 'concluido') matchTab = st.includes('concl') || st.includes('final');
    else if (tabFilter === 'cancelado') matchTab = st.includes('canc') || st.includes('recus');

    const matchStatus = !statusFilter || st.includes(statusFilter);
    const matchType = !typeFilter || (o.service_type || '').toLowerCase().includes(typeFilter);
    const matchPriority = !priorityFilter || (o.priority || '').toLowerCase().includes(priorityFilter);
    
    let matchTecnico = true;
    if (tecnicoFilter === '__none__') {
      matchTecnico = !o.tecnico_responsavel;
    } else if (tecnicoFilter) {
      matchTecnico = (o.tecnico_responsavel || '').toLowerCase().includes(tecnicoFilter);
    }

    return matchQuery && matchTab && matchStatus && matchType && matchPriority && matchTecnico;
  });

  window.currentFilteredOrdens = filtered;
  const wrap = document.getElementById('osTableWrap');
  if (wrap) wrap.innerHTML = renderOrdensTable(filtered);
}

function pageOrdens(){
  const isAdmin = currentUser && currentUser.role === 'Administrador';
  if(!isAdmin || isViewingOtherUser){
    const myEmail = (currentUser && currentUser.email) ? currentUser.email.toLowerCase() : '';
    const myOrdens = (systemOrdens || []).filter(o => o.client_email && o.client_email.toLowerCase() === myEmail);
    
    let userHtml = '<div id="ordensPage">';
    userHtml += '<div class="page-head" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; margin-bottom:22px;">';
    userHtml += '<div><h1 style="font-size:23px; font-weight:900; letter-spacing:-0.02em; margin:0; display:flex; align-items:center; gap:10px; color:var(--text);">';
    userHtml += '<span style="display:inline-flex; align-items:center; justify-content:center; width:36px; height:36px; border-radius:12px; background:linear-gradient(135deg, rgba(59,130,246,0.25), rgba(37,99,235,0.12)); border:1px solid rgba(96,165,250,0.35);">🎧</span>';
    userHtml += 'Central de Atendimento & Meus Chamados</h1>';
    userHtml += '<p style="font-size:13.5px; color:var(--text-dim); margin:5px 0 0 0; font-weight:500;">Acompanhe o status e as respostas técnicas das suas solicitações em tempo real.</p></div>';
    userHtml += '<div class="head-actions" style="display:flex; gap:10px; align-items:center;">';
    userHtml += '<button onclick="openNovaOrdemModal('abrir')" style="display:inline-flex; align-items:center; gap:8px; height:42px; padding:0 18px; border-radius:14px; background:linear-gradient(135deg, #10B981, #059669); color:#ffffff; font-size:13px; font-weight:800; border:none; cursor:pointer; box-shadow:0 8px 24px -4px rgba(16,185,129,0.5);">';
    userHtml += '<span>➕ Abrir Nova Solicitação</span></button>';
    userHtml += '<button class="btn-ghost" onclick="syncOrdensWithServer().then(render)" style="display:inline-flex; align-items:center; gap:6px; font-weight:700; height:42px; border-radius:14px;">🔄 Atualizar</button>';
    userHtml += '</div></div>';

    userHtml += '<div class="table-panel" style="background:var(--card); border:1px solid var(--card-border); border-radius:20px; padding:22px; box-shadow:0 20px 50px rgba(0,0,0,0.5);">';
    userHtml += '<div class="panel-head" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">';
    userHtml += '<h3 style="font-size:16px; font-weight:800; margin:0;">Meus Chamados Registrados</h3>';
    userHtml += '<span class="tag" style="font-weight:700;">' + myOrdens.length + ' chamado(s)</span></div>';

    if (myOrdens.length === 0) {
      userHtml += '<div class="placeholder"><div class="big">📭</div><h3>Nenhum chamado aberto</h3><p>Você ainda não abriu nenhuma solicitação de suporte. Precisa de ajuda ou encontrou algo que deseja melhorar no sistema? Clique no botão acima para abrir um chamado.</p></div>';
    } else {
      userHtml += '<div style="display:flex; flex-direction:column; gap:14px;">';
      myOrdens.forEach(o => {
        let statusBg = 'rgba(234,179,8,0.15)', statusColor = '#FBBF24', statusBorder = 'rgba(234,179,8,0.35)', statusLabel = '⏳ Pendente em Triagem';
        const st = (o.status || '').toLowerCase();
        if (st.includes('anda')) {
          statusBg = 'rgba(59,130,246,0.18)'; statusColor = '#60A5FA'; statusBorder = 'rgba(59,130,246,0.4)'; statusLabel = '⚙️ Sendo Atendido';
        } else if (st.includes('concl') || st.includes('final')) {
          statusBg = 'rgba(16,185,129,0.18)'; statusColor = '#34D399'; statusBorder = 'rgba(16,185,129,0.4)'; statusLabel = '✅ Concluído';
        } else if (st.includes('canc')) {
          statusBg = 'rgba(239,68,68,0.15)'; statusColor = '#F87171'; statusBorder = 'rgba(239,68,68,0.35)'; statusLabel = '❌ Cancelado';
        }

        userHtml += '<div style="border:1px solid var(--card-border); border-radius:14px; padding:16px 18px; background:rgba(255,255,255,0.02);">';
        userHtml += '<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px; gap:8px; flex-wrap:wrap;">';
        userHtml += '<div style="display:flex; align-items:center; gap:8px;">';
        userHtml += '<span style="font-weight:900; font-family:monospace; font-size:13px; padding:3px 8px; border-radius:6px; background:rgba(59,130,246,0.14); color:#93C5FD; border:1px solid rgba(59,130,246,0.3);">#' + escapeOsHtml(o.protocol || o.id) + '</span>';
        userHtml += '<span style="font-size:12px; color:var(--text-dim);">' + (o.created_at ? new Date(o.created_at).toLocaleString('pt-BR') : '') + '</span>';
        userHtml += '</div>';
        userHtml += '<div style="display:flex; gap:8px; align-items:center;">';
        userHtml += '<span style="display:inline-flex; align-items:center; gap:5px; padding:3px 10px; border-radius:999px; font-size:11.5px; font-weight:800; background:' + statusBg + '; color:' + statusColor + '; border:1px solid ' + statusBorder + ';">' + statusLabel + '</span>';
        userHtml += '<button type="button" onclick="imprimirFichaOrdem('' + o.id + '')" style="padding:4px 9px; border-radius:8px; background:rgba(56,189,248,0.12); color:#38BDF8; border:1px solid rgba(56,189,248,0.3); font-size:11px; cursor:pointer;" title="Imprimir Comprovante">🖨️ Imprimir</button>';
        userHtml += '</div></div>';

        userHtml += '<h4 style="font-size:15px; font-weight:800; color:var(--text); margin:0 0 6px 0;">' + escapeOsHtml(o.title || '') + '</h4>';
        userHtml += '<div style="font-size:12px; color:var(--text-dim); margin-bottom:8px;"><strong>Tipo:</strong> ' + escapeOsHtml(o.service_type || 'Melhoria') + (o.tecnico_responsavel ? (' | <strong>Técnico:</strong> 👷 ' + escapeOsHtml(o.tecnico_responsavel)) : '') + '</div>';
        userHtml += '<div style="background:rgba(0,0,0,0.22); border-radius:10px; padding:10px 12px; font-size:12.5px; color:var(--text); line-height:1.45; border:1px solid var(--card-border); margin-bottom:10px;">' + escapeOsHtml(o.description || '') + '</div>';

        if (o.admin_notes) {
          userHtml += '<div style="background:linear-gradient(135deg, rgba(16,185,129,0.12), rgba(5,150,105,0.08)); border:1.5px solid rgba(52,211,153,0.35); border-radius:12px; padding:12px;">';
          userHtml += '<div style="font-size:11.5px; font-weight:800; color:#34D399; margin-bottom:4px; text-transform:uppercase;">💬 Resposta da Equipe Técnica:</div>';
          userHtml += '<div style="font-size:12.5px; color:var(--text); font-weight:600; line-height:1.45;">' + escapeOsHtml(o.admin_notes) + '</div>';
          userHtml += '</div>';
        }
        userHtml += '</div>';
      });
      userHtml += '</div>';
    }
    userHtml += '</div></div>';
    return userHtml;
  }

  const ordens = systemOrdens || [];
  const countTotal = ordens.length;
  const countPendentes = ordens.filter(o => (o.status||'').toLowerCase() === 'pendente').length;
  const countAndamento = ordens.filter(o => (o.status||'').toLowerCase().includes('anda')).length;
  const countConcluidas = ordens.filter(o => (o.status||'').toLowerCase().includes('concl') || (o.status||'').toLowerCase().includes('final')).length;
  const countCanceladas = ordens.filter(o => (o.status||'').toLowerCase().includes('canc') || (o.status||'').toLowerCase().includes('recus')).length;
  const currentTab = window.currentOsTabFilter || 'todas';

  let tecOpts = '<option value="">Todos os Técnicos</option><option value="__none__">(Sem técnico atribuído)</option>';
  (systemTecnicos || []).filter(t => t.active !== false).forEach(t => {
    tecOpts += '<option value="' + escapeOsHtml(t.name.toLowerCase()) + '">👷 ' + escapeOsHtml(t.name) + '</option>';
  });

  let h = '<div id="ordensPage">';
  
  h += '<div class="page-head" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; margin-bottom:22px;">';
  h += '<div>';
  h += '<h1 style="font-size:23px; font-weight:900; letter-spacing:-0.02em; margin:0; display:flex; align-items:center; gap:10px; color:var(--text);">';
  h += '<span style="display:inline-flex; align-items:center; justify-content:center; width:36px; height:36px; border-radius:12px; background:linear-gradient(135deg, rgba(59,130,246,0.25), rgba(37,99,235,0.12)); border:1px solid rgba(96,165,250,0.35);">📋</span>';
  h += 'Central de Ordens de Serviço & Suporte Técnico</h1>';
  h += '<p style="font-size:13.5px; color:var(--text-dim); margin:5px 0 0 0; font-weight:500;">Recepção, triagem, despacho técnico e sincronização direta no Microsoft SQL Server.</p>';
  h += '</div>';

  h += '<div class="head-actions" style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">';
  h += '<button onclick="openSuporteNovaOrdemModal()" style="display:inline-flex; align-items:center; gap:8px; height:42px; padding:0 18px; border-radius:14px; background:linear-gradient(135deg, #10B981, #059669); color:#ffffff; font-size:13px; font-weight:800; border:none; cursor:pointer; box-shadow:0 8px 24px -4px rgba(16,185,129,0.5); transition:all 0.25s ease;">';
  h += '<span>➕ Registrar O.S.</span></button>';
  
  h += '<button onclick="openGerenciarTecnicosModal()" style="display:inline-flex; align-items:center; gap:8px; height:42px; padding:0 18px; border-radius:14px; background:linear-gradient(135deg, rgba(245,158,11,0.22), rgba(217,119,6,0.12)); border:1.5px solid rgba(245,158,11,0.5); color:#FDE68A; font-size:13px; font-weight:800; cursor:pointer; box-shadow:0 8px 24px -4px rgba(245,158,11,0.25);">';
  h += '<span>👷 Técnicos & Especialistas</span>';
  h += '<span id="tecnicosBadgeCount" style="padding:2px 7px; border-radius:999px; background:#F59E0B; color:#060B18; font-size:11px; font-weight:900;">' + ((systemTecnicos || []).filter(t => t.active !== false).length) + '</span>';
  h += '</button>';

  h += '<button onclick="imprimirFilaOrdens()" style="display:inline-flex; align-items:center; gap:6px; height:42px; padding:0 16px; border-radius:14px; background:rgba(56,189,248,0.12); border:1.5px solid rgba(56,189,248,0.35); color:#38BDF8; font-size:13px; font-weight:800; cursor:pointer;" title="Imprimir Relatório da Fila de O.S.">';
  h += '<span>🖨️ Imprimir Fila O.S.</span></button>';

  h += '<button class="btn-ghost" onclick="syncOrdensWithServer().then(() => syncTecnicosWithServer()).then(render)" style="display:inline-flex; align-items:center; gap:6px; font-weight:700; height:42px; border-radius:14px;">🔄 Sincronizar Banco SQL</button>';
  h += '</div></div>';

  h += '<div class="kpis" style="grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:16px; margin-bottom:22px;">';
  
  h += '<div class="kpi" style="position:relative; overflow:hidden; padding:20px 22px; border-radius:20px; background:linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(15,23,42,0.68) 50%, rgba(10,15,29,0.80) 100%); backdrop-filter:blur(24px); -webkit-backdrop-filter:blur(24px); border:1px solid rgba(255,255,255,0.13); box-shadow:0 16px 40px -10px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.22); cursor:pointer;" onclick="setOsStatusTab('todas')">';
  h += '<div class="row1" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">';
  h += '<span style="font-size:13px; font-weight:700; color:var(--text-dim); letter-spacing:0.02em;">Total de Chamados</span>';
  h += '<div style="width:38px; height:38px; border-radius:50%; background:linear-gradient(135deg, rgba(59,130,246,0.25), rgba(37,99,235,0.15)); border:1.5px solid rgba(96,165,250,0.4); display:flex; align-items:center; justify-content:center; font-size:16px;">📋</div>';
  h += '</div>';
  h += '<div class="val" style="font-size:28px; font-weight:900; color:var(--text); margin-bottom:2px;">' + countTotal + '</div>';
  h += '<div class="sub" style="font-size:12px; color:#60A5FA; font-weight:600; margin-top:4px;">Todas as solicitações</div>';
  h += '</div>';

  h += '<div class="kpi" style="position:relative; overflow:hidden; padding:20px 22px; border-radius:20px; background:linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(15,23,42,0.68) 50%, rgba(10,15,29,0.80) 100%); backdrop-filter:blur(24px); -webkit-backdrop-filter:blur(24px); border:1px solid ' + (countPendentes > 0 ? 'rgba(245,158,11,0.5)' : 'rgba(255,255,255,0.13)') + '; box-shadow:0 16px 40px -10px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.22); cursor:pointer;" onclick="setOsStatusTab('pendente')">';
  h += '<div class="row1" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">';
  h += '<span style="font-size:13px; font-weight:700; color:#94A3B8; letter-spacing:0.02em;">Pendentes</span>';
  h += '<div style="width:38px; height:38px; border-radius:50%; background:linear-gradient(135deg, rgba(245,158,11,0.25), rgba(217,119,6,0.15)); border:1.5px solid rgba(251,191,36,0.4); display:flex; align-items:center; justify-content:center; font-size:16px;">⏳</div>';
  h += '</div>';
  h += '<div class="val" style="font-size:28px; font-weight:900; color:#FBBF24; margin-bottom:2px;">' + countPendentes + '</div>';
  h += '<div class="sub" style="font-size:12px; color:#FDE68A; font-weight:600; margin-top:4px;">Aguardando atendimento</div>';
  h += '</div>';

  h += '<div class="kpi" style="position:relative; overflow:hidden; padding:20px 22px; border-radius:20px; background:linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(15,23,42,0.68) 50%, rgba(10,15,29,0.80) 100%); backdrop-filter:blur(24px); -webkit-backdrop-filter:blur(24px); border:1px solid rgba(255,255,255,0.13); box-shadow:0 16px 40px -10px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.22); cursor:pointer;" onclick="setOsStatusTab('andamento')">';
  h += '<div class="row1" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">';
  h += '<span style="font-size:13px; font-weight:700; color:#94A3B8; letter-spacing:0.02em;">Em Andamento</span>';
  h += '<div style="width:38px; height:38px; border-radius:50%; background:linear-gradient(135deg, rgba(59,130,246,0.25), rgba(37,99,235,0.15)); border:1.5px solid rgba(96,165,250,0.4); display:flex; align-items:center; justify-content:center; font-size:16px;">⚙️</div>';
  h += '</div>';
  h += '<div class="val" style="font-size:28px; font-weight:900; color:#60A5FA; margin-bottom:2px;">' + countAndamento + '</div>';
  h += '<div class="sub" style="font-size:12px; color:#BFDBFE; font-weight:600; margin-top:4px;">Sendo atendidos</div>';
  h += '</div>';

  h += '<div class="kpi" style="position:relative; overflow:hidden; padding:20px 22px; border-radius:20px; background:linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(15,23,42,0.68) 50%, rgba(10,15,29,0.80) 100%); backdrop-filter:blur(24px); -webkit-backdrop-filter:blur(24px); border:1px solid rgba(255,255,255,0.13); box-shadow:0 16px 40px -10px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.22); cursor:pointer;" onclick="setOsStatusTab('concluido')">';
  h += '<div class="row1" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">';
  h += '<span style="font-size:13px; font-weight:700; color:#94A3B8; letter-spacing:0.02em;">Concluídos</span>';
  h += '<div style="width:38px; height:38px; border-radius:50%; background:linear-gradient(135deg, rgba(16,185,129,0.25), rgba(5,150,105,0.15)); border:1.5px solid rgba(52,211,153,0.4); display:flex; align-items:center; justify-content:center; font-size:16px;">✅</div>';
  h += '</div>';
  h += '<div class="val" style="font-size:28px; font-weight:900; color:#10B981; margin-bottom:2px;">' + countConcluidas + '</div>';
  h += '<div class="sub" style="font-size:12px; color:#A7F3D0; font-weight:600; margin-top:4px;">Finalizados com sucesso</div>';
  h += '</div>';

  h += '</div>';

  h += '<div class="table-panel" style="background:var(--card); border:1px solid var(--card-border); border-radius:20px; padding:22px; box-shadow:0 20px 50px rgba(0,0,0,0.5);">';
  
  h += '<div class="panel-head" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:10px;">';
  h += '<h3 style="font-size:16px; font-weight:800; margin:0;">Fila de Solicitações</h3>';
  h += '<span class="tag" style="font-weight:700;">' + countTotal + ' O.S. registradas no banco</span>';
  h += '</div>';

  h += '<div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:18px;">';
  h += '<button type="button" class="os-status-tab-btn ' + (currentTab==='todas'?'active':'') + '" data-tab="todas" onclick="setOsStatusTab('todas')" style="padding:8px 16px; border-radius:12px; font-size:12.5px; font-weight:800; cursor:pointer; border:1px solid var(--card-border); background:' + (currentTab==='todas'?'linear-gradient(135deg, #3B82F6, #1D4ED8)':'rgba(255,255,255,0.05)') + '; color:' + (currentTab==='todas'?'#FFFFFF':'var(--text)') + ';">Todas (' + countTotal + ')</button>';
  h += '<button type="button" class="os-status-tab-btn ' + (currentTab==='pendente'?'active':'') + '" data-tab="pendente" onclick="setOsStatusTab('pendente')" style="padding:8px 16px; border-radius:12px; font-size:12.5px; font-weight:800; cursor:pointer; border:1px solid rgba(245,158,11,0.4); background:' + (currentTab==='pendente'?'linear-gradient(135deg, #F59E0B, #D97706)':'rgba(245,158,11,0.12)') + '; color:' + (currentTab==='pendente'?'#060B18':'#FBBF24') + ';">⏳ Pendentes (' + countPendentes + ')</button>';
  h += '<button type="button" class="os-status-tab-btn ' + (currentTab==='andamento'?'active':'') + '" data-tab="andamento" onclick="setOsStatusTab('andamento')" style="padding:8px 16px; border-radius:12px; font-size:12.5px; font-weight:800; cursor:pointer; border:1px solid rgba(59,130,246,0.4); background:' + (currentTab==='andamento'?'linear-gradient(135deg, #3B82F6, #1D4ED8)':'rgba(59,130,246,0.12)') + '; color:' + (currentTab==='andamento'?'#FFFFFF':'#60A5FA') + ';">⚙️ Em Atendimento (' + countAndamento + ')</button>';
  h += '<button type="button" class="os-status-tab-btn ' + (currentTab==='concluido'?'active':'') + '" data-tab="concluido" onclick="setOsStatusTab('concluido')" style="padding:8px 16px; border-radius:12px; font-size:12.5px; font-weight:800; cursor:pointer; border:1px solid rgba(16,185,129,0.4); background:' + (currentTab==='concluido'?'linear-gradient(135deg, #10B981, #059669)':'rgba(16,185,129,0.12)') + '; color:' + (currentTab==='concluido'?'#FFFFFF':'#34D399') + ';">✅ Concluídas (' + countConcluidas + ')</button>';
  h += '<button type="button" class="os-status-tab-btn ' + (currentTab==='cancelado'?'active':'') + '" data-tab="cancelado" onclick="setOsStatusTab('cancelado')" style="padding:8px 16px; border-radius:12px; font-size:12.5px; font-weight:800; cursor:pointer; border:1px solid rgba(239,68,68,0.4); background:' + (currentTab==='cancelado'?'linear-gradient(135deg, #EF4444, #B91C1C)':'rgba(239,68,68,0.12)') + '; color:' + (currentTab==='cancelado'?'#FFFFFF':'#F87171') + ';">❌ Canceladas (' + countCanceladas + ')</button>';
  h += '</div>';

  h += '<div class="filters" style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:18px; align-items:center;">';
  h += '<div style="position:relative; flex:1.6; min-width:220px;">';
  h += '<input id="osSearchInput" placeholder="🔍 Buscar por protocolo, solicitante, e-mail, telefone, CPF ou assunto..." onkeyup="filterOrdensTable()" style="width:100%; font-size:13px; padding:10px 14px; border-radius:12px; background:var(--input-bg); border:1px solid var(--card-border); color:var(--text);">';
  h += '</div>';
  
  h += '<select id="osFilterStatus" onchange="filterOrdensTable()" style="flex:1; min-width:130px; padding:10px 12px; border-radius:12px; background:var(--input-bg); border:1px solid var(--card-border); color:var(--text); font-size:12.5px; font-weight:700;">';
  h += '<option value="">Status: Todos</option><option value="pendente">⏳ Pendentes</option><option value="andamento">⚙️ Em Andamento</option><option value="concl">✅ Concluídos</option><option value="canc">❌ Cancelados</option>';
  h += '</select>';

  h += '<select id="osFilterTecnico" onchange="filterOrdensTable()" style="flex:1.2; min-width:150px; padding:10px 12px; border-radius:12px; background:var(--input-bg); border:1px solid var(--card-border); color:var(--text); font-size:12.5px; font-weight:700;">';
  h += tecOpts;
  h += '</select>';

  h += '<select id="osFilterType" onchange="filterOrdensTable()" style="flex:1.1; min-width:140px; padding:10px 12px; border-radius:12px; background:var(--input-bg); border:1px solid var(--card-border); color:var(--text); font-size:12.5px; font-weight:700;">';
  h += '<option value="">Tipo: Todos</option><option value="melhoria">Melhoria</option><option value="senha">Reset de Senha</option><option value="correção">Correção</option><option value="bug">Relato de Bug</option><option value="geral">Atendimento</option>';
  h += '</select>';

  h += '<select id="osFilterPriority" onchange="filterOrdensTable()" style="flex:1; min-width:120px; padding:10px 12px; border-radius:12px; background:var(--input-bg); border:1px solid var(--card-border); color:var(--text); font-size:12.5px; font-weight:700;">';
  h += '<option value="">Prioridade: Todas</option><option value="normal">🟢 Normal</option><option value="alta">🟡 Alta</option><option value="urgente">🔴 Urgente</option>';
  h += '</select>';
  h += '</div>';

  window.currentFilteredOrdens = ordens;
  h += '<div id="osTableWrap">';
  h += renderOrdensTable(ordens);
  h += '</div>';

  h += '</div>';
  h += '</div>';
  return h;
}


window.openOrdemAdminModal = function(id) {
  const ordem = (systemOrdens || []).find(o => String(o.id) === String(id));
  if (!ordem) return;

  const overlay = document.getElementById('overlayOrdemAdmin');
  if (!overlay) return;

  document.getElementById('osAdminCurrentId').value = ordem.id;
  document.getElementById('osAdminProtocolBadge').textContent = '#' + (ordem.protocol || ordem.id);
  document.getElementById('osAdminTitle').textContent = ordem.title || 'Solicitação sem assunto';
  document.getElementById('osAdminDate').textContent = 'Aberta em: ' + (ordem.created_at ? new Date(ordem.created_at).toLocaleString('pt-BR') : 'Data não informada');
  document.getElementById('osAdminClientName').textContent = ordem.client_name || 'Não informado';
  
  const emailEl = document.getElementById('osAdminClientEmail');
  if (emailEl) {
    emailEl.textContent = ordem.client_email || 'Não informado';
    emailEl.href = ordem.client_email ? ('mailto:' + ordem.client_email) : '#';
  }

  const phoneEl = document.getElementById('osAdminClientPhone');
  const cleanPhone = String(ordem.client_phone || '').replace(/D/g, '');
  if (phoneEl) {
    phoneEl.textContent = ordem.client_phone || 'Não informado';
  }

  const cpfEl = document.getElementById('osAdminClientCpf');
  if (cpfEl) {
    cpfEl.textContent = ordem.client_cpf || 'Não informado';
  }

  const canalEl = document.getElementById('osAdminCanal');
  if (canalEl) {
    canalEl.textContent = ordem.canal_atendimento || 'Portal Web';
  }

  const waBtn = document.getElementById('osAdminWhatsappBtn');
  if (waBtn) {
    if (cleanPhone) {
      const msg = encodeURIComponent('Olá ' + (ordem.client_name || '') + ', tudo bem? Aqui é do Suporte do Nexus sobre a sua Ordem de Serviço #' + (ordem.protocol || ordem.id) + ' (' + (ordem.title || '') + ').');
      waBtn.href = 'https://wa.me/55' + cleanPhone + '?text=' + msg;
      waBtn.style.display = 'inline-flex';
    } else {
      waBtn.style.display = 'none';
    }
  }

  const emailBtn = document.getElementById('osAdminEmailBtn');
  if (emailBtn) {
    if (ordem.client_email) {
      const subj = encodeURIComponent('[Suporte] O.S. #' + (ordem.protocol || ordem.id) + ' - ' + (ordem.title || ''));
      emailBtn.href = 'mailto:' + ordem.client_email + '?subject=' + subj;
      emailBtn.style.display = 'inline-flex';
    } else {
      emailBtn.style.display = 'none';
    }
  }

  const serviceTypeSel = document.getElementById('osAdminServiceTypeSelect');
  if (serviceTypeSel) serviceTypeSel.value = ordem.service_type || 'Melhoria no Sistema';
  document.getElementById('osAdminDescription').textContent = ordem.description || 'Sem descrição detalhada.';

  // Popula e configura o Seletor de Técnico Responsável
  const tecnicoSel = document.getElementById('osAdminTecnicoSelect');
  if (tecnicoSel) {
    let opts = '<option value="">(Nenhum técnico atribuído)</option>';
    (systemTecnicos || []).forEach(t => {
      const isSel = (ordem.tecnico_responsavel && (ordem.tecnico_responsavel === t.name || ordem.tecnico_responsavel.toLowerCase() === t.name.toLowerCase()));
      opts += `<option value="${escapeOsHtml(t.name)}" ${isSel ? 'selected' : ''}>${escapeOsHtml(t.name)} (${escapeOsHtml(t.specialty || 'Suporte')})${t.active === false ? ' [Inativo]' : ''}</option>`;
    });
    if (ordem.tecnico_responsavel && !systemTecnicos.some(t => t.name === ordem.tecnico_responsavel)) {
      opts += `<option value="${escapeOsHtml(ordem.tecnico_responsavel)}" selected>${escapeOsHtml(ordem.tecnico_responsavel)} (Técnico)</option>`;
    }
    tecnicoSel.innerHTML = opts;
  }

  // Banner do Técnico que assumiu a O.S.
  const banner = document.getElementById('osAdminAssumidoBanner');
  const nomeEl = document.getElementById('osAdminAssumidoNome');
  const dataEl = document.getElementById('osAdminAssumidoData');
  if (banner && nomeEl) {
    if (ordem.tecnico_responsavel) {
      nomeEl.textContent = ordem.tecnico_responsavel;
      if (dataEl) dataEl.textContent = ordem.assumido_em ? ('Assumido em: ' + new Date(ordem.assumido_em).toLocaleString('pt-BR')) : '';
      banner.style.display = 'flex';
    } else {
      banner.style.display = 'none';
    }
  }
  
  const statusSel = document.getElementById('osAdminStatusSelect');
  if (statusSel) statusSel.value = ordem.status || 'Pendente';

  const notesEl = document.getElementById('osAdminNotes');
  if (notesEl) notesEl.value = ordem.admin_notes || '';

  const prioSelect = document.getElementById('osAdminPrioritySelect');
  if (prioSelect) {
    prioSelect.value = ordem.priority || 'Normal';
    atualizarEstiloPrioridadeAdmin(prioSelect.value);
  }

  overlay.classList.add('show');
  overlay.style.display = 'flex';
};

window.atualizarEstiloPrioridadeAdmin = function(val) {
  const prioSelect = document.getElementById('osAdminPrioritySelect');
  if (!prioSelect) return;
  const p = (val || '').toLowerCase();
  if (p.includes('urg')) {
    prioSelect.style.borderColor = 'rgba(239,68,68,0.7)';
    prioSelect.style.color = '#F87171';
    prioSelect.style.background = 'rgba(239,68,68,0.14)';
  } else if (p.includes('alt')) {
    prioSelect.style.borderColor = 'rgba(245,158,11,0.7)';
    prioSelect.style.color = '#FBBF24';
    prioSelect.style.background = 'rgba(245,158,11,0.14)';
  } else {
    prioSelect.style.borderColor = 'rgba(16,185,129,0.7)';
    prioSelect.style.color = '#34D399';
    prioSelect.style.background = 'rgba(16,185,129,0.14)';
  }
};

window.closeOrdemAdminModal = function() {
  const overlay = document.getElementById('overlayOrdemAdmin');
  if (!overlay) return;
  overlay.classList.remove('show');
  setTimeout(() => overlay.style.display = 'none', 200);
};

window.assumirOrdemDiretoNoModal = function() {
  const tecnicoSel = document.getElementById('osAdminTecnicoSelect');
  const statusSel = document.getElementById('osAdminStatusSelect');
  const banner = document.getElementById('osAdminAssumidoBanner');
  const nomeEl = document.getElementById('osAdminAssumidoNome');
  const dataEl = document.getElementById('osAdminAssumidoData');

  let defaultName = (currentUser && currentUser.name) ? currentUser.name : 'Administrador Suporte';
  if (tecnicoSel) {
    let found = false;
    for (let opt of tecnicoSel.options) {
      if (opt.value && opt.value.toLowerCase() === defaultName.toLowerCase()) {
        opt.selected = true;
        found = true;
        break;
      }
    }
    if (!found) {
      if (tecnicoSel.options.length > 1) {
        tecnicoSel.options[1].selected = true;
        defaultName = tecnicoSel.options[1].value;
      } else {
        const newOpt = document.createElement('option');
        newOpt.value = defaultName;
        newOpt.textContent = defaultName + ' (Técnico)';
        newOpt.selected = true;
        tecnicoSel.appendChild(newOpt);
      }
    }
  }

  if (statusSel && statusSel.value === 'Pendente') {
    statusSel.value = 'Em Andamento';
  }

  if (banner && nomeEl) {
    nomeEl.textContent = defaultName;
    if (dataEl) dataEl.textContent = 'Assumido agora';
    banner.style.display = 'flex';
  }

  showToast('Chamado atribuído a ' + defaultName + '! Clique em "Salvar Atendimento" para confirmar.');
};

window.quickAssumirOrdemPrompt = async function(id) {
  const ordem = (systemOrdens || []).find(o => String(o.id) === String(id));
  if (!ordem) return;

  let tecnicoNome = (currentUser && currentUser.name) ? currentUser.name : 'Administrador Suporte';
  if (Array.isArray(systemTecnicos) && systemTecnicos.length > 0) {
    const match = systemTecnicos.find(t => t.active !== false && currentUser && t.email.toLowerCase() === currentUser.email.toLowerCase());
    if (match) {
      tecnicoNome = match.name;
    } else {
      const activeOne = systemTecnicos.find(t => t.active !== false);
      if (activeOne) tecnicoNome = activeOne.name;
    }
  }

  try {
    const res = await fetch(window.location.origin + '/api/ordens/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: id,
        status: 'Em Andamento',
        tecnico_responsavel: tecnicoNome
      })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('O.S. #' + (ordem.protocol || ordem.id) + ' assumida por ' + tecnicoNome + '!');
      await syncOrdensWithServer();
      render();
    } else {
      showToast(data.message || 'Erro ao assumir chamado.');
    }
  } catch(e) {
    showToast('Falha na comunicação com o servidor.');
  }
};

window.quickConcluirOrdem = async function(id) {
  const ordem = (systemOrdens || []).find(o => String(o.id) === String(id));
  if (!ordem) return;

  try {
    const res = await fetch(window.location.origin + '/api/ordens/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: id,
        status: 'Concluído'
      })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('O.S. #' + (ordem.protocol || ordem.id) + ' concluída com sucesso no SQL Server!');
      await syncOrdensWithServer();
      render();
    } else {
      showToast(data.message || 'Erro ao concluir chamado.');
    }
  } catch(e) {
    showToast('Falha na comunicação com o servidor.');
  }
};

window.imprimirFichaOrdem = function(id) {
  const o = (systemOrdens || []).find(x => String(x.id) === String(id));
  if (!o) {
    showToast('Ordem de Serviço não encontrada.');
    return;
  }

  const printWin = window.open('', '_blank', 'width=850,height=900');
  if (!printWin) {
    showToast('Permita popups para imprimir o comprovante da O.S.');
    return;
  }

  const dtCriacao = o.created_at ? new Date(o.created_at).toLocaleString('pt-BR') : 'Hoje';
  const dtAssumido = o.assumido_em ? new Date(o.assumido_em).toLocaleString('pt-BR') : 'Aguardando atendimento';
  const dtConcluido = o.concluido_em ? new Date(o.concluido_em).toLocaleString('pt-BR') : (o.status === 'Concluído' ? 'Finalizado' : 'Em andamento');

  let doc = '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Comprovante O.S. #' + (o.protocol || o.id) + '</title>';
  doc += '<style>';
  doc += 'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; padding: 24px; color: #0F172A; background: #FFFFFF; font-size: 13px; margin: 0; }';
  doc += '.header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0F172A; padding-bottom: 14px; margin-bottom: 20px; }';
  doc += '.logo { font-size: 20px; font-weight: 900; letter-spacing: -0.02em; }';
  doc += '.proto-badge { font-size: 16px; font-weight: 900; font-family: monospace; background: #F1F5F9; border: 1.5px solid #0F172A; padding: 6px 14px; border-radius: 8px; }';
  doc += '.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 16px; }';
  doc += '.card { border: 1px solid #CBD5E1; border-radius: 10px; padding: 12px 14px; background: #F8FAFC; }';
  doc += '.card-title { font-size: 11px; font-weight: 800; text-transform: uppercase; color: #475569; margin-bottom: 8px; border-bottom: 1px solid #E2E8F0; padding-bottom: 4px; }';
  doc += '.card-row { font-size: 12.5px; margin-bottom: 5px; }';
  doc += '.desc-box { border: 1px solid #CBD5E1; border-radius: 10px; padding: 12px 14px; margin-bottom: 16px; background: #FFFFFF; }';
  doc += '.desc-box h4 { margin: 0 0 6px 0; font-size: 12.5px; text-transform: uppercase; color: #0F172A; }';
  doc += '.desc-box p { margin: 0; font-size: 12.5px; line-height: 1.5; white-space: pre-wrap; color: #1E293B; }';
  doc += '.parecer-box { border: 1.5px solid #0284C7; border-radius: 10px; padding: 12px 14px; margin-bottom: 20px; background: #F0F9FF; }';
  doc += '.parecer-box h4 { margin: 0 0 5px 0; font-size: 12px; text-transform: uppercase; color: #0369A1; }';
  doc += '.parecer-box p { margin: 0; font-size: 12.5px; line-height: 1.45; color: #0C4A6E; }';
  doc += '.signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 40px; text-align: center; }';
  doc += '.sign-line { border-top: 1px solid #0F172A; padding-top: 6px; font-size: 11.5px; font-weight: 700; color: #0F172A; }';
  doc += '.footer { margin-top: 24px; border-top: 1px dashed #CBD5E1; padding-top: 10px; font-size: 10.5px; color: #64748B; display: flex; justify-content: space-between; }';
  doc += '@media print { .no-print { display: none !important; } }';
  doc += '</style></head><body>';
  
  doc += '<div class="no-print" style="margin-bottom: 16px; text-align: right;">';
  doc += '<button onclick="window.print()" style="padding: 8px 18px; font-size: 12.5px; font-weight: 800; background: #0284C7; color: #FFFFFF; border: none; border-radius: 8px; cursor: pointer;">🖨️ Imprimir Documento</button>';
  doc += '</div>';

  doc += '<div class="header"><div><div class="logo">NEXUS <span style="color:#0284C7;">FINANCEIRO</span> HUB</div>';
  doc += '<div style="font-size: 12px; color: #475569; margin-top: 3px;">Comprovante Oficial de Ordem de Serviço (O.S.) & Suporte Técnico</div></div>';
  doc += '<div class="proto-badge">#' + escapeOsHtml(o.protocol || o.id) + '</div></div>';

  doc += '<div class="grid">';
  doc += '<div class="card"><div class="card-title">Dados do Solicitante / Cliente</div>';
  doc += '<div class="card-row"><strong>Nome:</strong> ' + escapeOsHtml(o.client_name || 'Não informado') + '</div>';
  doc += '<div class="card-row"><strong>E-mail:</strong> ' + escapeOsHtml(o.client_email || 'Não informado') + '</div>';
  doc += '<div class="card-row"><strong>Telefone / Celular:</strong> ' + escapeOsHtml(o.client_phone || 'Não informado') + '</div>';
  doc += '<div class="card-row"><strong>CPF:</strong> ' + escapeOsHtml(o.client_cpf || 'Não informado') + '</div>';
  doc += '</div>';

  doc += '<div class="card"><div class="card-title">Classificação do Chamado</div>';
  doc += '<div class="card-row"><strong>Status Atual:</strong> ' + escapeOsHtml(o.status || 'Pendente') + '</div>';
  doc += '<div class="card-row"><strong>Tipo de Demanda:</strong> ' + escapeOsHtml(o.service_type || 'Melhoria no Sistema') + '</div>';
  doc += '<div class="card-row"><strong>Prioridade:</strong> ' + escapeOsHtml(o.priority || 'Normal') + '</div>';
  doc += '<div class="card-row"><strong>Canal de Entrada:</strong> ' + escapeOsHtml(o.canal_atendimento || 'Portal Web') + '</div>';
  doc += '</div></div>';

  doc += '<div class="grid">';
  doc += '<div class="card"><div class="card-title">Atendimento Técnico</div>';
  doc += '<div class="card-row"><strong>Técnico Responsável:</strong> ' + escapeOsHtml(o.tecnico_responsavel || 'Aguardando atribuição') + '</div>';
  doc += '<div class="card-row"><strong>Assumido em:</strong> ' + dtAssumido + '</div>';
  doc += '</div>';

  doc += '<div class="card"><div class="card-title">Prazos & Registro</div>';
  doc += '<div class="card-row"><strong>Data de Abertura:</strong> ' + dtCriacao + '</div>';
  doc += '<div class="card-row"><strong>Data de Conclusão:</strong> ' + dtConcluido + '</div>';
  doc += '</div></div>';

  doc += '<div class="desc-box"><h4>Assunto: ' + escapeOsHtml(o.title || 'Solicitação de Atendimento') + '</h4>';
  doc += '<p>' + escapeOsHtml(o.description || 'Sem descrição informada.') + '</p></div>';

  if (o.admin_notes) {
    doc += '<div class="parecer-box"><h4>Parecer Técnico & Resolução</h4>';
    doc += '<p>' + escapeOsHtml(o.admin_notes) + '</p></div>';
  }

  doc += '<div class="signatures">';
  doc += '<div><div class="sign-line">Assinatura do Solicitante / Cliente</div></div>';
  doc += '<div><div class="sign-line">Assinatura do Técnico Responsável (Nexus)</div></div>';
  doc += '</div>';

  doc += '<div class="footer">';
  doc += '<span>Gravado e sincronizado no Microsoft SQL Server interno (Homologação SF)</span>';
  doc += '<span>Impresso em: ' + new Date().toLocaleString('pt-BR') + '</span>';
  doc += '</div>';

  doc += '<script>window.onload = function() { setTimeout(function() { window.print(); }, 350); };