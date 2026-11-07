'use strict';

/**
 * Leitura de extratos bancários (OFX e CSV) para a tela "Importar extrato".
 * Funções puras, sem DOM, testadas em importacao.test.js.
 *
 * O que o importador antigo errava: só aceitava vírgula como separador (a vírgula decimal "1.234,56" virava 1234 e perdia os
 * centavos), não lia ";" (padrão dos bancos brasileiros), gravava a data como veio ("15/11/2026" não é a data que o app usa),
 * só reconhecia OFX pela extensão do arquivo e importar o mesmo extrato duas vezes duplicava tudo.
 */
(function (global, fabrica) {
  const api = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (global) global.NexusImport = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const pad = (n) => String(n).padStart(2, '0');
  const arred = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

  function dataValida(a, m, d) {
    if (!(a >= 1900 && a <= 2200 && m >= 1 && m <= 12 && d >= 1)) return false;
    return d <= new Date(a, m, 0).getDate();
  }

  // Devolve AAAA-MM-DD (o formato do app) ou null. Aceita AAAA-MM-DD, AAAA/MM/DD, DD/MM/AAAA, DD-MM-AAAA, DD.MM.AAAA,
  // DD/MM/AA, AAAAMMDD e ISO com hora.
  function normalizarData(texto) {
    const t = String(texto == null ? '' : texto).trim().replace(/^["']|["']$/g, '');
    if (!t) return null;
    let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(t);
    if (m) return dataValida(+m[1], +m[2], +m[3]) ? m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]) : null;
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[T\s].*)?$/.exec(t);
    if (m) return dataValida(+m[3], +m[2], +m[1]) ? m[3] + '-' + pad(+m[2]) + '-' + pad(+m[1]) : null;
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})$/.exec(t);
    if (m) { const ano = 2000 + (+m[3]); return dataValida(ano, +m[2], +m[1]) ? ano + '-' + pad(+m[2]) + '-' + pad(+m[1]) : null; }
    m = /^(\d{4})(\d{2})(\d{2})(?:\d{0,6}.*)?$/.exec(t);
    if (m) return dataValida(+m[1], +m[2], +m[3]) ? m[1] + '-' + m[2] + '-' + m[3] : null;
    return null;
  }

  // "R$ 1.234,56", "-1.234,56", "1,234.56", "1234.56", "(123,45)", "123,45-", "+10" -> número (NaN se não for número)
  function lerValor(texto) {
    let t = String(texto == null ? '' : texto).trim().replace(/^["']|["']$/g, '');
    if (!t) return NaN;
    let negativo = false;
    if (/^\(.*\)$/.test(t)) { negativo = true; t = t.slice(1, -1); }
    t = t.replace(/R\$|\s/g, '');
    if (/-$/.test(t)) { negativo = true; t = t.slice(0, -1); }
    if (/^-/.test(t)) { negativo = !negativo ? true : negativo; t = t.slice(1); }
    if (/^\+/.test(t)) t = t.slice(1);
    if (!/^[\d.,]+$/.test(t) || !/\d/.test(t)) return NaN;
    const ponto = t.lastIndexOf('.');
    const virgula = t.lastIndexOf(',');
    if (ponto >= 0 && virgula >= 0) {
      // os dois aparecem: o que vem por último é o decimal
      t = virgula > ponto ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
    } else if (virgula >= 0) {
      if ((t.match(/,/g) || []).length > 1) t = t.replace(/,/g, '');
      else t = t.replace(',', '.');
    } else if (ponto >= 0) {
      // só pontos: "1.234.567" é milhar; "1234.56" e "0.5" são decimais
      if ((t.match(/\./g) || []).length > 1 || /^\d{1,3}(\.\d{3})+$/.test(t) && !/^0\./.test(t) && t.split('.')[1].length === 3 && t.split('.').length > 2) t = t.replace(/\./g, '');
    }
    const n = parseFloat(t);
    if (!Number.isFinite(n)) return NaN;
    return negativo ? -n : n;
  }

  // Divide uma linha respeitando aspas ("Padaria, Centro";-12,50) e aspas duplicadas
  function dividirLinha(linha, sep) {
    const campos = [];
    let atual = '';
    let aspas = false;
    for (let i = 0; i < linha.length; i++) {
      const c = linha[i];
      if (aspas) {
        if (c === '"') { if (linha[i + 1] === '"') { atual += '"'; i++; } else aspas = false; } else atual += c;
      } else if (c === '"') aspas = true;
      else if (c === sep) { campos.push(atual); atual = ''; } else atual += c;
    }
    campos.push(atual);
    return campos.map((x) => x.trim());
  }

  function detectarSeparador(linhas) {
    const amostra = linhas.slice(0, 8);
    const pontuar = (sep) => amostra.reduce((s, l) => s + Math.max(0, dividirLinha(l, sep).length - 1), 0);
    const cand = [[';', pontuar(';')], ['\t', pontuar('\t')], [',', pontuar(',')]];
    // ";" e tabulação têm prioridade: em arquivo brasileiro a vírgula costuma ser o decimal
    cand.sort((a, b) => b[1] - a[1]);
    if (cand[0][1] === 0) return ',';
    const semVirgula = cand.filter((c) => c[0] !== ',' && c[1] > 0);
    return semVirgula.length ? semVirgula[0][0] : ',';
  }

  const SEM_ACENTO = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  function mapearCabecalho(campos) {
    const nomes = campos.map(SEM_ACENTO);
    const acha = (...ops) => nomes.findIndex((n) => ops.some((o) => n === o || n.startsWith(o)));
    const ix = {
      data: acha('data', 'date', 'dt'),
      desc: acha('descricao', 'description', 'historico', 'memo', 'lancamento', 'estabelecimento', 'detalhes', 'title', 'titulo', 'nome'),
      valor: acha('valor', 'amount', 'value', 'quantia'),
      credito: acha('credito', 'entrada', 'receita'),
      debito: acha('debito', 'saida', 'despesa')
    };
    const reconheceu = ix.data >= 0 && ix.desc >= 0 && (ix.valor >= 0 || ix.credito >= 0 || ix.debito >= 0);
    return reconheceu ? ix : null;
  }

  function lerCsv(texto) {
    const linhas = String(texto).split(/\r\n|\r|\n/).filter((l) => l.trim());
    const resultado = { linhas: [], ignoradas: [] };
    if (!linhas.length) return resultado;
    const sep = detectarSeparador(linhas);
    let cab = null;
    let inicio = 0;
    const primeira = dividirLinha(linhas[0], sep);
    const mapa = mapearCabecalho(primeira);
    if (mapa) { cab = mapa; inicio = 1; } else if (!normalizarData(primeira[0]) && primeira.every((c) => !c || !Number.isFinite(lerValor(c)) || /[a-z]/i.test(c))) {
      // primeira linha textual sem cabeçalho conhecido (ex.: "Extrato Conta Corrente"): pula
      inicio = 1;
    }
    for (let i = inicio; i < linhas.length; i++) {
      const campos = dividirLinha(linhas[i], sep);
      const numLinha = i + 1;
      let data = null; let desc = ''; let valor = NaN;
      if (cab) {
        data = normalizarData(campos[cab.data]);
        desc = (campos[cab.desc] || '').trim();
        if (cab.valor >= 0) valor = lerValor(campos[cab.valor]);
        else {
          const cr = cab.credito >= 0 ? lerValor(campos[cab.credito]) : NaN;
          const de = cab.debito >= 0 ? lerValor(campos[cab.debito]) : NaN;
          if (Number.isFinite(cr) && cr !== 0) valor = Math.abs(cr);
          else if (Number.isFinite(de) && de !== 0) valor = -Math.abs(de);
        }
      } else {
        // sem cabeçalho: data, descrição, valor (ordem documentada); se a data não estiver na 1ª coluna, procura
        let di = campos.findIndex((c) => normalizarData(c));
        if (di < 0) { resultado.ignoradas.push({ linha: numLinha, motivo: 'data inválida ou ausente', texto: linhas[i].slice(0, 80) }); continue; }
        data = normalizarData(campos[di]);
        let vi = -1;
        for (let k = campos.length - 1; k >= 0; k--) { if (k !== di && Number.isFinite(lerValor(campos[k]))) { vi = k; break; } }
        if (vi >= 0) valor = lerValor(campos[vi]);
        desc = campos.filter((_, k) => k !== di && k !== vi).join(' ').trim();
      }
      if (!data) { resultado.ignoradas.push({ linha: numLinha, motivo: 'data inválida ou ausente', texto: linhas[i].slice(0, 80) }); continue; }
      if (!Number.isFinite(valor)) { resultado.ignoradas.push({ linha: numLinha, motivo: 'valor inválido ou ausente', texto: linhas[i].slice(0, 80) }); continue; }
      if (valor === 0) { resultado.ignoradas.push({ linha: numLinha, motivo: 'valor zerado', texto: linhas[i].slice(0, 80) }); continue; }
      resultado.linhas.push({ date: data, desc: desc || 'Importado', val: arred(valor) });
    }
    return resultado;
  }

  function lerOfx(texto) {
    const resultado = { linhas: [], ignoradas: [] };
    const re = /<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>)|$)/gi;
    let m; let n = 0;
    while ((m = re.exec(texto))) {
      n++;
      const bloco = m[1];
      const amt = (bloco.match(/<TRNAMT>\s*([^\r\n<]+)/i) || [])[1];
      const dt = (bloco.match(/<DTPOSTED>\s*([^\r\n<]+)/i) || [])[1];
      const memo = ((bloco.match(/<MEMO>\s*([^\r\n<]*)/i) || [])[1] || (bloco.match(/<NAME>\s*([^\r\n<]*)/i) || [])[1] || '').trim();
      const data = normalizarData(dt);
      const valor = lerValor(amt);
      if (!data) { resultado.ignoradas.push({ linha: n, motivo: 'data inválida ou ausente', texto: String(dt || '').slice(0, 40) }); continue; }
      if (!Number.isFinite(valor) || valor === 0) { resultado.ignoradas.push({ linha: n, motivo: 'valor inválido ou zerado', texto: String(amt || '').slice(0, 40) }); continue; }
      resultado.linhas.push({ date: data, desc: memo || 'Importado', val: arred(valor) });
    }
    return resultado;
  }

  // Lê o conteúdo do arquivo. OFX é reconhecido pelo CONTEÚDO (um .txt também pode ser OFX); o resto é tratado como CSV
  function lerExtrato(texto) {
    const limpo = String(texto == null ? '' : texto).replace(/^﻿/, '');
    const ehOfx = /<STMTTRN>/i.test(limpo) || /<OFX>/i.test(limpo);
    const r = ehOfx ? lerOfx(limpo) : lerCsv(limpo);
    return { formato: ehOfx ? 'ofx' : 'csv', linhas: r.linhas, ignoradas: r.ignoradas };
  }

  // Separa o que já existe na conta (mesma data, descrição, valor e tipo) do que é novo. Compara por contagem: duas compras
  // idênticas no mesmo dia continuam sendo duas; só some o que o app já tem.
  function separarRepetidas(linhas, existentes) {
    const chave = (data, desc, valorAbs, tipo) => data + '|' + String(desc || '').trim().toLowerCase() + '|' + arred(Math.abs(valorAbs)).toFixed(2) + '|' + tipo;
    const contagem = new Map();
    (existentes || []).forEach((t) => {
      const d = String(t.date || '').slice(0, 10);
      const k = chave(d, t.desc, Number(String(t.val).replace(',', '.')) || 0, t.type);
      contagem.set(k, (contagem.get(k) || 0) + 1);
    });
    const novas = []; const repetidas = [];
    linhas.forEach((l) => {
      const k = chave(l.date, l.desc, l.val, l.val >= 0 ? 'in' : 'out');
      const disponivel = contagem.get(k) || 0;
      if (disponivel > 0) { contagem.set(k, disponivel - 1); repetidas.push(l); } else novas.push(l);
    });
    return { novas, repetidas };
  }

  // Categoria de cada linha: a escolhida pelo usuário se for do mesmo tipo (receita/despesa); senão uma categoria padrão do tipo certo
  function categoriaDaLinha(linha, escolhida, categorias) {
    const tipoLinha = linha.val >= 0 ? 'receita' : 'despesa';
    const lista = Array.isArray(categorias) ? categorias : [];
    const sel = lista.find((c) => c.name === escolhida);
    if (sel && (sel.type || 'despesa') === tipoLinha) return escolhida;
    const doTipo = lista.filter((c) => (c.type || 'despesa') === tipoLinha);
    const padrao = doTipo.find((c) => /^outr[oa]s?( receitas)?$/i.test(c.name));
    return (padrao || doTipo[0] || sel || {}).name || escolhida;
  }

  return { normalizarData, lerValor, dividirLinha, detectarSeparador, lerCsv, lerOfx, lerExtrato, separarRepetidas, categoriaDaLinha };
});
