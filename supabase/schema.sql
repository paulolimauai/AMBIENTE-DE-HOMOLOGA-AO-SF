-- Usuários (contas)
create table if not exists public.usuarios (
  id bigserial primary key,
  name text not null,
  email text not null unique,
  password text not null,
  role text not null default 'Usuário',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_login timestamptz,
  cpf text,
  phone text,
  birth_date text,
  terms_accepted boolean not null default true,
  device_type text not null default 'Computador',
  must_change_password boolean default false,
  last_ip text,
  trial_started_at timestamptz,
  subscription_plan text,
  subscription_status text default 'trial',
  subscription_expires_at timestamptz,
  subscription_method text,
  subscription_payment_id text
);
create unique index if not exists usuarios_cpf_key on public.usuarios ((regexp_replace(coalesce(cpf,''), '\D', '', 'g'))) where cpf is not null and cpf <> '';

-- Dados financeiros por usuário (JSON consolidado)
create table if not exists public.dados_financeiros (
  id bigserial primary key,
  email text not null unique,
  dados jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- "Meus Dados" — espelho Supabase usado pela sincronização do servidor
create table if not exists public.nexus_dados_financeiros (
  email text primary key,
  dados jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists idx_nexus_dados_financeiros_updated_at on public.nexus_dados_financeiros (updated_at desc);

-- Transações financeiras
create table if not exists public.transacoes (
  id bigserial primary key,
  user_email text not null,
  tx_id integer,
  descricao text not null,
  valor numeric(18,2) not null,
  data_transacao text not null,
  categoria text,
  tipo text not null,
  conta text,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ix_transacoes_user_email on public.transacoes (user_email);

-- Contas bancárias
create table if not exists public.contas_bancarias (
  id bigserial primary key,
  user_email text not null,
  account_id integer,
  nome text not null,
  tipo text not null default 'Conta Corrente',
  saldo numeric(18,2) not null default 0,
  cor text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ix_contas_bancarias_email on public.contas_bancarias (user_email);

-- Categorias
create table if not exists public.categorias (
  id bigserial primary key,
  user_email text not null,
  nome text not null,
  tipo text not null default 'despesa',
  icone text,
  cor text,
  created_at timestamptz not null default now()
);
create index if not exists ix_categorias_email on public.categorias (user_email);

-- Log de auditoria do sistema
create table if not exists public.system_logs (
  id bigserial primary key,
  "timestamp" timestamptz not null default now(),
  user_name text,
  user_email text,
  action text not null,
  entity text not null,
  details text not null
);
create index if not exists ix_system_logs_email on public.system_logs (user_email);
create index if not exists ix_system_logs_timestamp on public.system_logs ("timestamp" desc);

-- Ordens de serviço / chamados
create table if not exists public.ordens_servico (
  id bigserial primary key,
  protocol text not null unique,
  client_name text not null,
  client_email text not null,
  client_phone text,
  client_cpf text,
  service_type text not null default 'Melhoria no Sistema',
  priority text not null default 'Normal',
  title text not null,
  description text not null,
  status text not null default 'Pendente',
  admin_notes text default '',
  tecnico_responsavel text,
  assumido_em text,
  canal_atendimento text default 'Portal Web',
  concluido_em text,
  sla text default '2 Horas',
  asset text default 'Nenhum',
  time_spent double precision default 0,
  solution text,
  timeline text,
  ticket_type text,
  fila text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ix_ordens_servico_email on public.ordens_servico (client_email);

-- Técnicos de suporte
create table if not exists public.tecnicos_suporte (
  id bigserial primary key,
  name text not null,
  email text not null unique,
  phone text,
  specialty text not null default 'Suporte Geral',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Registro de CPFs (base cadastral / Receita)
create table if not exists public.cpf_registry (
  id bigserial primary key,
  cpf text not null unique,
  nome text,
  data_nascimento text,
  phone text,
  email text,
  situacao text default 'REGULAR',
  regiao_fiscal text,
  origem text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS: o servidor usa service_role/anon key com bypass; sem policies = acesso negado
-- para anon/authenticated. O acesso à aplicação continua sendo feito pelo servidor Node.
alter table public.usuarios enable row level security;
alter table public.dados_financeiros enable row level security;
alter table public.nexus_dados_financeiros enable row level security;
alter table public.transacoes enable row level security;
alter table public.contas_bancarias enable row level security;
alter table public.categorias enable row level security;
alter table public.system_logs enable row level security;
alter table public.ordens_servico enable row level security;
alter table public.tecnicos_suporte enable row level security;
alter table public.cpf_registry enable row level security;
