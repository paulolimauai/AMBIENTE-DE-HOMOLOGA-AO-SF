-- Supabase: dados financeiros "Meus Dados" do Nexus Financeiro Hub
-- Rode este script uma vez no SQL Editor do Supabase (ou via `supabase db push`).

create table if not exists public.nexus_dados_financeiros (
  email       text primary key,
  dados       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- Índice de atualização para ordenação/sincronização
create index if not exists idx_nexus_dados_financeiros_updated_at
  on public.nexus_dados_financeiros (updated_at desc);

-- RLS: o servidor usa service_role (bypassa RLS). Se quiser expor leitura
-- direta ao usuário final via Supabase Auth, ajuste as policies conforme o modelo de auth.
alter table public.nexus_dados_financeiros enable row level security;

-- Service role já ignora RLS; políticas abaixo só valem para anon/authenticated.
-- Sem policies = acesso negado para anon key (recomendado: dados só via servidor).
