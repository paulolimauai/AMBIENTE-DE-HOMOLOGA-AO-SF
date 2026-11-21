# MANUAL TÉCNICO DO SISTEMA — Nexus Financeiro Hub

> Documento interno de infraestrutura e operação. **Não publicar no site** e **não commitar segredos** (senhas, chaves, tokens ficam só no `.env` local e nos painéis Render/Supabase/Cloudflare).
> Última revisão: novembro de 2026.

---

## 1. Visão geral da arquitetura

```
                         INTERNET
                            │
              ┌─────────────▼──────────────┐
              │  DNS: nexusfinanceirohub   │
              │  .com.br (+ www)           │
              └─────────────┬──────────────┘
                            │  CNAME → Cloudflare
              ┌─────────────▼──────────────┐
              │  CLOUDFLARE WORKER         │  worker.js + wrangler.jsonc
              │  • proxy transparente p/   │  • Cron a cada 5 min → GET /ping
              │    o backend               │    (acorda o Render)
              │  • serve estáticos de dist/│  • APP_ORIGIN = backend
              └─────────────┬──────────────┘
                            │ HTTPS
              ┌─────────────▼──────────────┐
              │  RENDER (nuvem, produção)   │  render.yaml → serviço "sistema-financeiro"
              │  node server.js            │  plano 0.5c-512mb, PORT=10000
              │  https://ambiente-de-      │  healthCheckPath=/ping
              │  homologa-ao-sf.onrender.com│  autoDeploy: push na main
              │  disco /var/data (1 GB)    │  JSONs de estado + .nexus_*
              └──────┬───────────┬──────────┘
                     │           │
        sync (10s)   │           │  espelho durável
                     ▼           ▼
        ┌─────────────────┐  ┌──────────────────┐
        │ PC LOCAL        │  │ SUPABASE (nuvem) │
        │ "AMBIENTE DE    │  │ Postgres gerenciado│
        │  HOMOLOGAÇAO"   │  │ projeto nexus    │
        │ node server.js  │  └──────────────────┘
        │ porta 3000      │
        │ SQL Server      │
        │ "AMBIENTE DE    │
        │  HOMOLOGAÇAO SF"│
        └─────────────────┘
```

**Regra de ouro:** existem DUAS instâncias do `server.js` — a do **Render** (produção, atende o domínio) e a do **PC local** (homologação, porta 3000). Elas se sincronizam entre si e com o Supabase. Mexer só numa ponta dessincroniza o sistema.

---

## 2. Endereços e rotas públicas

| Endereço | O que é |
|---|---|
| `https://nexusfinanceirohub.com.br` | Domínio oficial (Cloudflare → Worker → Render) |
| `https://www.nexusfinanceirohub.com.br` | Idem (custom domain no wrangler) |
| `https://ambiente-de-homologa-ao-sf.onrender.com` | Backend direto no Render (origem do proxy) |
| `/inicio` (ou `/site`) | Site institucional antes do login |
| `/manual` | Manual do usuário (página + botões de download PDF/HTML) |
| `/login.html` | Tela de entrada/cadastro |
| `/suporte` (ou `/glpi`) | Central de Serviços pública |
| `/termos.html`, `/privacidade.html` | Páginas legais |
| `/ping` | Health check simples (acorda/valida o Render) |
| `/api/health` | Saúde da API + banco |
| `/admin-assinaturas-glpi` | Painel admin de assinaturas (URL amigável → `admin-assinaturas-glpi.html`) |
| `/admin-site.html` | Admin do site |
| `robots.txt`, `sitemap.xml` | SEO gerados dinamicamente (SITE_PUBLIC_URL) |

No PC local, tudo o mesmo em `http://localhost:3000`.

---

## 3. Componentes e onde cada um vive

### 3.1 Cloudflare (borda / DNS / keep-awake)
- **Worker:** `worker.js` + `wrangler.jsonc`, projeto `ambiente-de-homologa-ao-sf`.
- Faz proxy de tudo que não está em `dist/` para `APP_ORIGIN` (padrão: URL do Render).
- **Cron Trigger a cada 5 min** chama `/ping` no Render — é o que ACORDA o serviço quando ele dorme (Render suspende após ~15 min sem tráfego).
- Deploy do Worker: `npx wrangler deploy` (conta Cloudflare do dono). Build de `dist/`: `npm run build` (`scripts/build.js`).
- Variável `APP_ORIGIN` no painel Cloudflare → aponta para o backend (trocar backend = mudar essa variável).

### 3.2 Render (produção Node)
- Serviço `sistema-financeiro`, blueprint `render.yaml`.
- `autoDeploy: true` → **todo `git push origin main` dispara deploy**.
- `healthCheckPath: /ping` → só troca a versão nova depois que ela responde (zero downtime).
- Disco persistente `nexus-cadastro-data` montado em `/var/data` (`NEXUS_DATA_DIR`): JSONs de estado, `.nexus_jwt_secret`, `.nexus_sync_token`, backups.
- Variáveis no painel Render → Environment (nunca no Git): `JWT_SECRET`, `NEXUS_SYNC_TOKEN`, `NEXUS_OWNER_EMAIL`, `SUPABASE_*`, `GOOGLE_*`.

### 3.3 PC local (homologação)
- Pasta `C:\AMBIENTE DE HOMOLOGAÇAO`, `node server.js`, porta **3000**.
- Inicialização: `iniciar_servidor.bat` (chama `iniciar_servidor_segundo_plano.vbs`, que sobe o node oculto).
- Banco: **Microsoft SQL Server local**, banco `AMBIENTE DE HOMOLOGAÇAO SF`, via `ODBC Driver 17` (Trusted_Connection/Windows Auth; também há login SQL dedicado `MSSQL_USER`/`MSSQL_PASSWORD` com db_owner).
- Scripts auxiliares: `ativar_tcp_sqlserver.bat`, `ativar_login_sql.bat` (ligar TCP/IP e modo misto do SQL Server).
- Arquivos de estado locais (fallback se nuvem/banco caírem): `local_users.json`, `local_database_data.json`, `local_ordens_servico.json`, `local_*.json`, `pending_logins.json`, `system_logs.json`.
- Backups: `backups_financeiros/` (histórico de dados financeiros), `backups_contas/`.

### 3.4 Supabase (espelho durável em nuvem)
- Projeto Supabase com `supabase/schema.sql` (tabelas já criadas).
- `supabase-sync.js` envia cada gravação ao Supabase em ~0,4 s; o que não confirmou fica em `supabase_sync_state.json` e é reenviado até o ack (nada se perde em queda/restart).
- Em disco novo/vazio, `restoreMissingFiles()` recompõe os arquivos a partir do Supabase.
- Tabelas: `usuarios`, `transacoes`, `contas_bancarias`, `categorias`, `ordens_servico`, `tecnicos_suporte`, `cpf_registry`, `system_logs`, `dados_financeiros`, `nexus_dados_financeiros`.

### 3.5 Microsoft SQL Server (banco principal do PC)
- `mssql-sync-client.js` implementa um "PostgREST-like" sobre o pool MSSQL: o motor de espelhamento (`supabase-sync.js`) grava no SQL local com o mesmo formato do Supabase.
- `sql-vigia.js`: detecta edição feita DIRETO no SQL (SSMS/sqlcmd) e propaga para espelho → nuvem → Supabase. Regra: mudança externa só é adotada se se repetir igual em duas leituras.
- Tabelas principais: `usuarios`, `dados_financeiros` (JSON por usuário), `system_logs`, `ordens_servico`.

---

## 4. Sincronização (os fluxos que mantêm tudo igual)

| Fluxo | Quem faz | Intervalo |
|---|---|---|
| Render → PC local (usuários/dados) | `syncWithRenderCloud` no server.js via `NEXUS_SYNC_TOKEN` | ~3–10 s |
| PC local → Supabase (espelho durável) | `supabase-sync.js` (via `writeJsonFile`) | ~0,4 s por gravação |
| PC local → SQL Server | pool `mssql` + `mssql-sync-client.js` | na gravação + reconciliação |
| Edição direta no SQL → app/nuvem | `sql-vigia.js` | leitura contínua |
| Keep-alive Render | keepalive.js (interno, ~4 min) + Worker cron (5 min) | contínuo |
| Auto-sync Git local | `auto-sync.js` (`npm run auto:sync`, debounce 2,5 s) | sob demanda |

**Token de sincronização:** `NEXUS_SYNC_TOKEN` (ou derivado de `JWT_SECRET` via `deriveSyncToken`). Tem que ser o MESMO no `.env` do PC e no painel do Render — se divergir, a sincronização PC↔nuvem morre com 401.

**Login/ping:** `POST /api/user/login-ping` grava `last_login` em horário de Brasília (`America/Sao_Paulo`, UTC-3).

---

## 5. Variáveis de ambiente (nomes — valores só no `.env` e painéis)

### `.env` local (PC) — ver `.env.example`
`PORT`, `APP_BASE_URL`, `JWT_SECRET`, `NEXUS_SYNC_TOKEN`, `NEXUS_OWNER_EMAIL`, `NEXUS_RESERVED_EMAILS`, `DB_TYPE`, `MSSQL_SERVER`, `MSSQL_DATABASE`, `MSSQL_DRIVER`, `MSSQL_USER`, `MSSQL_PASSWORD`, `MSSQL_TRUSTED_CONNECTION`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI`, `SMTP_HOST/PORT/USER/PASS` (recuperação de senha), `NEXUS_SITE_INICIAL`, `NEXUS_DISABLE_DB`, `NEXUS_DISABLE_SUPABASE`, `NEXUS_KEEPALIVE`, `NEXUS_DATA_DIR`, `CPF_API_*`, `GOOGLE_SITE_VERIFICATION`.

### Painel Render → Environment
`NODE_ENV`, `PORT=10000`, `NEXUS_DATA_DIR=/var/data`, `JWT_SECRET`, `NEXUS_SYNC_TOKEN`, `NEXUS_OWNER_EMAIL`, `SUPABASE_*`, `GOOGLE_*`.

### Painel Cloudflare → Worker
`APP_ORIGIN` (backend). Domínios: `nexusfinanceirohub.com.br`, `www.`.

> ⚠️ `SUPABASE_SERVICE_ROLE_KEY` e `JWT_SECRET` dão acesso TOTAL. Se vazarem: gerar novos nos painéis e atualizar os dois lados.

---

## 6. Deploy e rotinas

### Publicar uma alteração
1. `git status` → revisar → `git add .` → `git commit` → `git push origin main`.
2. O Render faz autoDeploy (build `npm install`, start `npm start`, health `/ping`).
3. Para o PC local refletir: reiniciar o processo da porta 3000 (o servidor lê os arquivos em memória/cache por mtime).
4. Mudança em `worker.js`/`wrangler.jsonc`/`dist`: `npm run build` + `npx wrangler deploy`.
5. Pre-commit hook (`scripts/proteger_git.js`) **bloqueia** commit com segredo/e-mail real — corrigir o arquivo, nunca usar `--no-verify`.

### Verificações rápidas
```powershell
# Sintaxe de tudo
npm test
# Saúde local
curl.exe http://localhost:3000/api/health
# Saúde produção
curl.exe https://nexusfinanceirohub.com.br/ping
curl.exe https://ambiente-de-homologa-ao-sf.onrender.com/ping
```

### Rotinas de manutenção
- **Backups financeiros:** automáticos em `backups_financeiros/` (fora do Git); restaurar via `pickBest()` quando o principal falha.
- **Logs:** `system_logs.json` (auditoria, ~1000 entradas locais; histórico completo no Supabase) e console do `node server.js`.
- **Poda de dados:** `pending_logins.json`, `sql_vigia_estado.json`, `supabase_sync_state.json` são estados de sincronização — não apagar enquanto o servidor roda.
- **Disco Render:** 1 GB em `/var/data`; se encher, limpar estados antigos (manter `.nexus_jwt_secret`, `.nexus_sync_token`, JSONs de dados).

---

## 7. Troubleshooting

| Sintoma | Provável causa | O que fazer |
|---|---|---|
| Site fora / timeout | Render dormindo ou deploy | `curl /ping`; aguardar ~50 s; checar painel Render (deploy falhou? env var?) |
| Login funciona no PC mas não no site | `NEXUS_SYNC_TOKEN`/`JWT_SECRET` divergentes PC↔Render | comparar variáveis nos dois lados |
| Dados "somem" após restart | restore do Supabase falhou | verificar `supabase_sync_state.json`, `SUPABASE_SERVICE_ROLE_KEY` válida, `restoreMissingFiles` no log |
| Edição no SSMS volta atrás em 10 s | esperado? não — vigia deveria propagar | checar `sql-vigia.js` ativo; mudança precisa repetir igual em 2 leituras |
| Senha de e-mail não chega | SMTP | conferir `SMTP_*` no `.env`/Render |
| Login Google falha | OAuth | `GOOGLE_REDIRECT_URI` deve bater com o cadastrado no Google Cloud |
| PC local não sobe | porta 3000 ocupada / SQL off | `netstat -ano \| findstr :3000`; subir SQL Server (`ativar_tcp_sqlserver.bat`) |
| Imagens/estáticos 404 | arquivo fora de `STATIC_EXACT_FILES`/`/images/` | whitelist em `server.js` (~linha 39198) |
| Commit bloqueado por "segredo" | hook `verificar_segredos.js` | remover o valor real do arquivo |
| Sessões caem ao reiniciar | `.nexus_jwt_secret` não persistiu | conferir `NEXUS_DATA_DIR` gravável |
| Cron keep-alive falha | Cloudflare/Worker | painel Cloudflare → Workers → logs; testar `curl https://dominio/ping` |

---

## 8. Segurança — o que NUNCA fazer

- Nunca commitar `.env`, `.nexus_*`, `local_*.json` com dados reais, `system_logs.json` com dados de clientes.
- Nunca colocar segredo no `render.yaml`, `wrangler.jsonc`, HTML ou código (`sync:false` existe justamente para isso).
- O repositório pode ser **público**: trate todo arquivo commitado como público.
- `service_role` do Supabase = acesso total ao banco; `NEXUS_SYNC_TOKEN` = vira admin da sincronização.
- Não usar `git commit --no-verify` para contornar o hook de segredos.
- Rotas administrativas (`/admin-*`) e `/api/*` são protegidas por token; não expor em links públicos.

---

## 9. Arquivos-chave (mapa rápido)

| Arquivo | Papel |
|---|---|
| `server.js` (~40 mil linhas) | Backend inteiro: rotas, API, páginas, SQL, sync, segurança |
| `page.html` | App principal (SPA servido em `/`) |
| `site-inicial.html/.css/.js` | Site público `/inicio` |
| `glpi-enterprise.html` | Central de Serviços (`/suporte`) |
| `login_nexus (1).html` / `login-nexus-v5.html` | Telas de login (variantes) |
| `supabase-sync.js` | Espelho durável → Supabase |
| `mssql-sync-client.js` | Adaptador PostgREST→MSSQL |
| `sql-vigia.js` | Vigia de edição direta no SQL |
| `backup-financeiro.js` | Backup histórico de dados financeiros |
| `keepalive.js` + `worker.js`/`wrangler.jsonc` | Keep-alive Render (interno + Cloudflare) |
| `render.yaml` | Blueprint do serviço Render |
| `supabase/schema.sql` | Schema das tabelas Supabase |
| `menu-topo.js/.css` | Menu superior do app |
| `manual-do-usuario.html` | Manual público (site) |
| `AGENTS.md` / `GEMINI.md` | Regras de operação do agente |
| `.agents/skills/nexus-homologacao/` | Runbook operacional da skill |

---

## 10. Contas e painéis (onde estão as chaves)

| Serviço | Painel | Observação |
|---|---|---|
| GitHub | `github.com/paulolimauai/AMBIENTE-DE-HOMOLOGA-AO-SF` | branch `main`, autoDeploy |
| Render | dashboard.render.com → serviço `sistema-financeiro` | env vars, disco `/var/data`, logs |
| Cloudflare | dash.cloudflare.com → Workers `ambiente-de-homologa-ao-sf` | DNS, `APP_ORIGIN`, cron |
| Supabase | supabase.com → projeto | `service_role` em API settings |
| Google Cloud | console.cloud.google.com | OAuth client + Search Console (GSV) |
| SQL Server | SSMS local | banco `AMBIENTE DE HOMOLOGAÇAO SF` |

> Nenhuma senha/token deste documento está aqui de propósito. Localize-os no `.env` do PC e nos painéis acima.
