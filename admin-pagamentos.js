/* Pagamentos — painel do administrador (/admin-assinaturas-glpi), aba "Pagamentos".
   Carregado depois do script principal do painel (mesmo padrão do admin-visitas.js): troca a tela da aba (V.pay), embrulha window.rend para
   buscar o livro de pagamentos toda vez que a aba é aberta e expõe as ações (pg*) que os botões chamam.

   O servidor já tinha tudo (livro, resumo, 2ª via Pix com QR, conciliação de extrato, CSV, configuração); o painel só mostrava uma lista simples.
   Aqui a aba tem cinco áreas: Resumo, Cobranças, A vencer e expirados, Conciliar extrato e Configurações.
   Rotas (todas só de administrador): GET /api/admin/pagamentos, POST .../cobranca, .../acao {confirmar|cancelar|estornar|pix}, .../historico,
   .../conciliar, .../gerar-mensal, .../csv e POST /api/admin/financeiro/config (exige a senha do administrador).
   O valor da cobrança é SEMPRE o do servidor. As peças de tela são funções puras (dados → HTML) e ficam testadas em admin-pagamentos.test.js. */
(function (raiz, fabrica) {
  'use strict';
  var A = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = A;   // testes (node --test)
  if (raiz && raiz.document) A.montar(raiz);
})(typeof window !== 'undefined' ? window : null, function () {
  var DIA = 864e5;
  var TZ = 'America/Sao_Paulo';

  var SITUACOES = [
    { k: '', r: 'Todas' }, { k: 'aguardando', r: 'Para conferir' }, { k: 'emitida', r: 'Em aberto' }, { k: 'vencida', r: 'Vencidas' },
    { k: 'paga', r: 'Pagas' }, { k: 'cancelada', r: 'Canceladas' }, { k: 'estornada', r: 'Estornadas' }
  ];
  var INFO_SITUACAO = {
    aguardando: { r: 'Para conferir', c: 'wa', d: 'O cliente avisou que pagou: confira e confirme' },
    emitida: { r: 'Em aberto', c: 'in', d: 'Cobrança emitida, aguardando o pagamento' },
    vencida: { r: 'Vencida', c: 'er', d: 'Passou do vencimento sem pagamento' },
    paga: { r: 'Paga', c: 'ok', d: 'Recebimento confirmado' },
    cancelada: { r: 'Cancelada', c: 'mu', d: 'Cobrança cancelada' },
    estornada: { r: 'Estornada', c: 'er', d: 'Pagamento devolvido' }
  };
  var PERIODOS = [{ k: 'tudo', r: 'Todo o período' }, { k: 'mes', r: 'Este mês' }, { k: '30', r: 'Últimos 30 dias' }, { k: '90', r: 'Últimos 90 dias' }, { k: 'ano', r: 'Este ano' }];
  var FORMAS = { pix: 'Pix', transferencia: 'Transferência / TED', dinheiro: 'Dinheiro', credit_card: 'Cartão de crédito', debit_card: 'Cartão de débito', boleto: 'Boleto' };
  var ORDENS = [{ k: 'recente', r: 'Mais recentes' }, { k: 'antigo', r: 'Mais antigas' }, { k: 'valor', r: 'Maior valor' }, { k: 'cliente', r: 'Cliente (A–Z)' }];
  var EVENTOS = { emitida: 'Cobrança emitida', informada: 'Cliente avisou o pagamento', paga: 'Recebimento confirmado', cancelada: 'Cobrança cancelada', estornada: 'Pagamento estornado', vencimento: 'Vencimento alterado', '2a_via': '2ª via emitida', lancamento: 'Lançamento retroativo' };
  var ORIGENS = { admin: 'Emitida pelo administrador', automatica: 'Gerada sozinha (cobrança mensal)', historico: 'Lançamento retroativo', legado: 'Aviso anterior ao livro', cliente: 'Aviso do cliente' };
  var TIPOS_CHAVE = { telefone: 'Celular', cpf: 'CPF', cnpj: 'CNPJ', email: 'E-mail', aleatoria: 'Chave aleatória' };
  var ABAS = [{ k: 'resumo', r: 'Resumo', i: 'chart' }, { k: 'cobrancas', r: 'Cobranças', i: 'pay' }, { k: 'vencer', r: 'A vencer e expirados', i: 'calendar' }, { k: 'extrato', r: 'Conciliar extrato', i: 'upload' }, { k: 'config', r: 'Configurações', i: 'cfg' }];

  var ICONES = {
    qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20v.01M17 17h4v4M20 20v.01"/>',
    dl: '<path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M5 21h14"/>',
    cfg: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33 1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82 1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
    chat: '<path d="M21 11.5a8.4 8.4 0 01-9 8.4 8.5 8.5 0 01-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 1121 11.5z"/>',
    upload: '<path d="M12 21V9"/><path d="m7 13 5-5 5 5"/><path d="M5 3h14"/>',
    refresh: '<path d="M21 12a9 9 0 11-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>',
    bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>'
  };

  var CSS = [
    '.pg-ch{display:flex;align-items:flex-end;gap:12px;height:196px;padding-top:6px}',
    '.pg-cc{flex:1 1 0;min-width:0;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:6px}',
    '.pg-cc i{display:block;width:100%;max-width:58px;min-height:4px;border-radius:9px 9px 3px 3px;background:linear-gradient(180deg,color-mix(in srgb,var(--a) 80%,#fff),color-mix(in srgb,var(--a) 50%,transparent))}',
    '.pg-cc i.z{background:var(--b2)}',
    '.pg-cc.cur i{box-shadow:0 0 0 2px color-mix(in srgb,var(--a) 55%,transparent)}',
    '.pg-cv{font-size:var(--fs);font-weight:650;font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.pg-cl{font-size:var(--fs);color:var(--m);text-transform:uppercase;letter-spacing:.05em}',
    '.pg-box h3,.pg-box h2{font-size:calc(var(--fs)*1.143);margin:0 0 12px}',
    '.pg-kv{display:flex;flex-direction:column;gap:2px}',
    '.pg-kv>div{display:flex;justify-content:space-between;align-items:baseline;gap:14px;padding:9px 0;border-top:1px solid var(--b)}',
    '.pg-kv>div:first-child{border-top:0}',
    '.pg-kv span{color:var(--m)}',
    '.pg-kv b{font-weight:650;text-align:right;overflow-wrap:anywhere}',
    '.pg-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:9px;background:var(--c,var(--a))}',
    '.pg-ag{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:11px 0;border-top:1px solid var(--b)}',
    '.pg-ag:first-of-type{border-top:0}',
    '.pg-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px}',
    '.pg-form .full{grid-column:1/-1}',
    '.pg-form small,.pg-aj{display:block;color:var(--m);font-size:var(--fs);margin-top:5px;line-height:1.45}',
    '.pg-bad input,.pg-bad select{border-color:var(--r)!important;box-shadow:0 0 0 3px color-mix(in srgb,var(--r) 22%,transparent)!important}',
    '.pg-qr{display:grid;place-items:center;width:232px;height:232px;margin:2px auto 14px;padding:12px;border-radius:16px;background:#fff;box-shadow:0 .6rem 1.6rem rgba(0,0,0,.35)}',
    '.pg-qr img{width:100%;height:100%;display:block}',
    '.pg-code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:var(--fs);min-height:86px;resize:none;line-height:1.4}',
    '.pg-tl{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}',
    '.pg-tl li{position:relative;padding:0 0 14px 24px}',
    '.pg-tl li::before{content:"";position:absolute;left:5px;top:6px;width:9px;height:9px;border-radius:50%;background:var(--a);box-shadow:0 0 0 3px color-mix(in srgb,var(--a) 20%,transparent)}',
    '.pg-tl li::after{content:"";position:absolute;left:9px;top:18px;bottom:-2px;width:1px;background:var(--b)}',
    '.pg-tl li:last-child{padding-bottom:0}.pg-tl li:last-child::after{display:none}',
    '.pg-tl b{display:block}.pg-tl small{display:block;color:var(--m);font-size:var(--fs);line-height:1.45;overflow-wrap:anywhere}',
    '.pg-fich h3{font-size:calc(var(--fs)*1.143);margin:18px 0 10px}',
    '.pg-sum{display:flex;flex-wrap:wrap;gap:6px 18px;padding:12px 18px;border-top:1px solid var(--b);color:var(--m);font-size:var(--fs)}',
    '.pg-sum b{color:var(--t);font-variant-numeric:tabular-nums}',
    '.pg-drop{display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;padding:30px 18px;border:2px dashed var(--b2);border-radius:16px;background:var(--surf2)}',
    '.pg-drop input[type=file]{display:none}',
    '.pg-sug{display:flex;flex-direction:column;gap:3px}',
    '.pg-sug small{color:var(--m);font-size:var(--fs)}',
    '.pg-ok{color:var(--e);font-weight:650;display:inline-flex;align-items:center;gap:6px}',
    '#mc .ask-m{white-space:pre-line}',   // a janela de confirmação mostra uma alteração por linha (config financeira)
    '@media(max-width:640px){.pg-qr{width:200px;height:200px}.pg-ch{gap:7px}}'
  ].join('');

  /* ---------------------------------------------------------------- peças puras ---------------------------------------------------------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function idSeguro(id) { return String(id == null ? '' : id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40); }
  function plural(n, um, varios) { return Number(n) === 1 ? um : varios; }
  function brl(n) {
    var v = Number(n);
    if (!isFinite(v)) v = 0;
    return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function paraMs(v) {
    if (v == null || v === '') return NaN;
    if (typeof v === 'number') return v;
    var s = String(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Date.parse(s + 'T12:00:00-03:00');   // meio-dia em Brasília: o dia não muda em fuso nenhum
    return Date.parse(s);
  }
  function diaISO(ms) { return new Date(ms).toLocaleDateString('en-CA', { timeZone: TZ }); }          // AAAA-MM-DD em Brasília
  function mesISO(ms) { return diaISO(ms).slice(0, 7); }
  function dataBR(v) {
    var s = String(v == null ? '' : v), m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) return m[3] + '/' + m[2] + '/' + m[1];
    var t = paraMs(v);
    return isNaN(t) ? '' : new Date(t).toLocaleDateString('pt-BR', { timeZone: TZ });
  }
  function dataHoraBR(v) {
    var t = paraMs(v);
    if (isNaN(t)) return '';
    return new Date(t).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).replace(', ', ' ');
  }
  // dias de calendário (Brasília) de hoje até a data: negativo = já passou
  function diasAte(data, agora) {
    var t = paraMs(data);
    if (isNaN(t)) return null;
    return Math.round((Date.parse(diaISO(t) + 'T00:00:00Z') - Date.parse(diaISO(agora) + 'T00:00:00Z')) / DIA);
  }
  function relativo(dias) {
    if (dias == null) return '';
    return dias === 0 ? 'hoje' : dias === 1 ? 'amanhã' : dias === -1 ? 'ontem' : dias > 0 ? 'em ' + dias + ' dias' : 'há ' + (-dias) + ' dias';
  }
  function semAcento(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

  function situacaoDe(p, agora) {
    if (!p) return '';
    if (p.status === 'paga' || p.status === 'cancelada' || p.status === 'estornada') return p.status;
    if (p.status === 'informada') return 'aguardando';
    if (p.vencimento && String(p.vencimento) < diaISO(agora || Date.now())) return 'vencida';
    return 'emitida';
  }
  function situacaoInfo(sit) { return INFO_SITUACAO[sit] || { r: String(sit || '—'), c: 'mu', d: '' }; }
  function sitDe(p, agora) { return p.situacao || situacaoDe(p, agora); }
  function emAberta(sit) { return sit === 'emitida' || sit === 'vencida' || sit === 'aguardando'; }
  function formaRotulo(m) { return FORMAS[m] || (m ? String(m) : '—'); }

  function dataRef(p) {
    var t = paraMs(p.paga_em);
    if (isNaN(t)) t = paraMs(p.informada_em);
    if (isNaN(t)) t = paraMs(p.emitida_em);
    return isNaN(t) ? 0 : t;
  }
  function noPeriodo(p, per, agora) {
    if (!per || per === 'tudo') return true;
    var t = dataRef(p);
    if (per === 'mes') return mesISO(t) === mesISO(agora);
    if (per === 'ano') return diaISO(t).slice(0, 4) === diaISO(agora).slice(0, 4);
    var n = Number(per);
    return n > 0 ? t >= agora - n * DIA : true;
  }
  // f = { sit, q, per, forma }
  function filtrar(lista, f, agora) {
    f = f || {};
    var q = semAcento(f.q || '').trim();
    return (lista || []).filter(function (p) {
      if (!p) return false;
      if (f.sit && sitDe(p, agora) !== f.sit) return false;
      if (f.forma && p.metodo !== f.forma) return false;
      if (!noPeriodo(p, f.per, agora)) return false;
      if (q && semAcento([p.id, p.ref, p.nome, p.email, p.comprovante, p.obs].join(' ')).indexOf(q) < 0) return false;
      return true;
    });
  }
  function contarPorSituacao(lista, agora) {
    var c = { '': 0, aguardando: 0, emitida: 0, vencida: 0, paga: 0, cancelada: 0, estornada: 0 };
    (lista || []).forEach(function (p) { if (!p) return; c['']++; var s = sitDe(p, agora); if (c[s] !== undefined) c[s]++; });
    return c;
  }
  function ordenar(lista, ord) {
    var l = (lista || []).slice();
    var por = {
      recente: function (a, b) { return dataRef(b) - dataRef(a); },
      antigo: function (a, b) { return dataRef(a) - dataRef(b); },
      valor: function (a, b) { return (Number(b.valor) || 0) - (Number(a.valor) || 0) || dataRef(b) - dataRef(a); },
      cliente: function (a, b) { return String(a.nome || a.email).localeCompare(String(b.nome || b.email), 'pt-BR', { sensitivity: 'base' }) || dataRef(b) - dataRef(a); }
    };
    return l.sort(por[ord] || por.recente);
  }
  function totais(lista, agora) {
    var t = { qtd: 0, valor: 0, pago: 0, aberto: 0 };
    (lista || []).forEach(function (p) {
      var v = Number(p.valor) || 0, s = sitDe(p, agora);
      t.qtd++; t.valor += v;
      if (s === 'paga') t.pago += v;
      if (emAberta(s)) t.aberto += v;
    });
    return t;
  }
  function eventoTexto(ev) {
    ev = ev || {};
    return { rotulo: EVENTOS[ev.acao] || String(ev.acao || 'Evento'), quem: ev.por || 'sistema', quando: dataHoraBR(ev.em), nota: String(ev.nota || '') };
  }
  function origemRotulo(o) { return ORIGENS[o] || (o ? String(o) : '—'); }

  function graficoSerie(serie, agora) {
    var s = serie || [];
    var max = s.reduce(function (m, x) { return Math.max(m, Number(x.total) || 0); }, 0);
    var atual = mesISO(agora || Date.now());
    return '<div class="pg-ch" role="img" aria-label="Receita dos últimos meses">' + s.map(function (x) {
      var v = Number(x.total) || 0;
      var h = max > 0 ? Math.max(4, Math.round(v / max * 150)) : 4;
      return '<div class="pg-cc' + (x.mes === atual ? ' cur' : '') + '"><span class="pg-cv">' + esc(v ? brl(v) : '—') + '</span><i' + (v ? '' : ' class="z"') + ' style="height:' + h + 'px" title="' + esc((x.rotulo || x.mes) + ': ' + brl(v) + ' em ' + (x.qtd || 0) + ' pagamento(s)') + '"></i><span class="pg-cl">' + esc(x.rotulo || x.mes) + '</span></div>';
    }).join('') + '</div>';
  }

  // telefone do cadastro → link do WhatsApp (só com número brasileiro plausível)
  function whatsLink(telefone, mensagem) {
    var d = String(telefone || '').replace(/\D/g, '');
    if (d.length === 10 || d.length === 11) d = '55' + d;
    if (!/^55\d{10,11}$/.test(d)) return '';
    return 'https://wa.me/' + d + (mensagem ? '?text=' + encodeURIComponent(mensagem) : '');
  }
  function primeiroNome(n) { return String(n || '').trim().split(/\s+/)[0] || ''; }
  function textoCobranca(p, pix) {
    var t = 'Olá' + (primeiroNome(p.nome) ? ', ' + primeiroNome(p.nome) : '') + '! Segue o Pix da sua assinatura do Nexus Financeiro Hub: ' + brl(p.valor);
    if (p.vencimento) t += ', vencimento em ' + dataBR(p.vencimento);
    t += '.';
    if (pix && pix.payload) t += '\n\nPix copia e cola:\n' + pix.payload;
    t += '\n\nDepois de pagar, avise pelo próprio app (Assinatura > Já paguei). Obrigado!';
    return t;
  }
  function textoLembrete(x, preco) {
    return 'Olá' + (primeiroNome(x.nome) ? ', ' + primeiroNome(x.nome) : '') + '! Sua assinatura do Nexus Financeiro Hub ' + (x.dias != null ? (x.dias <= 0 ? 'vence hoje' : 'vence ' + relativo(x.dias)) : 'está sem acesso ativo') + '. Para continuar com o acesso, a mensalidade é ' + brl(preco) + ' via Pix. Posso enviar o código?';
  }

  // ---- configuração ----
  function mascarar(c) { var s = String(c || ''); return s.length <= 8 ? '***' : s.slice(0, 3) + '…' + s.slice(-3); }
  function numeroBR(v) {
    var s = String(v == null ? '' : v).replace(/[^\d.,-]/g, '');
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    var n = parseFloat(s);
    return isFinite(n) ? n : NaN;
  }
  // formulário (valores crus dos campos) → corpo que o servidor valida (ele é quem decide se está certo)
  function corpoConfig(f) {
    return {
      preco: String(f.preco == null ? '' : f.preco).trim(),
      pix: { tipo: String(f.tipo || ''), chave: String(f.chave || '').trim(), nome: String(f.nome || '').trim(), cidade: String(f.cidade || '').trim() },
      whatsapp: String(f.whatsapp || '').trim(),
      cobranca: { dia: Number(f.dia), prazo_dias: Number(f.prazo) }
    };
  }
  // O que vai mudar, em palavras (para a confirmação). destino = mexe em para onde vai o dinheiro dos clientes.
  function diffConfig(atual, novo) {
    var a = atual || {}, n = novo || {}, pa = a.pix || {}, pn = n.pix || {}, ca = a.cobranca || {}, cn = n.cobranca || {};
    var m = [], destino = false;
    var pNovo = numeroBR(n.preco);
    if (isFinite(pNovo) && Math.abs((Number(a.preco) || 0) - pNovo) > 0.004) m.push('Preço mensal: ' + brl(a.preco) + ' → ' + brl(pNovo));
    if (pa.tipo !== pn.tipo || String(pa.chave || '') !== String(pn.chave || '')) { m.push('Chave Pix: ' + (TIPOS_CHAVE[pa.tipo] || '—') + ' ' + mascarar(pa.chave) + ' → ' + (TIPOS_CHAVE[pn.tipo] || '—') + ' ' + mascarar(pn.chave)); destino = true; }
    if (pa.nome !== pn.nome) { m.push('Favorecido do Pix: ' + (pa.nome || '—') + ' → ' + (pn.nome || '—')); destino = true; }
    if (pa.cidade !== pn.cidade) m.push('Cidade do Pix: ' + (pa.cidade || '—') + ' → ' + (pn.cidade || '—'));
    if (String(a.whatsapp || '').replace(/\D/g, '') !== String(n.whatsapp || '').replace(/\D/g, '')) m.push('WhatsApp de suporte: ' + (a.whatsapp || '—') + ' → ' + (n.whatsapp || '—'));
    if (Number(ca.dia) !== Number(cn.dia)) m.push('Dia da cobrança mensal: ' + (ca.dia || '—') + ' → ' + cn.dia);
    if (Number(ca.prazo_dias) !== Number(cn.prazo_dias)) m.push('Prazo da cobrança: ' + (ca.prazo_dias || '—') + ' → ' + cn.prazo_dias + ' dia(s)');
    return { mudancas: m, destino: destino };
  }
  var CAMPOS_CONFIG = { preco: 'pgc-preco', 'pix.tipo': 'pgc-tipo', 'pix.chave': 'pgc-chave', 'pix.nome': 'pgc-nome', 'pix.cidade': 'pgc-cidade', whatsapp: 'pgc-zap', 'cobranca.dia': 'pgc-dia', 'cobranca.prazo_dias': 'pgc-prazo', senha_atual: 'pgc-senha' };

  /* ---------------------------------------------------------------- telas (dados → HTML) ---------------------------------------------------------------- */
  // E = { dados, aba, f:{sit,q,per,forma,ord}, extrato, agora }; ui = peças do painel (head, kpi, I, ib, search, opt, av)
  function cabecalho(E, ui) {
    var d = E.dados, r = d.resumo || {};
    var acoes = '<button type="button" class="btn p" onclick="pgNovo()">' + ui.I('plus') + ' Registrar / cobrar</button>'
      + '<button type="button" class="btn" onclick="pgGerar()">' + ui.I('bolt') + ' Gerar cobranças do mês</button>'
      + '<button type="button" class="btn" onclick="pgCsv()">' + ui.I('dl') + ' Exportar CSV</button>'
      + '<button type="button" class="btn" onclick="pgAtualizar()" aria-label="Atualizar os pagamentos">' + ui.I('refresh') + ' Atualizar</button>';
    return ui.head('pay', 'Pagamentos', 'Receita, cobranças Pix, conferência de recebimentos, conciliação de extrato e a configuração financeira.', acoes);
  }
  function abas(E, ui) {
    var lista = E.dados.pagamentos || [], r = E.dados.resumo || {};
    var ct = {
      cobrancas: contarPorSituacao(lista, E.agora).aguardando || '',
      vencer: ((r.a_vencer_7d || {}).qtd || 0) + ((r.expirados || {}).qtd || 0) || ''
    };
    return '<div class="tabs" role="tablist" aria-label="Pagamentos">' + ABAS.map(function (a) {
      return '<button type="button" class="tab" role="tab" aria-selected="' + (E.aba === a.k) + '" onclick="pgAba(\'' + a.k + '\')">' + ui.I(a.i) + a.r + (ct[a.k] ? '<span class="ct">' + ct[a.k] + '</span>' : '') + '</button>';
    }).join('') + '</div>';
  }

  function telaResumo(E, ui) {
    var d = E.dados, r = d.resumo || {}, rec = r.receita || {}, ag = r.aguardando || {}, em = r.emitidas || {}, av7 = r.a_vencer_7d || {}, ex = r.expirados || {}, es = r.estornos_mes || {};
    var preco = Number(d.preco) || Number(r.preco) || 0;
    var variacao = rec.variacao_pct == null ? 'sem recebimentos no mês anterior'
      : rec.variacao_pct === 0 ? 'igual ao mês anterior (' + brl(rec.mes_anterior) + ')'
      : (rec.variacao_pct > 0 ? '▲ ' : '▼ ') + Math.abs(rec.variacao_pct) + '% sobre ' + brl(rec.mes_anterior);
    var k = ui.kpi;
    var kpis1 = '<div class="grid g4">'
      + k('money', 'Receita do mês', brl(rec.mes), variacao + ' · ' + (rec.qtd_mes || 0) + ' ' + plural(rec.qtd_mes, 'pagamento', 'pagamentos'), 'e')
      + k('chart', 'Receita acumulada', brl(rec.total), (rec.qtd_total || 0) + ' ' + plural(rec.qtd_total, 'pagamento confirmado', 'pagamentos confirmados'))
      + k('subs', 'Receita mensal recorrente', brl(r.mrr), (r.pagantes || 0) + ' ' + plural(r.pagantes, 'assinante pagante', 'assinantes pagantes') + ' × ' + brl(preco))
      + k('clock', 'Para conferir', ag.qtd || 0, brl(ag.valor) + ' aguardando a sua confirmação', ag.qtd ? 'w' : '')
      + '</div>';
    var kpis2 = '<div class="grid g4">'
      + k('pay', 'Cobranças em aberto', em.qtd || 0, brl(em.valor) + (em.vencidas ? ' · ' + em.vencidas + ' ' + plural(em.vencidas, 'vencida', 'vencidas') : ' · nenhuma vencida'), em.vencidas ? 'r' : '')
      + k('calendar', 'A vencer em 7 dias', av7.qtd || 0, 'previsto ' + brl(av7.valor_previsto))
      + k('alert', 'Acesso expirado', ex.qtd || 0, 'contas sem plano ativo', ex.qtd ? 'r' : '')
      + k('undo', 'Estornos do mês', es.qtd || 0, brl(es.valor), es.qtd ? 'r' : '')
      + '</div>';

    var agir = [];
    if (ag.qtd) agir.push([ag.qtd + ' ' + plural(ag.qtd, 'pagamento aguardando conferência', 'pagamentos aguardando conferência'), 'Conferir', "pgIr('cobrancas','aguardando')"]);
    if (em.vencidas) agir.push([em.vencidas + ' ' + plural(em.vencidas, 'cobrança vencida', 'cobranças vencidas'), 'Ver', "pgIr('cobrancas','vencida')"]);
    if (av7.qtd) agir.push([av7.qtd + ' ' + plural(av7.qtd, 'assinatura vence', 'assinaturas vencem') + ' em até 7 dias', 'Ver', "pgIr('vencer')"]);
    if (ex.qtd) agir.push([ex.qtd + ' ' + plural(ex.qtd, 'conta com acesso expirado', 'contas com acesso expirado'), 'Ver', "pgIr('vencer')"]);
    var agirHtml = agir.length
      ? agir.map(function (a) { return '<div class="pg-ag"><span>' + esc(a[0]) + '</span><button type="button" class="btn sm" onclick="' + a[2] + '">' + esc(a[1]) + '</button></div>'; }).join('')
      : '<div class="note">' + ui.I('ok') + '<span>Tudo em dia: nenhum pagamento para conferir, nenhuma cobrança vencida e nenhuma assinatura perto de vencer.</span></div>';

    var cm = d.cobranca_mensal || {};
    var base = [['Assinantes pagantes', r.pagantes, 'var(--e)'], ['Cortesias', r.cortesias, 'var(--w)'], ['Acesso vitalício', r.vitalicios, 'var(--a)'], ['Em teste grátis', r.testes, 'var(--m)']];
    var pix = d.pix || {};
    return '<div class="col" style="gap:16px">' + kpis1 + kpis2 + '</div>'
      + '<div class="grid g2">'
      + '<div class="glass pad pg-box"><h3>Receita dos últimos 6 meses</h3>' + graficoSerie(r.serie, E.agora) + '</div>'
      + '<div class="glass pad pg-box"><h3>Para agir agora</h3>' + agirHtml + '</div>'
      + '</div>'
      + '<div class="grid g3">'
      + '<div class="glass pad pg-box"><h3>Base de assinantes</h3><div class="pg-kv">' + base.map(function (b) { return '<div><span><i class="pg-dot" style="--c:' + b[2] + '"></i>' + b[0] + '</span><b>' + (b[1] || 0) + '</b></div>'; }).join('') + '</div></div>'
      + '<div class="glass pad pg-box"><h3>Conta de recebimento (Pix)</h3><div class="pg-kv"><div><span>Chave (' + esc(pix.tipo_chave || '—') + ')</span><b class="mono">' + esc(pix.chave || 'não configurada') + '</b></div><div><span>Favorecido</span><b>' + esc(pix.favorecido || '—') + '</b></div><div><span>Mensalidade</span><b>' + brl(preco) + '</b></div></div><div style="margin-top:14px"><button type="button" class="btn sm" onclick="pgAba(\'config\')">' + ui.I('cfg') + ' Alterar na configuração</button></div></div>'
      + '<div class="glass pad pg-box"><h3>Cobrança automática</h3><div class="pg-kv"><div><span>Gerada todo dia</span><b>' + esc(cm.dia || '—') + '</b></div><div><span>Prazo para pagar</span><b>' + (cm.prazo_dias ? cm.prazo_dias + ' ' + plural(cm.prazo_dias, 'dia', 'dias') : '—') + '</b></div><div><span>Próxima geração</span><b>' + esc(cm.proxima ? dataBR(cm.proxima) : '—') + '</b></div></div><p class="pg-aj">O cliente não recebe aviso automático: envie a 2ª via pelo WhatsApp na aba Cobranças.</p></div>'
      + '</div>';
  }

  function opcoesPeriodo(sel, ui) { return PERIODOS.map(function (p) { return ui.opt(p.k, p.r, sel || 'tudo'); }).join(''); }
  function opcoesForma(lista, sel, ui) {
    var usadas = {};
    (lista || []).forEach(function (p) { if (p && p.metodo) usadas[p.metodo] = true; });
    return ui.opt('', 'Todas as formas', sel) + Object.keys(usadas).sort().map(function (m) { return ui.opt(m, formaRotulo(m), sel); }).join('');
  }
  function segSituacoes(E, ui) {
    var base = filtrar(E.dados.pagamentos, { q: E.f.q, per: E.f.per, forma: E.f.forma }, E.agora);
    var c = contarPorSituacao(base, E.agora);
    return '<div class="seg" role="group" aria-label="Situação da cobrança">' + SITUACOES.map(function (s) {
      return '<button type="button" data-k="' + s.k + '" class="' + ((E.f.sit || '') === s.k ? 'on' : '') + '" aria-pressed="' + ((E.f.sit || '') === s.k) + '" onclick="pgSit(\'' + s.k + '\')">' + s.r + '<span class="n">' + (c[s.k] || 0) + '</span></button>';
    }).join('') + '</div>';
  }

  function linhaCobranca(p, E, ui) {
    var sit = sitDe(p, E.agora), inf = situacaoInfo(sit), id = idSeguro(p.id), quem = p.nome || p.email;
    var prazo, prazo2 = '';
    if (sit === 'paga') {
      prazo = 'Paga em ' + dataHoraBR(p.paga_em);
      prazo2 = Number(p.dias) > 0 && p.periodo_fim ? 'libera até ' + dataBR(p.periodo_fim) : (p.origem === 'historico' ? 'lançamento retroativo' : '');
    } else if (sit === 'aguardando') {
      prazo = 'Avisou em ' + dataHoraBR(p.informada_em);
      prazo2 = p.comprovante ? 'comprovante ' + p.comprovante : '';
    } else if (sit === 'emitida' || sit === 'vencida') {
      var dv = p.vencimento ? diasAte(p.vencimento, E.agora) : null;
      prazo = p.vencimento ? 'Vence ' + dataBR(p.vencimento) : 'Sem vencimento';
      prazo2 = dv == null ? '' : (dv < 0 ? 'venceu ' + relativo(dv) : relativo(dv));
    } else if (sit === 'estornada') {
      prazo = 'Estornada em ' + dataBR(p.estornada_em);
    } else {
      prazo = 'Emitida em ' + dataBR(p.emitida_em);
    }
    var acoes = '';
    if (sit === 'aguardando') acoes += '<button type="button" class="btn sm s" onclick="pgConfirmar(\'' + id + '\')">' + ui.I('ok') + ' Confirmar</button>';
    else if (sit === 'emitida' || sit === 'vencida') acoes += '<button type="button" class="btn sm" onclick="pgPix(\'' + id + '\')">' + ui.I('qr') + ' 2ª via Pix</button>';
    else if (sit === 'paga') acoes += '<button type="button" class="btn sm d" onclick="pgMotivo(\'' + id + '\',\'estornar\')">' + ui.I('undo') + ' Estornar</button>';
    acoes += ui.ib('doc', 'Detalhes', quem, "pgFicha('" + id + "')");
    if (sit === 'emitida' || sit === 'vencida') acoes += ui.ib('ok', 'Registrar recebimento', quem, "pgConfirmar('" + id + "')");
    if (emAberta(sit)) acoes += ui.ib('ban', sit === 'aguardando' ? 'Recusar' : 'Cancelar cobrança', quem, "pgMotivo('" + id + "','cancelar')", 'd');
    return '<tr><td data-l="Cobrança"><b class="mono">' + esc(p.ref || p.id) + '</b><small class="sub" style="display:block;margin:2px 0 0">' + esc(dataBR(p.emitida_em)) + ' · ' + esc(origemRotulo(p.origem)) + '</small></td>'
      + '<td data-l="Cliente"><div class="who">' + ui.av(p.nome || p.email, p.email) + '<div class="wt"><b>' + esc(p.nome || p.email) + '</b><small>' + esc(p.email) + '</small></div></div></td>'
      + '<td data-l="Valor" class="mono" style="font-weight:600;white-space:nowrap">' + brl(p.valor) + '<small class="sub" style="display:block;margin:2px 0 0">' + esc(formaRotulo(p.metodo)) + '</small></td>'
      + '<td data-l="Prazo">' + esc(prazo) + (prazo2 ? '<small class="sub" style="display:block;margin:2px 0 0">' + esc(prazo2) + '</small>' : '') + '</td>'
      + '<td data-l="Situação"><span class="tag ' + inf.c + '" title="' + esc(inf.d) + '">' + esc(inf.r) + '</span>' + (p.confirmado_por && p.confirmado_por.nome ? '<small class="sub" style="display:block;margin:4px 0 0">por ' + esc(p.confirmado_por.nome) + '</small>' : '') + '</td>'
      + '<td class="ac" data-l="Ações"><div class="acts">' + acoes + '</div></td></tr>';
  }
  function linhasCobrancas(lista, E, ui) {
    if (!lista.length) {
      var filtrado = E.f.sit || E.f.q || (E.f.per && E.f.per !== 'tudo') || E.f.forma;
      return ui.empty(6, 'search', 'Nenhuma cobrança encontrada', filtrado ? 'Ajuste a busca ou os filtros.' : 'As cobranças aparecem aqui assim que forem emitidas ou registradas.', filtrado ? '<button type="button" class="btn sm" onclick="pgLimpar()">Limpar filtros</button>' : '');
    }
    return lista.map(function (p) { return linhaCobranca(p, E, ui); }).join('');
  }
  function resumoLista(lista, total, agora) {
    var t = totais(lista, agora);
    return '<span><b>' + lista.length + '</b> ' + (lista.length === total ? plural(lista.length, 'cobrança', 'cobranças') : 'de <b>' + total + '</b>') + '</span><span>valor somado <b>' + brl(t.valor) + '</b></span><span>recebido <b>' + brl(t.pago) + '</b></span><span>em aberto <b>' + brl(t.aberto) + '</b></span>';
  }
  function telaCobrancas(E, ui) {
    var lista = ordenar(filtrar(E.dados.pagamentos, E.f, E.agora), E.f.ord);
    var total = (E.dados.pagamentos || []).length;
    return '<div class="glass bar">' + ui.search('pgq', 'Buscar por cliente, e-mail, referência ou comprovante…', E.f.q || '', 'pgBuscar()')
      + '<select id="pgper" aria-label="Período" onchange="pgFiltro(\'per\',this.value)">' + opcoesPeriodo(E.f.per, ui) + '</select>'
      + '<select id="pgforma" aria-label="Forma de pagamento" onchange="pgFiltro(\'forma\',this.value)">' + opcoesForma(E.dados.pagamentos, E.f.forma, ui) + '</select>'
      + '<select id="pgord" aria-label="Ordenação" onchange="pgFiltro(\'ord\',this.value)">' + ORDENS.map(function (o) { return ui.opt(o.k, o.r, E.f.ord || 'recente'); }).join('') + '</select></div>'
      + '<div class="row" style="justify-content:space-between;gap:12px">' + '<div id="pgseg">' + segSituacoes(E, ui) + '</div>'
      + '<span class="cnt" id="pgcnt">' + lista.length + ' de ' + total + '</span></div>'
      + '<div class="glass tbl"><div class="scroll"><table><thead><tr><th>Cobrança</th><th style="min-width:260px">Cliente</th><th>Valor</th><th>Prazo</th><th>Situação</th><th class="c-r">Ações</th></tr></thead><tbody id="pgb">' + linhasCobrancas(lista, E, ui) + '</tbody></table></div>'
      + '<div class="pg-sum" id="pgsum">' + resumoLista(lista, total, E.agora) + '</div></div>';
  }

  function linhaVencer(x, i, tipo, E, ui, preco) {
    var link = whatsLink(x.telefone, textoLembrete(tipo === 'vencer' ? { nome: x.nome, dias: x.dias } : { nome: x.nome, dias: null }, preco));
    var quando, detalhe;
    if (tipo === 'vencer') {
      quando = x.dias <= 0 ? 'Vence hoje' : 'Vence ' + relativo(x.dias);
      detalhe = 'em ' + dataBR(x.expira) + (x.cortesia ? ' · cortesia' : '');
    } else {
      quando = x.situacao === 'teste_fim' ? 'Teste encerrado' : 'Expirou ' + (x.dias_atraso == null ? '' : relativo(-x.dias_atraso));
      detalhe = x.expirou_em ? 'em ' + dataBR(x.expirou_em) : (x.situacao === 'teste_fim' ? 'não contratou o plano' : '');
    }
    return '<tr><td data-l="Cliente"><div class="who">' + ui.av(x.nome, x.email) + '<div class="wt"><b>' + esc(x.nome) + '</b><small>' + esc(x.email) + '</small></div></div></td>'
      + '<td data-l="Situação"><span class="tag ' + (tipo === 'vencer' ? 'wa' : 'er') + '">' + esc(quando) + '</span><small class="sub" style="display:block;margin:4px 0 0">' + esc(detalhe) + '</small></td>'
      + '<td class="ac" data-l="Ações"><div class="acts"><button type="button" class="btn sm" onclick="pgCobrarLista(\'' + tipo + '\',' + i + ')">' + ui.I('qr') + ' Gerar cobrança</button>'
      + (link ? '<a class="btn sm" href="' + esc(link) + '" target="_blank" rel="noopener">' + ui.I('chat') + ' WhatsApp</a>' : '') + '</div></td></tr>';
  }
  function telaVencer(E, ui) {
    var r = E.dados.resumo || {}, av7 = r.a_vencer_7d || {}, ex = r.expirados || {}, preco = Number(E.dados.preco) || 0;
    function bloco(titulo, sub, lista, tipo, vazio) {
      return '<div class="glass tbl"><div style="padding:16px 18px 6px"><h3 style="font-size:calc(var(--fs)*1.143)">' + titulo + '</h3><p class="sub" style="margin:2px 0 0">' + sub + '</p></div><div class="scroll"><table><thead><tr><th style="min-width:260px">Cliente</th><th>Situação</th><th class="c-r">Ações</th></tr></thead><tbody>'
        + (lista.length ? lista.map(function (x, i) { return linhaVencer(x, i, tipo, E, ui, preco); }).join('') : ui.empty(3, 'ok', vazio[0], vazio[1], '')) + '</tbody></table></div></div>';
    }
    return '<div class="note">' + ui.I('info') + '<span>O sistema gera a cobrança sozinho no dia configurado, mas <b>não avisa o cliente</b>. Use <b>Gerar cobrança</b> para abrir o Pix com QR (e copiar o código) e o botão <b>WhatsApp</b> para enviar a mensagem pronta.</span></div>'
      + bloco('A vencer em até 7 dias', (av7.qtd || 0) + ' ' + plural(av7.qtd, 'assinatura', 'assinaturas') + ' · previsto ' + brl(av7.valor_previsto), av7.lista || [], 'vencer', ['Nada vence nos próximos 7 dias', 'Quando uma assinatura estiver perto de vencer, ela aparece aqui.'])
      + bloco('Acesso expirado', (ex.qtd || 0) + ' ' + plural(ex.qtd, 'conta', 'contas') + ' sem plano ativo (inclui teste grátis encerrado)', ex.lista || [], 'expirado', ['Nenhuma conta expirada', 'Quem deixar a assinatura vencer aparece aqui, do atraso menor para o maior.']);
  }

  function telaExtrato(E, ui) {
    var x = E.extrato || { estado: 'vazio' };
    var envio = '<div class="pg-drop"><span class="pic" style="width:52px;height:52px">' + ui.I('upload') + '</span><div><b>Envie o extrato do banco (OFX ou CSV)</b><p class="sub" style="margin:4px 0 0">O sistema só <b>sugere</b> quais cobranças abertas foram pagas, pelo código da cobrança ou por valor e nome. Quem confirma é você, uma a uma.</p></div>'
      + '<label class="btn p" style="cursor:pointer;margin:0;text-transform:none;letter-spacing:0;color:var(--on-brand,#fff)">' + ui.I('upload') + ' Escolher arquivo<input type="file" id="pgarq" accept=".ofx,.csv,.txt,text/csv,application/x-ofx" onchange="pgExtrato(this)"></label>'
      + (x.nome ? '<small class="sub">Último arquivo: ' + esc(x.nome) + '</small>' : '') + '</div>';
    if (x.estado === 'lendo') return envio + '<div class="glass pad">Lendo o extrato…</div>';
    if (x.estado === 'erro') return envio + '<div class="note" style="border-color:var(--r)">' + ui.I('alert') + '<span>' + esc(x.erro) + '</span></div>';
    if (x.estado !== 'ok' || !x.res) return envio;
    var r = x.res, feitos = x.feitos || {};
    var resumo = '<div class="grid g4">' + ui.kpi('upload', 'Créditos no extrato', r.creditos || 0, 'arquivo ' + esc(String(r.formato || '').toUpperCase()) + ' · ' + (r.lancamentos || 0) + ' lançamentos')
      + ui.kpi('ok', 'Sugestões', (r.sugestoes || []).length, 'cobranças abertas que parecem pagas', 'e')
      + ui.kpi('info', 'Já conciliados', r.ja_conciliados || 0, 'confirmados antes por este extrato')
      + ui.kpi('alert', 'Sem cobrança', (r.sem_par || []).length, 'créditos sem cobrança aberta', (r.sem_par || []).length ? 'w' : '') + '</div>';
    var sug = (r.sugestoes || []).map(function (s, i) {
      var l = s.lancamento, p = s.pagamento, feito = feitos[l.hash];
      return '<tr><td data-l="Lançamento"><div class="pg-sug"><b>' + esc(dataBR(l.data)) + ' · ' + brl(l.valor) + '</b><small>' + esc(l.descricao || '—') + '</small></div></td>'
        + '<td data-l="Cobrança"><div class="pg-sug"><b>' + esc(p.nome || p.email) + '</b><small>' + esc(p.ref || p.id) + ' · ' + esc(situacaoInfo(p.situacao).r) + '</small></div></td>'
        + '<td data-l="Confiança"><span class="tag ' + (s.forca === 'forte' ? 'ok' : 'wa') + '">' + (s.forca === 'forte' ? 'Forte' : 'Fraca') + '</span><small class="sub" style="display:block;margin:4px 0 0">' + esc(s.motivo) + '</small></td>'
        + '<td class="ac" data-l="Ações">' + (feito ? '<span class="pg-ok">' + ui.I('ok') + ' Confirmado</span>' : '<button type="button" class="btn sm s" onclick="pgConciliar(' + i + ')">' + ui.I('ok') + ' Confirmar recebimento</button>') + '</td></tr>';
    }).join('');
    var sem = (r.sem_par || []).map(function (l) {
      return '<tr><td data-l="Data">' + esc(dataBR(l.data)) + '</td><td data-l="Descrição" style="max-width:0;width:60%"><div class="wt"><small style="color:var(--t)">' + esc(l.descricao || '—') + '</small></div></td><td data-l="Valor" class="mono" style="font-weight:600;white-space:nowrap">' + brl(l.valor) + '</td></tr>';
    }).join('');
    return envio + resumo
      + '<div class="glass tbl"><div style="padding:16px 18px 6px"><h3 style="font-size:calc(var(--fs)*1.143)">Sugestões de conciliação</h3></div><div class="scroll"><table><thead><tr><th>Lançamento do extrato</th><th>Cobrança sugerida</th><th>Confiança</th><th class="c-r">Ações</th></tr></thead><tbody>'
      + (sug || ui.empty(4, 'search', 'Nenhuma sugestão', 'Nenhum crédito do extrato bate com uma cobrança aberta.', '')) + '</tbody></table></div></div>'
      + (sem ? '<div class="glass tbl"><div style="padding:16px 18px 6px"><h3 style="font-size:calc(var(--fs)*1.143)">Créditos sem cobrança aberta</h3><p class="sub" style="margin:2px 0 0">Para registrar um recebimento antigo, use <b>Registrar / cobrar</b> → lançamento retroativo.</p></div><div class="scroll"><table><thead><tr><th>Data</th><th>Descrição</th><th>Valor</th></tr></thead><tbody>' + sem + '</tbody></table></div></div>' : '');
  }

  function campo(id, rotulo, html, ajuda, cls) { return '<div class="' + (cls || '') + '" id="' + id + '-w"><label for="' + id + '">' + rotulo + '</label>' + html + (ajuda ? '<small>' + ajuda + '</small>' : '') + '</div>'; }
  function telaConfig(E, ui) {
    var cfg = E.dados.config || {}, a = cfg.atual || { pix: {}, cobranca: {} }, ap = cfg.apresentacao || {};
    var hist = (cfg.historico || []).map(function (h) {
      return '<li><b>' + esc((h.mudancas || []).length + ' ' + plural((h.mudancas || []).length, 'alteração', 'alterações')) + ' · ' + esc(dataHoraBR(h.em)) + '</b><small>por ' + esc((h.por && (h.por.nome || h.por.email)) || '—') + '</small>' + (h.mudancas || []).map(function (m) { return '<small>• ' + esc(m) + '</small>'; }).join('') + '</li>';
    }).join('');
    return '<div class="note">' + ui.I('info') + '<span>As alterações valem <b>na hora</b> e exigem a sua senha. Cobranças já emitidas mantêm o valor e a chave da época; as novas saem com a configuração nova.</span></div>'
      + '<div class="glass pad pg-box"><h2>Preço e Pix de recebimento</h2><form id="pgcfg" class="col" onsubmit="return pgSalvarConfig(event)" autocomplete="off"><div class="pg-form">'
      + campo('pgc-preco', 'Mensalidade (R$)', '<input id="pgc-preco" inputmode="decimal" value="' + esc(String(a.preco == null ? '' : Number(a.preco).toFixed(2)).replace('.', ',')) + '" placeholder="18,00">', 'Entre ' + brl(1) + ' e ' + brl(5000) + '. Use vírgula nos centavos.')
      + campo('pgc-tipo', 'Tipo da chave Pix', '<select id="pgc-tipo">' + Object.keys(TIPOS_CHAVE).map(function (k) { return ui.opt(k, TIPOS_CHAVE[k], (a.pix || {}).tipo); }).join('') + '</select>', '')
      + campo('pgc-chave', 'Chave Pix', '<input id="pgc-chave" class="mono" value="' + esc((a.pix || {}).chave || '') + '" placeholder="Sua chave">', ap.chave_exibicao ? 'Hoje: <b>' + esc(ap.chave_exibicao) + '</b>' : '')
      + campo('pgc-nome', 'Favorecido (nome no banco)', '<input id="pgc-nome" maxlength="25" value="' + esc((a.pix || {}).nome || '') + '">', 'Até 25 caracteres, sem acento.')
      + campo('pgc-cidade', 'Cidade do favorecido', '<input id="pgc-cidade" maxlength="15" value="' + esc((a.pix || {}).cidade || '') + '">', 'Até 15 caracteres, sem acento.')
      + campo('pgc-zap', 'WhatsApp de suporte', '<input id="pgc-zap" inputmode="tel" value="' + esc(ap.whatsapp_exibicao || a.whatsapp || '') + '" placeholder="(62) 90000-0000">', 'Com DDD. Aparece para o cliente enviar o comprovante.')
      + campo('pgc-dia', 'Dia da cobrança mensal', '<input id="pgc-dia" type="number" min="1" max="28" value="' + esc((a.cobranca || {}).dia || 5) + '">', 'De 1 a 28.')
      + campo('pgc-prazo', 'Prazo para pagar (dias)', '<input id="pgc-prazo" type="number" min="5" max="30" value="' + esc((a.cobranca || {}).prazo_dias || 5) + '">', 'De 5 a 30 dias depois de gerada: toda conta fica disponível para pagamento 5 dias antes do vencimento.')
      + campo('pgc-senha', 'Sua senha (para confirmar)', '<input id="pgc-senha" type="password" autocomplete="current-password" placeholder="Senha do administrador">', 'Protege contra troca da chave Pix por quem pegar a sessão aberta.', 'full')
      + '</div><div class="row" style="justify-content:flex-end"><button type="submit" class="btn p">' + ui.I('ok') + ' Salvar configuração</button></div></form></div>'
      + '<div class="glass pad pg-box"><h2>Histórico de alterações</h2>' + (hist ? '<ul class="pg-tl">' + hist + '</ul>' : '<p class="sub" style="margin:0">Ainda não houve alteração: valem os valores padrão do sistema.</p>') + '</div>';
  }

  function telaErro(msg, ui) {
    return '<section><div class="glass big"><div class="ei">' + ui.I('alert') + '</div><h3 style="font-size:calc(var(--fs)*1.286)">Não foi possível carregar os pagamentos</h3><p>' + esc(msg) + '</p>'
      + '<button type="button" class="btn p" onclick="pgAtualizar()">' + ui.I('undo') + ' Tentar de novo</button></div></section>';
  }
  function tela(E, ui) {
    var corpo = { resumo: telaResumo, cobrancas: telaCobrancas, vencer: telaVencer, extrato: telaExtrato, config: telaConfig }[E.aba] || telaResumo;
    return '<section>' + cabecalho(E, ui) + abas(E, ui) + corpo(E, ui) + '</section>';
  }

  /* ---- janelas (modais) ---- */
  function modalFicha(p, E, ui) {
    var sit = sitDe(p, E.agora), inf = situacaoInfo(sit), id = idSeguro(p.id);
    var linhas = [['Referência (txid do Pix)', '<span class="mono">' + esc(p.ref || '—') + '</span>'], ['Cobrança', '<span class="mono">' + esc(p.id) + '</span>'], ['Cliente', esc(p.nome || '—')], ['E-mail', esc(p.email)], ['Plano', esc(p.plano || '—')],
      ['Valor', brl(p.valor)], ['Forma de pagamento', esc(formaRotulo(p.metodo))], ['Origem', esc(origemRotulo(p.origem))], ['Emitida em', esc(dataHoraBR(p.emitida_em) || '—')], ['Vencimento', esc(p.vencimento ? dataBR(p.vencimento) : '—')]];
    if (p.informada_em) linhas.push(['Cliente avisou em', esc(dataHoraBR(p.informada_em))]);
    if (p.paga_em) linhas.push(['Paga em', esc(dataHoraBR(p.paga_em))]);
    if (p.periodo_fim && Number(p.dias) > 0) linhas.push(['Acesso liberado até', esc(dataBR(p.periodo_fim)) + ' (' + p.dias + ' ' + plural(p.dias, 'dia', 'dias') + ')']);
    if (p.estornada_em) linhas.push(['Estornada em', esc(dataHoraBR(p.estornada_em))]);
    if (p.confirmado_por && (p.confirmado_por.nome || p.confirmado_por.email)) linhas.push(['Confirmado por', esc(p.confirmado_por.nome || p.confirmado_por.email)]);
    if (p.comprovante) linhas.push(['Comprovante', '<span class="mono">' + esc(p.comprovante) + '</span>']);
    if (p.extrato_id) linhas.push(['Lançamento do extrato', '<span class="mono">' + esc(p.extrato_id) + '</span>']);
    if (p.obs) linhas.push(['Observação', esc(p.obs)]);
    var hist = (p.historico || []).slice().reverse().map(function (ev) {
      var e = eventoTexto(ev);
      return '<li><b>' + esc(e.rotulo) + '</b><small>' + esc(e.quando) + ' · ' + esc(e.quem) + '</small>' + (e.nota ? '<small>' + esc(e.nota) + '</small>' : '') + '</li>';
    }).join('');
    var botoes = '';
    if (sit === 'aguardando' || sit === 'emitida' || sit === 'vencida') botoes += '<button type="button" class="btn s" onclick="pgConfirmar(\'' + id + '\')">' + ui.I('ok') + ' Confirmar recebimento</button>';
    if (sit === 'emitida' || sit === 'vencida') botoes += '<button type="button" class="btn" onclick="pgPix(\'' + id + '\')">' + ui.I('qr') + ' 2ª via Pix</button>';
    if (emAberta(sit)) botoes += '<button type="button" class="btn d" onclick="pgMotivo(\'' + id + '\',\'cancelar\')">' + ui.I('ban') + ' ' + (sit === 'aguardando' ? 'Recusar' : 'Cancelar cobrança') + '</button>';
    if (sit === 'paga') botoes += '<button type="button" class="btn d" onclick="pgMotivo(\'' + id + '\',\'estornar\')">' + ui.I('undo') + ' Estornar</button>';
    return '<div class="pg-fich"><div class="ask-h"><span class="ask-ic n" aria-hidden="true">' + ui.I('doc') + '</span><h3>Cobrança ' + esc(p.ref || p.id) + '</h3></div>'
      + '<span class="tag ' + inf.c + '">' + esc(inf.r) + '</span><p class="sub" style="margin:6px 0 12px">' + esc(inf.d) + '</p>'
      + '<div class="pg-kv">' + linhas.map(function (l) { return '<div><span>' + l[0] + '</span><b>' + l[1] + '</b></div>'; }).join('') + '</div>'
      + (hist ? '<h3>Histórico</h3><ul class="pg-tl">' + hist + '</ul>' : '')
      + (botoes ? '<div class="row ask-ft" style="margin-top:18px">' + botoes + '</div>' : '') + '</div>';
  }
  function modalPix(p, pix, ui, linkZap) {
    return '<div class="ask-h"><span class="ask-ic n" aria-hidden="true">' + ui.I('qr') + '</span><h3>Pix da cobrança</h3></div>'
      + '<div class="pg-qr"><img src="' + esc(pix.qr_url) + '" alt="QR Code do Pix de ' + esc(brl(p.valor)) + '" width="208" height="208"></div>'
      + '<div class="pg-kv" style="margin-bottom:14px"><div><span>Cliente</span><b>' + esc(p.nome || p.email) + '</b></div><div><span>Valor</span><b>' + brl(p.valor) + '</b></div><div><span>Vencimento</span><b>' + esc(p.vencimento ? dataBR(p.vencimento) : 'sem data') + '</b></div><div><span>Favorecido</span><b>' + esc(pix.favorecido || '—') + '</b></div><div><span>Referência</span><b class="mono">' + esc(p.ref) + '</b></div></div>'
      + '<label for="pgcode">Pix copia e cola</label><textarea id="pgcode" class="pg-code" readonly rows="4" onfocus="this.select()">' + esc(pix.payload) + '</textarea>'
      + '<div class="row" style="margin:12px 0 6px"><button type="button" class="btn p" onclick="pgCopiar()">' + ui.I('copy') + ' Copiar código</button>' + (linkZap ? '<a class="btn" href="' + esc(linkZap) + '" target="_blank" rel="noopener">' + ui.I('chat') + ' Enviar pelo WhatsApp</a>' : '') + '</div>'
      + '<div class="pg-form" style="margin-top:14px;align-items:end"><div><label for="pgvenc">Novo vencimento</label><input id="pgvenc" type="date" value="' + esc(p.vencimento || '') + '"></div><div><button type="button" class="btn" onclick="pgReemitir(\'' + idSeguro(p.id) + '\')">' + ui.I('refresh') + ' Reemitir com este vencimento</button></div></div>'
      + '<p class="pg-aj">A reemissão mantém a mesma cobrança e a mesma referência: não cria uma segunda para o mesmo mês.</p>';
  }

  return {
    ABAS: ABAS, SITUACOES: SITUACOES, PERIODOS: PERIODOS, FORMAS: FORMAS, EVENTOS: EVENTOS, CSS: CSS, ICONES: ICONES, CAMPOS_CONFIG: CAMPOS_CONFIG,
    esc: esc, idSeguro: idSeguro, brl: brl, paraMs: paraMs, dataBR: dataBR, dataHoraBR: dataHoraBR, diaISO: diaISO, diasAte: diasAte, relativo: relativo, semAcento: semAcento,
    situacaoDe: situacaoDe, situacaoInfo: situacaoInfo, filtrar: filtrar, contarPorSituacao: contarPorSituacao, ordenar: ordenar, totais: totais, eventoTexto: eventoTexto,
    graficoSerie: graficoSerie, whatsLink: whatsLink, textoCobranca: textoCobranca, textoLembrete: textoLembrete, numeroBR: numeroBR, corpoConfig: corpoConfig, diffConfig: diffConfig,
    telaResumo: telaResumo, telaCobrancas: telaCobrancas, linhasCobrancas: linhasCobrancas, resumoLista: resumoLista, segSituacoes: segSituacoes, telaVencer: telaVencer, telaExtrato: telaExtrato, telaConfig: telaConfig, telaErro: telaErro, tela: tela,
    modalFicha: modalFicha, modalPix: modalPix,
    montar: function (w) { return montar(w); }
  };

  /* ---------------------------------------------------------------- encaixe no painel ---------------------------------------------------------------- */
  function montar(w) {
    var d = w.document;
    var PAG = { aba: 'resumo', estado: 'novo', dados: null, erro: '', visto: '', f: { sit: '', q: '', per: 'tudo', forma: '', ord: 'recente' }, extrato: { estado: 'vazio' }, agora: Date.now() };
    var UI = null;

    var estilo = d.createElement('style');
    estilo.textContent = CSS;
    d.head.appendChild(estilo);

    function painelPronto() {
      try { return typeof IC === 'object' && typeof V === 'object' && typeof head === 'function' && typeof kpi === 'function' && typeof I === 'function' && typeof ib === 'function' && typeof search === 'function' && typeof opt === 'function' && typeof empty === 'function' && typeof av === 'function' && typeof skel === 'function' && typeof modal === 'function'; } catch (e) { return false; }
    }
    if (!painelPronto()) return;
    Object.keys(ICONES).forEach(function (k) { IC[k] = ICONES[k]; });
    UI = { head: head, kpi: kpi, I: I, ib: ib, search: search, opt: opt, empty: empty, av: av };

    function $(id) { return d.getElementById(id); }
    function abaAtual() { return String(w.location.hash || '').slice(1); }
    function token() { return w.NexusSSO && w.NexusSSO.token ? w.NexusSSO.token() : (function () { try { return w.localStorage.getItem('nexus_token') || ''; } catch (e) { return ''; } })(); }
    function aviso(m, c) { if (typeof toast === 'function') toast(m, c); }
    function E() { PAG.agora = Date.now(); return { dados: PAG.dados, aba: PAG.aba, f: PAG.f, extrato: PAG.extrato, agora: PAG.agora }; }
    function achar(id) { return ((PAG.dados && PAG.dados.pagamentos) || []).filter(function (p) { return p.id === id; })[0] || null; }
    function conta(email) { try { return (S.subs || []).filter(function (s) { return String(s.e).toLowerCase() === String(email).toLowerCase(); })[0] || null; } catch (e) { return null; } }

    function api(caminho, metodo, corpo, bruto) {
      return w.fetch(caminho, { method: metodo || 'GET', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token() }, body: corpo ? JSON.stringify(corpo) : undefined }).then(function (r) {
        if (bruto && r.ok) return r;
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (r.status === 401 && w.NexusSSO) w.NexusSSO.verificar().then(function (v) { if (v.estado === 'sem-sessao') w.NexusSSO.irParaLogin(); });
          if (!r.ok || j.success === false) { var e = new Error(j.error || ('Erro ' + r.status)); e.status = r.status; e.campo = j.campo; throw e; }
          return j;
        });
      });
    }

    function carregar() {
      PAG.estado = 'carregando';
      return api('/api/admin/pagamentos').then(function (j) { PAG.dados = j; PAG.estado = 'ok'; PAG.erro = ''; })
        .catch(function (e) { PAG.estado = 'erro'; PAG.erro = (e && e.message) || 'O servidor não respondeu.'; })
        .then(function () { if (abaAtual() === 'pay') w.rend(); });
    }
    // depois de uma ação: refaz o livro E as contas (o selo do menu e a lista de assinaturas dependem delas)
    function depois() {
      PAG.estado = 'novo';
      if (typeof w.__nxCarregarReais === 'function') return w.__nxCarregarReais();
      return w.rend();
    }

    // estado para conferência (testes e suporte): nada que mude o painel
    w.NexusPagamentos = { estado: function () { return { aba: PAG.aba, estado: PAG.estado, f: PAG.f, extrato: PAG.extrato, dados: PAG.dados }; } };

    V.pay = function () {
      if (PAG.estado === 'ok' && PAG.dados) return tela(E(), UI);
      if (PAG.estado === 'erro') return telaErro(PAG.erro, UI);
      return skel();
    };

    // Ao abrir a aba o livro é buscado de novo; com ela aberta, rend() só redesenha o que já veio
    var rendOriginal = w.rend;
    w.rend = function () {
      var m = abaAtual();
      if (m === 'pay' && PAG.visto !== 'pay') { PAG.estado = 'novo'; PAG.extrato = { estado: 'vazio' }; }
      PAG.visto = m;
      var r = rendOriginal.apply(this, arguments);
      var real = false; try { real = Boolean(S && S.real); } catch (e) {}
      if (m === 'pay' && PAG.estado === 'novo' && real) carregar();
      return r;
    };

    /* ---- lista de cobranças: só o corpo da tabela muda enquanto se digita (o campo de busca não perde o foco) ---- */
    function atualizarLista() {
      var tb = $('pgb');
      if (!tb || !PAG.dados) return;
      var e = E();
      var lista = ordenar(filtrar(PAG.dados.pagamentos, PAG.f, e.agora), PAG.f.ord);
      var total = (PAG.dados.pagamentos || []).length;
      tb.innerHTML = linhasCobrancas(lista, e, UI);
      var sg = $('pgseg'); if (sg) sg.innerHTML = segSituacoes(e, UI);
      var c = $('pgcnt'); if (c) c.textContent = lista.length + ' de ' + total;
      var sm = $('pgsum'); if (sm) sm.innerHTML = resumoLista(lista, total, e.agora);
    }
    w.prows = function () { if ($('pgb')) atualizarLista(); };

    w.pgAba = function (k) { PAG.aba = k; w.rend(); };
    w.pgIr = function (aba, sit) { PAG.aba = aba; if (sit != null) { PAG.f.sit = sit; PAG.f.q = ''; PAG.f.per = 'tudo'; PAG.f.forma = ''; } w.rend(); };
    w.pgBuscar = function () { var i = $('pgq'); PAG.f.q = i ? i.value : ''; atualizarLista(); };
    w.pgFiltro = function (campo, valor) { PAG.f[campo] = valor; atualizarLista(); };
    w.pgSit = function (k) { PAG.f.sit = k; atualizarLista(); };
    w.pgLimpar = function () { PAG.f = { sit: '', q: '', per: 'tudo', forma: '', ord: 'recente' }; w.rend(); };
    w.pgAtualizar = function () { PAG.estado = 'novo'; w.rend(); };

    /* ---- exportar CSV (o que está na tela; sem filtro, tudo) ---- */
    w.pgCsv = function () {
      var e = E();
      var filtrado = PAG.f.sit || PAG.f.q || (PAG.f.per && PAG.f.per !== 'tudo') || PAG.f.forma;
      var ids = filtrado ? filtrar(PAG.dados.pagamentos, PAG.f, e.agora).map(function (p) { return p.id; }) : null;
      if (filtrado && !ids.length) return aviso('Nada para exportar com estes filtros.', 'var(--w)');
      api('/api/admin/pagamentos/csv', 'POST', ids ? { ids: ids } : {}, true).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
        var blob = new w.Blob([buf], { type: 'text/csv;charset=utf-8' });
        var a = d.createElement('a');
        a.href = w.URL.createObjectURL(blob);
        a.download = 'pagamentos-' + diaISO(Date.now()) + '.csv';
        d.body.appendChild(a); a.click(); a.remove();
        w.setTimeout(function () { w.URL.revokeObjectURL(a.href); }, 4000);
        aviso('Planilha gerada (' + (ids ? ids.length : (PAG.dados.pagamentos || []).length) + ' registros).');
      }).catch(function (er) { aviso(er.message, 'var(--r)'); });
    };

    /* ---- gerar as cobranças do mês ---- */
    w.pgGerar = function () {
      ask('Gerar agora a cobrança do mês de cada assinatura ativa? Quem já tem a cobrança do mês, já pagou neste ciclo ou tem uma cobrança em aberto não recebe outra.', { t: 'Gerar cobranças do mês', ok: 'Gerar agora', tone: 's', ic: 'bolt' }).then(function (ok) {
        if (!ok) return;
        return api('/api/admin/pagamentos/gerar-mensal', 'POST', {}).then(function (r) { aviso(r.message || 'Cobranças geradas.'); return depois(); });
      }).catch(function (e) { aviso(e.message, 'var(--r)'); });
    };

    /* ---- ficha ---- */
    w.pgFicha = function (id) { var p = achar(id); if (p) modal(modalFicha(p, E(), UI)); };

    /* ---- 2ª via Pix ---- */
    function abrirPix(p, pix) {
      var c = conta(p.email);
      modal(modalPix(p, pix, UI, whatsLink(c && c.tel, textoCobranca(p, pix))));
    }
    w.pgPix = function (id) {
      api('/api/admin/pagamentos/acao', 'POST', { id: id, acao: 'pix' }).then(function (r) { abrirPix(r.pagamento, r.pix); }).catch(function (e) { aviso(e.message, 'var(--r)'); });
    };
    w.pgReemitir = function (id) {
      var p = achar(id), v = $('pgvenc') && $('pgvenc').value;
      if (!p) return;
      if (!v) return aviso('Escolha o novo vencimento.', 'var(--r)');
      api('/api/admin/pagamentos/cobranca', 'POST', { email: p.email, vencimento: v }).then(function (r) {
        abrirPix(r.pagamento, r.pix);
        aviso(r.reutilizada ? '2ª via emitida com o novo vencimento.' : 'Nova cobrança emitida.');
        if (r.outras_abertas && r.outras_abertas.length) aviso('Atenção: esta conta tem outra cobrança aberta (' + r.outras_abertas.map(function (x) { return x.ref; }).join(', ') + '). Cancele a que sobrar.', 'var(--w)');
        PAG.estado = 'novo'; carregar();
      }).catch(function (e) { aviso(e.message, 'var(--r)'); });
    };
    w.pgCopiar = function () {
      var t = $('pgcode'); if (!t) return;
      var ok = function () { aviso('Código Pix copiado.'); };
      if (w.navigator.clipboard && w.navigator.clipboard.writeText) w.navigator.clipboard.writeText(t.value).then(ok, function () { t.select(); d.execCommand('copy'); ok(); });
      else { t.select(); d.execCommand('copy'); ok(); }
    };
    // cobrança a partir da lista de "a vencer / expirados"
    w.pgCobrarLista = function (tipo, i) {
      var r = (PAG.dados && PAG.dados.resumo) || {};
      var lista = tipo === 'vencer' ? (r.a_vencer_7d || {}).lista : (r.expirados || {}).lista;
      var x = (lista || [])[i];
      if (!x) return;
      api('/api/admin/pagamentos/cobranca', 'POST', { email: x.email }).then(function (res) {
        abrirPix(res.pagamento, res.pix);
        aviso(res.reutilizada ? '2ª via da cobrança em aberto.' : 'Cobrança gerada para ' + (x.nome || x.email) + '.');
        PAG.estado = 'novo'; carregar();
      }).catch(function (e) { aviso(e.message, 'var(--r)'); });
    };

    /* ---- confirmar recebimento ---- */
    w.pgConfirmar = function (id) {
      var p = achar(id); if (!p) return;
      modal('<div class="ask-h"><span class="ask-ic s" aria-hidden="true">' + I('ok') + '</span><h3>Confirmar recebimento</h3></div>'
        + '<p class="sub ask-m">Cliente <b>' + esc(p.nome || p.email) + '</b> · cobrança <span class="mono">' + esc(p.ref) + '</span>. Ao confirmar, a assinatura é liberada (30 dias a partir da confirmação).</p>'
        + '<form id="pgf" class="col"><div class="pg-form"><div><label for="pgv">Valor recebido (R$)</label><input id="pgv" inputmode="decimal" value="' + esc(Number(p.valor).toFixed(2).replace('.', ',')) + '"></div>'
        + '<div><label for="pgm">Forma</label><select id="pgm">' + Object.keys(FORMAS).map(function (k) { return opt(k, FORMAS[k], p.metodo || 'pix'); }).join('') + '</select></div></div>'
        + '<div><label for="pgr">Comprovante / ID do Pix (opcional)</label><input id="pgr" maxlength="80" value="' + esc(p.comprovante || '') + '" placeholder="Ex.: E123…"></div>'
        + '<div><label for="pgo">Observação (opcional)</label><input id="pgo" maxlength="200"></div>'
        + '<div class="row ask-ft"><button type="button" class="btn" onclick="closeM()">Cancelar</button><button class="btn s">Confirmar recebimento</button></div></form>');
      $('pgf').onsubmit = function (e) {
        e.preventDefault();
        var v = numeroBR($('pgv').value);
        if (!isFinite(v) || v <= 0) return aviso('Informe o valor recebido.', 'var(--r)');
        api('/api/admin/pagamentos/acao', 'POST', { id: id, acao: 'confirmar', valor: v, metodo: $('pgm').value, comprovante: $('pgr').value, obs: $('pgo').value }).then(function (r) {
          closeM(); aviso(r.message || 'Recebimento confirmado.'); return depois();
        }).catch(function (er) { aviso(er.message, 'var(--r)'); });
      };
    };

    /* ---- cancelar / recusar / estornar (com motivo) ---- */
    w.pgMotivo = function (id, acao) {
      var p = achar(id); if (!p) return;
      var est = acao === 'estornar', recusa = !est && sitDe(p, Date.now()) === 'aguardando';
      var titulo = est ? 'Estornar pagamento' : (recusa ? 'Recusar pagamento' : 'Cancelar cobrança');
      var aviso1 = est ? 'O pagamento de ' + brl(p.valor) + ' de ' + (p.nome || p.email) + ' será marcado como estornado e os dias que ele liberou saem da assinatura (se não sobrar acesso, a conta é bloqueada).'
        : 'A cobrança ' + p.ref + ' de ' + (p.nome || p.email) + ' (' + brl(p.valor) + ') será cancelada e deixa de valer para o cliente.';
      modal('<div class="ask-h"><span class="ask-ic d" aria-hidden="true">' + I(est ? 'undo' : 'ban') + '</span><h3>' + titulo + '</h3></div><p class="sub ask-m">' + esc(aviso1) + '</p>'
        + '<form id="pgf" class="col"><div><label for="pgmo">Motivo (fica no histórico)</label><input id="pgmo" maxlength="200" placeholder="Ex.: pagamento não localizado no extrato"></div>'
        + '<div class="row ask-ft"><button type="button" class="btn" onclick="closeM()">Voltar</button><button class="btn dz">' + (est ? 'Estornar' : (recusa ? 'Recusar' : 'Cancelar cobrança')) + '</button></div></form>');
      $('pgf').onsubmit = function (e) {
        e.preventDefault();
        var motivo = $('pgmo').value.trim() || (est ? 'Estornado pelo administrador no painel' : 'Cancelado pelo administrador no painel');
        api('/api/admin/pagamentos/acao', 'POST', { id: id, acao: acao, obs: motivo }).then(function (r) {
          closeM(); aviso(r.message || 'Feito.', 'var(--w)'); return depois();
        }).catch(function (er) { aviso(er.message, 'var(--r)'); });
      };
    };

    /* ---- registrar / cobrar: três caminhos ---- */
    w.pgNovo = function (emailInicial) {
      var contas = [];
      try { contas = (S.subs || []).filter(function (s) { return s.p !== 'Administrador' && s.p !== 'Vitalício'; }); } catch (e) {}
      if (!contas.length) return aviso('Nenhuma conta elegível (administradores e vitalícios não pagam).', 'var(--w)');
      var preco = (PAG.dados && Number(PAG.dados.preco)) || 0, hoje = diaISO(Date.now());
      var opcoes = contas.slice().sort(function (a, b) { return String(a.n).localeCompare(String(b.n), 'pt-BR', { sensitivity: 'base' }); }).map(function (s) { return opt(s.e, s.n + ' — ' + s.e, emailInicial || ''); }).join('');
      modal('<div class="ask-h"><span class="ask-ic n" aria-hidden="true">' + I('pay') + '</span><h3>Registrar / cobrar</h3></div>'
        + '<form id="pgf" class="col"><div><label for="pgmodo">O que você quer fazer?</label><select id="pgmodo" onchange="pgModo()"><option value="cobranca">Emitir cobrança Pix (o cliente paga e avisa)</option><option value="recebido">Registrar pagamento recebido agora (libera +30 dias)</option><option value="antigo">Lançar pagamento antigo (só histórico, não muda o acesso)</option></select></div>'
        + '<div><label for="pgc">Assinante</label><select id="pgc">' + opcoes + '</select></div>'
        + '<div class="pg-form"><div id="pgw-venc"><label for="pgvn">Vencimento</label><input id="pgvn" type="date" min="' + hoje + '" value="' + diaISO(Date.now() + 5 * DIA) + '"></div>'
        + '<div id="pgw-data" class="hide"><label for="pgdt">Data do recebimento</label><input id="pgdt" type="date" max="' + hoje + '" value="' + hoje + '"></div>'
        + '<div id="pgw-valor" class="hide"><label for="pgvl">Valor recebido (R$)</label><input id="pgvl" inputmode="decimal" value="' + esc(Number(preco).toFixed(2).replace('.', ',')) + '"></div>'
        + '<div id="pgw-forma" class="hide"><label for="pgfm">Forma</label><select id="pgfm">' + Object.keys(FORMAS).map(function (k) { return opt(k, FORMAS[k], 'pix'); }).join('') + '</select></div></div>'
        + '<div id="pgw-comp" class="hide"><label for="pgrf">Comprovante / ID do Pix (opcional)</label><input id="pgrf" maxlength="80" placeholder="Ex.: E123…"></div>'
        + '<div><label for="pgob">Observação (opcional)</label><input id="pgob" maxlength="200"></div>'
        + '<p class="pg-aj" id="pgdica"></p>'
        + '<div class="row ask-ft"><button type="button" class="btn" onclick="closeM()">Cancelar</button><button class="btn p" id="pgok">Emitir cobrança</button></div></form>');
      w.pgModo = function () {
        var m = $('pgmodo').value;
        function mostra(id, sim) { var e = $(id); if (e) e.classList.toggle('hide', !sim); }
        mostra('pgw-venc', m === 'cobranca'); mostra('pgw-data', m === 'antigo'); mostra('pgw-valor', m !== 'cobranca'); mostra('pgw-forma', m !== 'cobranca'); mostra('pgw-comp', m === 'recebido');
        $('pgok').textContent = m === 'cobranca' ? 'Emitir cobrança' : (m === 'recebido' ? 'Registrar e liberar acesso' : 'Lançar no histórico');
        $('pgdica').textContent = m === 'cobranca' ? 'O valor é sempre a mensalidade de ' + brl(preco) + '. Se já houver uma cobrança em aberto desta conta, é ela que sai de novo (2ª via).'
          : m === 'recebido' ? 'Cria (ou usa a cobrança em aberto) e confirma na hora: a assinatura fica válida por 30 dias a partir da confirmação.'
          : 'Para um pagamento que já aconteceu antes do sistema ou por fora dele. Entra na receita do mês do recebimento e NÃO muda o acesso da conta.';
      };
      w.pgModo();
      $('pgf').onsubmit = function (e) {
        e.preventDefault();
        var m = $('pgmodo').value, email = $('pgc').value, obs = $('pgob').value, v = numeroBR($('pgvl').value);
        var botao = $('pgok'); botao.disabled = true;
        var fim = function () { botao.disabled = false; };
        if (m === 'cobranca') {
          return api('/api/admin/pagamentos/cobranca', 'POST', { email: email, vencimento: $('pgvn').value, obs: obs }).then(function (r) {
            abrirPix(r.pagamento, r.pix); aviso(r.reutilizada ? '2ª via da cobrança em aberto.' : 'Cobrança Pix emitida.'); PAG.estado = 'novo'; carregar();
          }).catch(function (er) { aviso(er.message, 'var(--r)'); }).then(fim);
        }
        if (!isFinite(v) || v <= 0) { fim(); return aviso('Informe o valor recebido.', 'var(--r)'); }
        if (m === 'antigo') {
          return api('/api/admin/pagamentos/historico', 'POST', { email: email, data: $('pgdt').value, valor: v, metodo: $('pgfm').value, obs: obs }).then(function (r) {
            closeM(); aviso(r.message || 'Pagamento lançado.'); return depois();
          }).catch(function (er) { aviso(er.message, 'var(--r)'); }).then(fim);
        }
        // recebido agora: usa a cobrança em aberto da conta (para não duplicar) ou cria uma; depois confirma
        var aberta = ((PAG.dados && PAG.dados.pagamentos) || []).filter(function (p) { return p.email === String(email).toLowerCase() && (p.status === 'emitida' || p.status === 'informada'); })[0];
        var obter = aberta ? Promise.resolve(aberta) : api('/api/admin/pagamentos/cobranca', 'POST', { email: email, obs: obs }).then(function (r) { return r.pagamento; });
        return obter.then(function (p) {
          return api('/api/admin/pagamentos/acao', 'POST', { id: p.id, acao: 'confirmar', valor: v, metodo: $('pgfm').value, comprovante: $('pgrf').value, obs: obs });
        }).then(function (r) { closeM(); aviso(r.message || 'Pagamento registrado.'); return depois(); })
          .catch(function (er) { aviso(er.message, 'var(--r)'); }).then(fim);
      };
    };

    /* ---- conciliar extrato ---- */
    function lerArquivo(arq, codificacao) {
      return new Promise(function (ok, falha) {
        var fr = new w.FileReader();
        fr.onload = function () { ok(String(fr.result || '')); };
        fr.onerror = function () { falha(new Error('Não consegui ler o arquivo.')); };
        fr.readAsText(arq, codificacao || 'utf-8');
      });
    }
    w.pgExtrato = function (input) {
      var arq = input.files && input.files[0];
      if (!arq) return;
      if (arq.size > 3 * 1024 * 1024) { PAG.extrato = { estado: 'erro', erro: 'Arquivo grande demais (máximo 3 MB). Exporte um período menor no banco.', nome: arq.name }; return w.rend(); }
      PAG.extrato = { estado: 'lendo', nome: arq.name }; w.rend();
      lerArquivo(arq).then(function (t) { return t.indexOf('�') >= 0 ? lerArquivo(arq, 'windows-1252') : t; }).then(function (texto) {
        return api('/api/admin/pagamentos/conciliar', 'POST', { conteudo: texto });
      }).then(function (res) { PAG.extrato = { estado: 'ok', nome: arq.name, res: res, feitos: {} }; })
        .catch(function (e) { PAG.extrato = { estado: 'erro', erro: e.message, nome: arq.name }; })
        .then(function () { if (abaAtual() === 'pay') w.rend(); });
    };
    w.pgConciliar = function (i) {
      var x = PAG.extrato && PAG.extrato.res, s = x && x.sugestoes && x.sugestoes[i];
      if (!s) return;
      api('/api/admin/pagamentos/acao', 'POST', { id: s.pagamento.id, acao: 'confirmar', valor: s.lancamento.valor, metodo: 'pix', extrato_id: s.lancamento.hash, obs: 'Conciliado pelo extrato: ' + String(s.lancamento.descricao || '').slice(0, 120) }).then(function (r) {
        PAG.extrato.feitos[s.lancamento.hash] = true; aviso(r.message || 'Recebimento confirmado.');
        PAG.estado = 'novo';
        return (typeof w.__nxCarregarReais === 'function' ? w.__nxCarregarReais() : carregar());
      }).catch(function (e) { aviso(e.message, 'var(--r)'); });
    };

    /* ---- configuração ---- */
    function lerForm() {
      var g = function (id) { var e = $(id); return e ? e.value : ''; };
      return { preco: g('pgc-preco'), tipo: g('pgc-tipo'), chave: g('pgc-chave'), nome: g('pgc-nome'), cidade: g('pgc-cidade'), whatsapp: g('pgc-zap'), dia: g('pgc-dia'), prazo: g('pgc-prazo') };
    }
    function marcarErro(campo, msg) {
      Array.prototype.forEach.call(d.querySelectorAll('.pg-bad'), function (e) { e.classList.remove('pg-bad'); });
      var id = CAMPOS_CONFIG[campo], el = id && $(id + '-w');
      if (el) { el.classList.add('pg-bad'); var i = $(id); if (i && i.focus) i.focus(); }
      aviso(msg, 'var(--r)');
    }
    w.pgSalvarConfig = function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      Array.prototype.forEach.call(d.querySelectorAll('.pg-bad'), function (e) { e.classList.remove('pg-bad'); });
      var corpo = corpoConfig(lerForm());
      var senha = $('pgc-senha') ? $('pgc-senha').value : '';
      if (!senha) { marcarErro('senha_atual', 'Digite a sua senha para confirmar a alteração.'); return false; }
      var df = diffConfig(((PAG.dados || {}).config || {}).atual, corpo);
      if (!df.mudancas.length) { aviso('Nada mudou: a configuração já está assim.', 'var(--m)'); return false; }
      ask(df.mudancas.join('\n') + (df.destino ? '\n\nAtenção: isto muda PARA ONDE VAI O DINHEIRO dos clientes. Confira a chave e o favorecido antes de salvar.' : ''), { t: 'Salvar configuração financeira?', ok: 'Salvar agora', d: df.destino, tone: df.destino ? 'd' : 's', ic: df.destino ? 'alert' : 'cfg' }).then(function (ok) {
        if (!ok) return;
        return api('/api/admin/financeiro/config', 'POST', { config: corpo, senha_atual: senha }).then(function (r) {
          if ($('pgc-senha')) $('pgc-senha').value = '';
          aviso(r.message || 'Configuração salva.');
          return depois();
        });
      }).catch(function (e) { marcarErro(e.campo, e.message); });
      return false;
    };
  }
});
