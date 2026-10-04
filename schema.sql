-- =====================================================================
-- Malla horaria · esquema de Supabase
-- Pégalo completo en  SQL Editor → New query → Run.
-- Se puede ejecutar más de una vez sin perder datos.
-- =====================================================================

-- Usuarios (código + nombre + clave guardada como hash)
create table if not exists app_users (
  code text primary key,
  name text not null,
  pass_hash text not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- Personal
create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

-- Turnos habilitados
create table if not exists shifts (
  code text primary key,
  start_time text not null,
  end_time text not null,
  sort int not null default 0
);

-- Entradas y salidas (también guarda los códigos C, D, F, INV, INC, VAC, AUS, LIC)
create table if not exists entries (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  work_date date not null,
  start_time text,
  end_time text,
  shift_code text,
  extra_minutes int not null default 0,
  unique (employee_id, work_date)
);
alter table entries add column if not exists code text;
alter table entries add column if not exists counter_min int not null default 0;
alter table entries add column if not exists calc jsonb;
alter table entries add column if not exists created_at timestamptz not null default now();
alter table entries add column if not exists updated_at timestamptz not null default now();
alter table entries add column if not exists updated_by text;
alter table entries add column if not exists last_log_id bigint;
create index if not exists entries_date_idx on entries (work_date);

-- Respuestas a los avisos (descanso doble que se descuenta, semana partida)
create table if not exists decisions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  kind text not null,
  ref text not null,
  value jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  unique (employee_id, kind, ref)
);

-- Horas manuales (positivas, negativas y anulaciones)
create table if not exists adjustments (
  id uuid primary key,
  employee_id uuid not null references employees(id) on delete cascade,
  period text not null,            -- mes en que se registró, 'AAAA-MM'
  minutes int not null,
  reason text not null,
  kind text not null default 'ajuste',
  cancels_id uuid,
  user_code text,
  user_name text,
  ts timestamptz not null default now()
);

-- Registro de movimientos (consola). Solo se puede agregar y consultar.
create table if not exists log (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  user_code text,
  user_name text,
  action text not null,
  employee_id uuid,
  employee_name text,
  ref_date date,
  before_val text,
  after_val text,
  comment text,
  annuls_id bigint,
  detail jsonb
);
create index if not exists log_ts_idx on log (ts);

-- Turnos iniciales
insert into shifts (code, start_time, end_time, sort) values
  ('APERTURA 2', '10:00', '18:00', 0),
  ('APERTURA 3', '11:00', '19:00', 1),
  ('CIERRE 2',   '12:00', '20:00', 2),
  ('CIERRE 3',   '13:00', '21:00', 3)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- Acceso desde la página (clave "anon"). Uso interno: quien tenga el enlace
-- y un código de usuario puede trabajar. El registro NO permite editar ni borrar.
-- ---------------------------------------------------------------------
alter table app_users   enable row level security;
alter table employees   enable row level security;
alter table shifts      enable row level security;
alter table entries     enable row level security;
alter table decisions   enable row level security;
alter table adjustments enable row level security;
alter table log         enable row level security;

drop policy if exists "malla app_users"   on app_users;
drop policy if exists "malla employees"   on employees;
drop policy if exists "malla shifts"      on shifts;
drop policy if exists "malla entries"     on entries;
drop policy if exists "malla decisions"   on decisions;
drop policy if exists "malla adjustments" on adjustments;
drop policy if exists "malla adjustments insert" on adjustments;
drop policy if exists "malla log read"    on log;
drop policy if exists "malla log insert"  on log;

create policy "malla app_users"   on app_users   for all using (true) with check (true);
create policy "malla employees"   on employees   for all using (true) with check (true);
create policy "malla shifts"      on shifts      for all using (true) with check (true);
create policy "malla entries"     on entries     for all using (true) with check (true);
create policy "malla decisions"   on decisions   for all using (true) with check (true);
create policy "malla adjustments" on adjustments for select using (true);
create policy "malla adjustments insert" on adjustments for insert with check (true);
create policy "malla log read"    on log for select using (true);
create policy "malla log insert"  on log for insert with check (true);
-- (sin políticas de update ni delete en "log" ni en "adjustments": quedan bloqueados)
