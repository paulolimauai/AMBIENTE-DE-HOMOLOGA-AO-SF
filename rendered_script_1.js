
(function() {
  try {
    var t = localStorage.getItem('nexus_theme');
    if (t) t = t.replace(/"/g, '').trim();
    var isLight = (t === 'light');
    if (isLight) {
      document.documentElement.classList.add('light');
    }
    var cu = localStorage.getItem('nexus_cached_user');
    var s = localStorage.getItem('nexus_session');
    var loggedIn = !!(s || cu);
    if (loggedIn) {
      document.documentElement.classList.add('user-logged-in');
      var uObj = cu ? JSON.parse(cu) : null;
      if (uObj && uObj.role === 'Administrador') {
        document.documentElement.classList.add('is-admin');
      }
    }
    var sc = localStorage.getItem('nexus_display_scale') || 'auto';
    var w = window.innerWidth || (document.documentElement ? document.documentElement.clientWidth : 0) || screen.width || 1366;
    var h = window.innerHeight || (document.documentElement ? document.documentElement.clientHeight : 0) || screen.height || 768;
    var dev = 'desktop';
    var ua = navigator.userAgent || '';
    var isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    var isIpad = /iPad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isIpad || (/Tablet|Android/i.test(ua) && !/Mobile/i.test(ua)) || (isTouch && w > 640 && w <= 1024)) dev = 'tablet';
    else if (/Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua) || (w <= 768 && isTouch) || w <= 640) dev = 'mobile';
    else if (w >= 2560) dev = '4k';
    else if (w >= 1921) dev = 'ultrawide';
    else if (w <= 1440) dev = 'laptop';

    document.documentElement.setAttribute('data-device-type', dev);

    var sn = 1.0;
    if (sc === 'auto') {
      if (dev === 'mobile' || dev === 'tablet') sn = 1.0;
      else if (dev === 'laptop') sn = (h < 640 || w < 1180) ? 0.95 : 1.0;
      else if (dev === '4k') sn = (w >= 3400) ? 1.20 : 1.10;
      else if (dev === 'ultrawide') sn = 1.05;
      else sn = 1.0;
    } else {
      sn = parseFloat(sc) / 100 || 1.0;
    }
    document.documentElement.style.setProperty('--app-zoom', sn);
    var bgCol = isLight ? '#F2F7F4' : '#060913';
    document.write('<style id="critical-fouc-shield">background-color:' + bgCol + ' !important; background:' + bgCol + ' !important; transition:none !important;' + (loggedIn ? 'html #authPage{display:none !important;}html #appMain{display:flex !important;}' : 'html #appMain{display:none !important;}html #authPage{display:flex !important;}') + '</style>');
    var isMobileOrTablet = (dev === 'mobile' || dev === 'tablet' || sn === 1.0);
    var zoomRule = isMobileOrTablet ? 'html, body { zoom: normal !important; -webkit-overflow-scrolling: touch; }' : ('html, body { zoom: ' + sn + ' !important; }');
    document.write('<style id="nexus-scale-override">' + zoomRule + ' :root { --app-zoom: ' + sn + '; }</style>');
  } catch(e){}
})();
