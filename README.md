# Nexus Financeiro Hub — Sistema de Gestão Financeira Pessoal #

## Visão Geral
O **Nexus Financeiro Hub** é um sistema completo de gestão financeira pessoal, orçamentos, cartões, metas e relatórios, construído com Node.js nativo e **Microsoft SQL Server**.

## Arquitetura & Segurança Implementada
- **Autenticação Segura por Token (Bearer Token):** Todas as rotas da API (`/api/data`, `/api/users`, `/api/admin/all-data`) são protegidas e exigem sessão ativa.
- **Hashing de Senha com Salt (scrypt / PBKDF2):** Nenhuma senha é gravada em texto puro. Migração transparente automática para senhas legadas no login.
- **Proteção contra Injeção de Scripts (XSS):** Todo o conteúdo de entrada do usuário é sanitizado.
- **Persistência no Microsoft SQL Server & Resiliência:**
  - `usuarios`: Armazena cadastro (id, name, email, password hash, role, active).
  - `dados_financeiros`: Armazena transações, contas, orçamentos, metas, alertas e anexos por usuário em coluna `NVARCHAR(MAX)`.
  - `system_logs`: Auditoria e logs de sistema.
  - `ordens_servico`: Protocolos e chamados de serviço.

## Como Rodar Localmente

1. Instale as dependências:
   ```bash
   npm install
   ```
2. Configure o arquivo `.env`:
   ```bash
   copy .env.example .env
   ```
   O sistema conecta automaticamente ao banco local `AMBIENTE DE HOMOLOGAÇAO SF` via autenticação do Windows (Trusted_Connection).
3. Inicie o servidor:
   ```bash
   npm start
   ```
4. Acesse no navegador:
   ```
   http://localhost:3000
   ```
