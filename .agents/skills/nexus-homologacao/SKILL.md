---
name: nexus-homologacao
description: >-
  Guia operacional completo, runbooks e procedimentos do ambiente Nexus Financeiro Hub (Homologação SF).
  Use esta skill para entender a arquitetura do servidor Node.js, a sincronização em tempo real entre o Render e o Microsoft SQL Server interno via ODBC, as regras de auto-execução permanente, o tratamento de fuso horário de Brasília (UTC-3), e as diretrizes visuais do Modo Claro e Modo Escuro.
---

# Nexus Financeiro Hub - Manual e Procedimentos da Skill

Esta skill define os runbooks, arquitetura e fluxos de trabalho específicos do projeto **Nexus Financeiro Hub / AMBIENTE DE HOMOLOGAÇÃO SF**.

---

## 1. Arquitetura e Conexões

- **Servidor Principal**: [`server.js`](file:///c:/AMBIENTE%20DE%20HOMOLOGA%C3%87AO/server.js) rodando em Node.js na porta `3000`.
- **Banco de Dados Primário**: Microsoft SQL Server local/interno (`localhost`) via `ODBC Driver 17 for SQL Server`, banco `AMBIENTE DE HOMOLOGAÇAO SF`.
- **Fallback Local e Cache**: Arquivos JSON locais ([`local_users.json`](file:///c:/AMBIENTE%20DE%20HOMOLOGA%C3%87AO/local_users.json), [`local_database_data.json`](file:///c:/AMBIENTE%20DE%20HOMOLOGA%C3%87AO/local_database_data.json), [`local_ordens_servico.json`](file:///c:/AMBIENTE%20DE%20HOMOLOGA%C3%87AO/local_ordens_servico.json)).
- **Nuvem Render**: Sincronizador autônomo periódico (`syncWithRenderCloud`) executado a cada 3 segundos via endpoint `GET /api/users`.

---

## 2. Regras Operacionais Críticas

### 2.1 Sincronização de Usuários e `last_login`
- Todos os cadastros feitos na nuvem (Render) são capturados e persistidos no SQL Server interno.
- Pings de login acionam `/api/user/login-ping`, registrando data e hora em horário oficial de Brasília (`America/Sao_Paulo`, UTC-3) com fallback via `getBrasiliaSqlString()` e `getBrasiliaIsoString()`.

### 2.2 Tema e Contraste Visual
- **Modo Escuro (Dark Mode)**: Tema Cyber Glass 4K nativo com fundos translúcidos escuros e gradientes azuis/esmeralda/âmbar.
- **Modo Claro (Light Mode)**: Todos os textos, títulos (`h1`-`h6`), parágrafos (`p`), labels, células de tabela, descrições de transação e badges secundárias utilizam **preto sólido (`#000000 !important`)** para legibilidade absoluta e contraste máximo.

### 2.3 Auto-Approve, Auto-Exec & Auto-Git Sync
- Não pedir confirmação ao usuário para comandos de terminal, deploys ou edições de arquivo.
- Validar sintaxe automaticamente com `node --check server.js`.
- Reiniciar o processo de background quando houver alteração em `server.js`.
- Efetuar commit e push para o repositório remoto Git (`origin main`) ao final de cada alteração.

---

## 3. Comandos Úteis e Verificações Rápidas

- **Checar sintaxe do servidor**:
  ```bash
  node --check server.js
  ```
- **Verificar integridade da API e banco**:
  ```powershell
  Invoke-RestMethod -Uri http://localhost:3000/api/health
  ```
- **Encerrar processo travado na porta 3000**:
  ```cmd
  netstat -ano | findstr :3000 | findstr LISTENING
  taskkill /F /PID <PID>
  ```
- **Executar servidor como daemon**:
  ```bash
  node server.js
  ```
