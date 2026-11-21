'use strict';

/**
 * Regras puras (sem rede, sem disco) para decidir QUAL senha vale quando a mesma conta existe em mais de um lugar:
 * o arquivo da nuvem (Render), o SQL Server do PC, o espelho local do PC e o Supabase.
 *
 * Por que existe: a sincronização nuvem <-> PC roda a cada 10 s e, antes, quem enviava por último ganhava. Uma senha criada na
 * nuvem entre a leitura e o envio do PC era trocada de volta pelo hash antigo do SQL Server (e o Supabase, que recebe o que o
 * arquivo tem, guardava o hash antigo também). O usuário tinha de pedir "esqueci a senha" de novo, e de novo.
 *
 * A regra agora é uma só: vale a senha que foi trocada por último (campo `password_changed_at`, gravado em toda troca).
 * Sem relógio em nenhum dos lados (cadastros antigos), o chamador escolhe o lado ("noClock") e a decisão fica estável.
 */

const HASH_RE = /^scrypt:[0-9a-f]+:[0-9a-f]+$/i;

/** Hash de senha no formato do sistema (scrypt:<sal>:<chave>). Texto puro, MD5 e SHA-256 antigos não contam como "senha gravada". */
function isHash(value) { return typeof value === 'string' && HASH_RE.test(value.trim()); }

/** Momento (ms) da última troca de senha; 0 quando não há marca ou ela é inválida. */
function clockMs(user) {
  const raw = user && user.password_changed_at;
  if (raw === undefined || raw === null || raw === '') return 0;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) && t > 0 ? t : 0;
}

/**
 * Decide entre a credencial que já está num lugar (`existing`) e a que está chegando (`incoming`).
 *   source: 'existing' | 'incoming' | 'same'
 * Regras, nesta ordem:
 *   1. o que chega não é um hash válido → fica o que existe (nunca apaga senha);
 *   2. não existe hash → vale o que chega;
 *   3. hashes iguais → nada a trocar (guarda o relógio mais novo);
 *   4. os dois têm relógio → o mais novo vence (empate fica com o que existe);
 *   5. só um tem relógio → quem tem relógio vence (foi trocada depois que o relógio passou a existir);
 *   6. nenhum tem relógio (cadastro antigo) → opts.noClock ('existing' padrão, ou 'incoming').
 */
function pickPassword(existing, incoming, opts) {
  const noClock = opts && opts.noClock === 'incoming' ? 'incoming' : 'existing';
  const eHash = isHash(existing && existing.password) ? String(existing.password).trim() : '';
  const iHash = isHash(incoming && incoming.password) ? String(incoming.password).trim() : '';
  const eClock = clockMs(existing);
  const iClock = clockMs(incoming);

  let source;
  if (!iHash) source = 'existing';
  else if (!eHash) source = 'incoming';
  else if (eHash === iHash) source = 'same';
  else if (eClock && iClock) source = iClock > eClock ? 'incoming' : 'existing';
  else if (iClock) source = 'incoming';
  else if (eClock) source = 'existing';
  else source = noClock;

  if (source === 'incoming') return { source, password: iHash, password_changed_at: iClock ? incoming.password_changed_at : undefined };
  if (source === 'same') return { source, password: eHash, password_changed_at: (iClock > eClock ? incoming : existing).password_changed_at || undefined };
  return { source, password: eHash || (existing && existing.password) || '', password_changed_at: (existing && existing.password_changed_at) || undefined };
}

/**
 * A credencial guardada no Supabase (`remote`) deve substituir a do servidor (`local`) no login?
 * Só quando é mais nova (ou quando a conta nem existe aqui). Sem relógio nos dois lados, o servidor mantém a sua:
 * uma senha antiga do Supabase nunca volta a valer só porque a pessoa a digitou.
 */
function shouldAdoptRemote(local, remote) {
  if (!remote || !isHash(remote.password)) return false;
  if (!local) return true;
  return pickPassword(local, remote, { noClock: 'existing' }).source === 'incoming';
}

/**
 * Senha divergente entre o SQL Server (`sqlUser`, a fonte da verdade) e o espelho local (`mirrorUser`).
 * O aplicativo grava a senha nos dois lugares juntos e as rotas de troca falham fechado quando o UPDATE no banco
 * não acontece, então hashes diferentes entre os dois só existem quando a senha foi trocada DIRETO no banco (SSMS).
 * Nesse caso o banco manda: devolve { password, password_changed_at } para o espelho adotar o hash do SQL com um
 * carimbo NOVO (maior que o do espelho e que agora), para ele vencer a disputa do relógio na nuvem e no Supabase —
 * antes o hash do banco era enviado com o carimbo antigo do espelho e o site seguia aceitando só a senha velha.
 * Devolve null quando os dois já concordam ou quando o SQL não tem hash válido
 * (texto puro legado nunca é propagado).
 */
function sqlPasswordAdoption(sqlUser, mirrorUser, nowMs) {
  const sqlHash = isHash(sqlUser && sqlUser.password) ? String(sqlUser.password).trim() : '';
  const mirHash = isHash(mirrorUser && mirrorUser.password) ? String(mirrorUser.password).trim() : '';
  if (!sqlHash || sqlHash === mirHash) return null;
  const agora = Number.isFinite(nowMs) ? nowMs : Date.now();
  const carimbo = new Date(Math.max(agora, clockMs(mirrorUser) + 1)).toISOString();
  return { password: sqlHash, password_changed_at: carimbo };
}

module.exports = { isHash, clockMs, pickPassword, shouldAdoptRemote, sqlPasswordAdoption };
