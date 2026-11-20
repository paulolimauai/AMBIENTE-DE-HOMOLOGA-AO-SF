/* Liberação de assinatura e redefinição de senha — painel do administrador (/admin-assinaturas-glpi).
   Carregado depois do script principal do painel: substitui window.grant (liberar acesso) e cria window.resetPwd (senha).

   - Liberar: horas, dias ou "Para sempre". Atalhos (1 hora, 6 horas, 1 dia, 7 dias, 30 dias, 1 ano) ou um valor livre
     (minutos, horas ou dias). O servidor (/api/subscription/admin-grant-time) é quem decide: soma ao vencimento que ainda
     vale, aceita no máximo 10 anos e não rebaixa quem já é vitalício. A tela só mostra antes o que vai acontecer.
   - Redefinir senha: /api/admin/users/reset-password gera uma senha provisória, derruba as sessões da conta e (por padrão)
     exige que a pessoa crie uma nova no próximo login. A senha aparece UMA vez, só nesta janela: não vai para o cache do
     painel, para o histórico local nem para o log. */
(function (raiz, fabrica) {
  'use strict';
  var A = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = A;   // testes (node --test)
  if (raiz && raiz.document) A.montar(raiz);
})(typeof window !== 'undefined' ? window : null, function () {
  var MIN_ANO = 365 * 24 * 60;
  var MAX_MIN = 10 * MIN_ANO;   // mesmo teto do servidor

  var ATALHOS = [
    { id: '1h', rotulo: '1 hora', min: 60 },
    { id: '6h', rotulo: '6 horas', min: 6 * 60 },
    { id: '1d', rotulo: '1 dia', min: 1440 },
    { id: '7d', rotulo: '7 dias', min: 7 * 1440 },
    { id: '30d', rotulo: '30 dias', min: 30 * 1440 },
    { id: '1a', rotulo: '1 ano', min: MIN_ANO },
    { id: 'vit', rotulo: 'Para sempre', vitalicio: true }
  ];
  var UNIDADES = [
    { id: 'h', rotulo: 'horas', mult: 60 },
    { id: 'd', rotulo: 'dias', mult: 1440 },
    { id: 'm', rotulo: 'minutos', mult: 1 }
  ];
  var PADRAO = '1d';

  /* ---------- regras (puras: testadas em admin-liberacao.test.js) ---------- */

  // "3" + 60 -> 180 minutos; aceita vírgula ("1,5" horas = 90). null se não for um número maior que zero.
  function minutosDe(quantidade, multiplicador) {
    var n = Number(String(quantidade == null ? '' : quantidade).trim().replace(',', '.'));
    if (!isFinite(n) || n <= 0) return null;
    var m = Math.round(n * multiplicador);
    return m >= 1 ? m : null;
  }

  function erroDuracao(min) {
    if (min == null) return 'Informe uma quantidade maior que zero.';
    if (min > MAX_MIN) return 'O máximo é 10 anos. Para acesso sem prazo use "Para sempre".';
    return '';
  }

  // Mesma regra do servidor: soma ao vencimento atual se ele ainda não passou; senão conta a partir de agora.
  function vencimentoApos(vencimentoAtualIso, minutos, agoraMs) {
    var base = agoraMs;
    if (vencimentoAtualIso) {
      var t = new Date(vencimentoAtualIso).getTime();
      if (isFinite(t) && t > base) base = t;
    }
    return new Date(base + minutos * 60000);
  }

  // 90 -> "1 hora e 30 minutos"; 1560 -> "1 dia e 2 horas" (igual ao texto que o servidor devolve)
  function descreverDuracao(totalMinutos) {
    var resto = Math.max(0, Math.round(Number(totalMinutos) || 0));
    var dias = Math.floor(resto / 1440); resto -= dias * 1440;
    var horas = Math.floor(resto / 60); resto -= horas * 60;
    var partes = [];
    if (dias) partes.push(dias + (dias === 1 ? ' dia' : ' dias'));
    if (horas) partes.push(horas + (horas === 1 ? ' hora' : ' horas'));
    if (resto) partes.push(resto + (resto === 1 ? ' minuto' : ' minutos'));
    if (!partes.length) return '0 minuto';
    return partes.length === 1 ? partes[0] : partes.slice(0, -1).join(', ') + ' e ' + partes[partes.length - 1];
  }

  function dataHora(d) {
    return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
  }

  // 'admin' (acesso sempre liberado), 'vitalicio' (nada a somar) ou 'normal'
  function condicao(s) {
    if (!s) return 'normal';
    if (s.p === 'Administrador') return 'admin';
    if (s._plano === 'vitalicio' || s.val === 'Vitalício') return 'vitalicio';
    return 'normal';
  }

  // O que vai acontecer se o administrador confirmar agora: { ok, tom: 'ok'|'warn'|'bad', texto }
  function resumo(s, escolha, agoraMs) {
    var c = condicao(s);
    if (c === 'admin') return { ok: false, tom: 'warn', texto: 'Administradores já têm acesso sempre liberado.' };
    if (c === 'vitalicio') {
      return { ok: false, tom: 'warn', texto: escolha.vitalicio ? 'Esta conta já tem acesso vitalício.' : 'Esta conta já tem acesso vitalício: não há tempo a somar.' };
    }
    if (escolha.vitalicio) return { ok: true, tom: 'warn', texto: 'Acesso sem prazo: a conta nunca vence. Para encerrar depois, use Bloquear.' };
    var erro = erroDuracao(escolha.min);
    if (erro) return { ok: false, tom: 'bad', texto: erro };
    var atual = s && s._exp ? new Date(s._exp).getTime() : 0;
    var soma = isFinite(atual) && atual > agoraMs;
    var fim = dataHora(vencimentoApos(s && s._exp, escolha.min, agoraMs));
    return {
      ok: true, tom: 'ok',
      texto: (soma ? 'Soma ' + descreverDuracao(escolha.min) + ' ao prazo que ainda vale (até ' + dataHora(new Date(atual)) + ')' : descreverDuracao(escolha.min) + ' a partir de agora') + '. Passa a vencer em ' + fim + '.'
    };
  }

  function escapar(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- tela ---------- */

  var CSS = '' +
    '.lb-s{margin:0 0 14px}' +
    '.lb-l{display:block;font-size:var(--fs,14px);font-weight:600;color:var(--m);margin:0 0 6px;text-transform:uppercase;letter-spacing:.04em}' +
    '.lb-chips{display:flex;flex-wrap:wrap;gap:8px}' +
    '.lb-chip{min-height:38px;padding:0 14px;border-radius:99px;border:1px solid var(--b);background:transparent;color:var(--t);font:inherit;font-weight:600;font-size:var(--fs,14px);cursor:pointer;transition:background .15s,border-color .15s}' +
    '.lb-chip:hover{border-color:var(--a)}' +
    '.lb-chip[aria-pressed="true"]{background:color-mix(in srgb,var(--a) 22%,transparent);border-color:var(--a)}' +
    '.lb-chip.lb-vit[aria-pressed="true"]{background:color-mix(in srgb,var(--w) 24%,transparent);border-color:var(--w)}' +
    '.lb-custom{display:grid;grid-template-columns:1fr 1fr;gap:10px}' +
    '.lb-prev{padding:11px 13px;border-radius:12px;border:1px solid var(--b);font-size:var(--fs,14px);line-height:1.5}' +
    '.lb-prev.ok{border-color:color-mix(in srgb,var(--e) 45%,transparent);background:color-mix(in srgb,var(--e) 9%,transparent)}' +
    '.lb-prev.warn{border-color:color-mix(in srgb,var(--w) 50%,transparent);background:color-mix(in srgb,var(--w) 10%,transparent)}' +
    '.lb-prev.bad{border-color:color-mix(in srgb,var(--r) 50%,transparent);background:color-mix(in srgb,var(--r) 10%,transparent)}' +
    '.lb-erro{margin:0;color:var(--r);font-size:var(--fs,14px)}' +
    '.lb-pw{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:13px 15px;border-radius:12px;border:1px dashed var(--a);background:color-mix(in srgb,var(--a) 8%,transparent)}' +
    '.lb-pw code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:20px;font-weight:800;letter-spacing:.06em;user-select:all;word-break:break-all}' +
    '.lb-chk{display:flex;align-items:flex-start;gap:10px;text-transform:none;font-size:var(--fs,14px);color:var(--t);font-weight:500;letter-spacing:0;cursor:pointer}' +
    '.lb-chk input{margin-top:2px}';

  var ICONES = {
    key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3L21 2M17 6l3 3M14 9l2 2"/>',
    unlock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 017.5-1.5"/>',
    ok: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>'
  };
  // Mesmo selo de ícone dos diálogos do painel (.ask-h/.ask-ic): cabeçalho consistente em todos os modais
  function icone(n, tom) {
    return '<div class="ask-h"><span class="ask-ic ' + (tom || 'n') + '" aria-hidden="true"><svg class="i" viewBox="0 0 24 24">' + (ICONES[n] || '') + '</svg></span>';
  }
  function cabecalho(n, tom, titulo) {
    return icone(n, tom) + '<h3>' + titulo + '</h3></div>';
  }

  function montar(w) {
    var d = w.document;
    var por = function (id) { return d.getElementById(id); };
    var senhaNaTela = false;
    var soltarEsc = null;

    var estilo = d.createElement('style');
    estilo.textContent = CSS;
    d.head.appendChild(estilo);
    // o painel desenha os ícones por IC[nome]; a chave de "Redefinir senha" entra aqui
    try { if (typeof IC === 'object' && IC && !IC.key) IC.key = ICONES.key; } catch (e) {}

    function dados() { try { return typeof S !== 'undefined' ? S : null; } catch (e) { return null; } }
    function avisar(msg, cor) { if (typeof w.toast === 'function') w.toast(msg, cor); }
    function emailDoAdmin() {
      if (w.__nxAdminEmail) return w.__nxAdminEmail;
      var u = w.NexusSSO && w.NexusSSO.usuario && w.NexusSSO.usuario();
      return u && u.email ? u.email : '';
    }

    function chamar(caminho, corpo) {
      var token = w.NexusSSO ? w.NexusSSO.token() : '';
      return w.fetch(caminho, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(corpo)
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (r.status === 401 && w.NexusSSO) {   // sessão vencida: confirma (com nova tentativa) e volta ao login oficial
            w.NexusSSO.verificar().then(function (v) { if (v.estado === 'sem-sessao') w.NexusSSO.irParaLogin(); });
          }
          if (!r.ok || j.success === false) throw new Error(j.error || ('Erro ' + r.status));
          return j;
        });
      });
    }

    function recarregar() {
      return typeof w.__nxCarregarReais === 'function' ? w.__nxCarregarReais() : null;
    }

    /* ======== Liberar acesso ======== */
    function grant(id) {
      var s = dados();
      var lista = (s && s.subs) || [];
      if (!lista.length) { avisar('Os cadastros ainda não carregaram. Tente de novo em instantes.', 'var(--w)'); return; }
      var inicial = lista.find(function (x) { return x.id === id; }) || lista[0];
      var escolha = { id: PADRAO, min: 1440, vitalicio: false };

      var chips = ATALHOS.map(function (a) {
        return '<button type="button" class="lb-chip' + (a.vitalicio ? ' lb-vit' : '') + '" data-p="' + a.id + '" aria-pressed="' + (a.id === PADRAO) + '">' + escapar(a.rotulo) + '</button>';
      }).join('');
      var unidades = UNIDADES.map(function (u) { return '<option value="' + u.id + '">' + u.rotulo + '</option>'; }).join('');
      var quem = lista.map(function (x) {
        return '<option value="' + x.id + '"' + (x.id === inicial.id ? ' selected' : '') + '>' + escapar(x.n) + ' — ' + escapar(x.e) + '</option>';
      }).join('');

      w.modal(
        cabecalho('unlock', 's', 'Liberar acesso') +
        '<p class="sub lb-s">Concede tempo direto na conta. Se ainda houver prazo, o novo tempo soma ao vencimento. Vale no Nexus e no GLPI.</p>' +
        '<form id="lbF" class="col" novalidate>' +
          '<div><label for="lbQuem">Assinante</label><select id="lbQuem">' + quem + '</select></div>' +
          '<div><span class="lb-l" id="lbTempo">Por quanto tempo</span><div class="lb-chips" role="group" aria-labelledby="lbTempo">' + chips + '</div></div>' +
          '<div class="lb-custom"><div><label for="lbQtd">Ou informe o tempo</label><input id="lbQtd" inputmode="decimal" autocomplete="off" placeholder="Ex.: 3"></div>' +
          '<div><label for="lbUn">Unidade</label><select id="lbUn">' + unidades + '</select></div></div>' +
          '<div class="lb-prev" id="lbPrev" role="status" aria-live="polite"></div>' +
          '<p class="lb-erro" id="lbErro" role="alert" hidden></p>' +
          '<div class="row" style="justify-content:flex-end"><button type="button" class="btn" onclick="closeM()">Cancelar</button><button type="submit" class="btn s" id="lbOk">Liberar acesso</button></div>' +
        '</form>');

      var alvo = function () { return (dados().subs || []).find(function (x) { return x.id === +por('lbQuem').value; }); };

      function pintar() {
        var r = resumo(alvo(), escolha, Date.now());
        var prev = por('lbPrev');
        prev.className = 'lb-prev ' + r.tom;
        prev.textContent = r.texto;
        por('lbOk').disabled = !r.ok;
        por('lbOk').textContent = escolha.vitalicio ? 'Liberar para sempre' : 'Liberar acesso';
        por('lbErro').hidden = true;
      }
      function marcar(idAtalho) {
        Array.prototype.forEach.call(d.querySelectorAll('.lb-chip'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-p') === idAtalho)); });
      }
      function doCampo() {
        var cru = por('lbQtd').value;
        if (!String(cru).trim()) return;
        var un = UNIDADES.find(function (u) { return u.id === por('lbUn').value; });
        escolha = { id: '', min: minutosDe(cru, un.mult), vitalicio: false };
        marcar('');
        pintar();
      }

      Array.prototype.forEach.call(d.querySelectorAll('.lb-chip'), function (b) {
        b.onclick = function () {
          var a = ATALHOS.find(function (x) { return x.id === b.getAttribute('data-p'); });
          escolha = { id: a.id, min: a.min || 0, vitalicio: !!a.vitalicio };
          por('lbQtd').value = '';
          marcar(a.id);
          pintar();
        };
      });
      por('lbQtd').oninput = doCampo;
      por('lbUn').onchange = doCampo;
      por('lbQuem').onchange = pintar;
      pintar();

      por('lbF').onsubmit = function (e) {
        e.preventDefault();
        var s2 = alvo();
        var r = resumo(s2, escolha, Date.now());
        if (!r.ok) { por('lbErro').textContent = r.texto; por('lbErro').hidden = false; return; }
        var adm = emailDoAdmin();
        if (!adm) { por('lbErro').textContent = 'Sessão de administrador não identificada. Entre novamente.'; por('lbErro').hidden = false; return; }
        var corpo = { admin_email: adm, target_email: s2.e };
        if (escolha.vitalicio) corpo.is_lifetime = true; else corpo.duration_minutes = escolha.min;
        por('lbOk').disabled = true;
        chamar('/api/subscription/admin-grant-time', corpo).then(function (j) {
          w.closeM();
          avisar(j.message || 'Acesso liberado para ' + s2.n);
          return recarregar();
        }).catch(function (er) {
          por('lbOk').disabled = false;
          por('lbErro').textContent = er.message;
          por('lbErro').hidden = false;
        });
      };
    }

    /* ======== Redefinir senha ======== */
    function resetPwd(tipo, id) {
      var s = dados();
      var lista = (s && (tipo === 'u' ? s.users : s.subs)) || [];
      var conta = lista.find(function (x) { return x.id === id; });
      if (!conta) { avisar('Conta não encontrada. Atualize a lista e tente de novo.', 'var(--w)'); return; }
      if (String(conta.e).toLowerCase() === String(emailDoAdmin()).toLowerCase()) {
        avisar('Para trocar a sua própria senha use Minha Conta, no Nexus.', 'var(--w)');
        return;
      }
      w.modal(
        cabecalho('key', 'n', 'Redefinir senha') +
        '<p class="sub lb-s">Gera uma senha provisória para <b style="color:var(--t)">' + escapar(conta.n) + '</b> (' + escapar(conta.e) + '). A senha atual deixa de valer e quem estiver logado nesta conta é desconectado.</p>' +
        '<form id="lbR" class="col">' +
          '<label class="lb-chk" for="lbTroca"><input type="checkbox" id="lbTroca" checked> Exigir que a pessoa crie uma nova senha no próximo login</label>' +
          '<p class="lb-erro" id="lbRErro" role="alert" hidden></p>' +
          '<div class="row" style="justify-content:flex-end"><button type="button" class="btn" onclick="closeM()">Cancelar</button><button type="submit" class="btn p" id="lbRok">Gerar nova senha</button></div>' +
        '</form>');
      por('lbR').onsubmit = function (e) {
        e.preventDefault();
        por('lbRok').disabled = true;
        chamar('/api/admin/users/reset-password', { email: conta.e, must_change_password: por('lbTroca').checked }).then(function (j) {
          mostrarSenha(j);
        }).catch(function (er) {
          por('lbRok').disabled = false;
          por('lbRErro').textContent = er.message;
          por('lbRErro').hidden = false;
        });
      };
    }

    function mostrarSenha(j) {
      senhaNaTela = true;
      // Esc fecha esta janela (e apaga a senha) mesmo nas versões do painel que não tratam o Esc
      var aoTeclar = function (ev) { if (ev.key === 'Escape') w.closeM(); };
      d.addEventListener('keydown', aoTeclar);
      soltarEsc = function () { d.removeEventListener('keydown', aoTeclar); soltarEsc = null; };
      w.modal(
        cabecalho('ok', 's', 'Senha redefinida') +
        '<p class="sub lb-s">Passe esta senha provisória a <b style="color:var(--t)">' + escapar(j.name) + '</b> (' + escapar(j.email) + '). Ela aparece só agora: depois de fechar esta janela não dá para ver de novo.</p>' +
        '<div class="lb-pw"><code id="lbSenha">' + escapar(j.tempPassword) + '</code><button type="button" class="btn sm" id="lbCopiar">Copiar</button></div>' +
        '<p class="sub" style="margin:12px 0 0">' + (j.must_change_password
          ? 'No primeiro login a pessoa será obrigada a criar uma nova senha. '
          : 'A pessoa poderá continuar com esta senha até trocá-la em Minha Conta. ') +
        'Quem estava logado nesta conta foi desconectado.</p>' +
        '<div class="row" style="justify-content:flex-end;margin-top:16px"><button type="button" class="btn p" id="lbFim">Concluir</button></div>');
      por('lbFim').onclick = function () { w.closeM(); };
      por('lbCopiar').onclick = function () {
        var texto = por('lbSenha').textContent, botao = por('lbCopiar');
        var ok = function () { botao.textContent = 'Copiada'; setTimeout(function () { botao.textContent = 'Copiar'; }, 2000); };
        if (w.navigator.clipboard && w.navigator.clipboard.writeText) {
          w.navigator.clipboard.writeText(texto).then(ok, function () { selecionar(); });
        } else { selecionar(); }
      };
      function selecionar() {
        var r = d.createRange(); r.selectNodeContents(por('lbSenha'));
        var sel = w.getSelection(); sel.removeAllRanges(); sel.addRange(r);
        avisar('Selecionada: use Ctrl+C para copiar.');
      }
    }

    // Fechar a janela (botão, Esc ou clique fora) apaga a senha do DOM: ela não fica escondida na página
    var fecharOriginal = w.closeM;
    w.closeM = function () {
      var r = typeof fecharOriginal === 'function' ? fecharOriginal.apply(this, arguments) : undefined;
      if (senhaNaTela) { senhaNaTela = false; if (soltarEsc) soltarEsc(); var mc = por('mc'); if (mc) mc.innerHTML = ''; }
      return r;
    };

    w.grant = grant;
    w.resetPwd = resetPwd;
  }

  return {
    ATALHOS: ATALHOS, UNIDADES: UNIDADES, MAX_MIN: MAX_MIN,
    minutosDe: minutosDe, erroDuracao: erroDuracao, vencimentoApos: vencimentoApos,
    descreverDuracao: descreverDuracao, condicao: condicao, resumo: resumo, dataHora: dataHora, montar: montar
  };
});
