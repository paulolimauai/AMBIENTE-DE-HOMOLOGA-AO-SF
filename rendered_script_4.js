
  (function(){
    try {
      var savedTheme = localStorage.getItem('nexus_theme');
      if (savedTheme) savedTheme = savedTheme.replace(/"/g, '').trim();
      var isLight = (savedTheme === 'light');
      var miniBtn = document.getElementById('miniThemeBtn');
      if (miniBtn) {
        miniBtn.innerHTML = isLight ?
          '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M22 12h-2"/><path d="m4.93 19.07 1.41-1.41"/><path d="m17.66 6.34 1.41-1.41"/></svg>' :
          '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 0 1 1-9-9Z"/><path d="M19 3v4M21 5h-4" stroke-width="1.8"/></svg>';
      }
      var savedScale = localStorage.getItem('nexus_display_scale') || 'auto';
      var scaleLabel = document.getElementById('currentScaleLabel');
      if (scaleLabel) {
        scaleLabel.textContent = (savedScale === 'auto') ? 'Auto' : savedScale;
      }

      var cu = localStorage.getItem('nexus_cached_user');
      if (cu) {
        var u = JSON.parse(cu);
        if (u && u.name) {
          var n = document.getElementById('headerName');
          var r = document.getElementById('headerRole');
          var a = document.getElementById('headerAvatar');
          if (n) n.textContent = u.name;
          if (r) r.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span>' + (u.role || 'Usuário') + '</span>';
          if (a) {
            var p = u.name.trim().split(/s+/);
            a.textContent = (p.length >= 2 ? (p[0][0] + p[1][0]) : p[0].slice(0,2)).toUpperCase();
          }
        }
      }
      setTimeout(function(){
        document.documentElement.classList.add('app-ready');
      }, 50);
    } catch(e){}
  })();
  