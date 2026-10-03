-- Esquema do Vinil no Supabase. Cole inteiro no SQL Editor do projeto e rode.
-- Cada tabela guarda o registro completo em "data" (JSON) e é isolada por
-- usuário via Row Level Security: ninguém lê ou altera dados de outro.

create table if not exists public.artists (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  uid        text not null,
  parent_uid text,
  data       jsonb not null,
  updated_at bigint not null,          -- relógio do aparelho (ms), decide quem ganha
  synced_at  timestamptz not null default now(), -- relógio do servidor, usado para "o que mudou desde"
  primary key (user_id, uid)
);

create table if not exists public.albums (like public.artists including all);
create table if not exists public.copies (like public.artists including all);
create table if not exists public.settings (like public.artists including all);

create table if not exists public.tombstones (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  uid        text not null,
  table_name text not null,
  deleted_at bigint not null,
  synced_at  timestamptz not null default now(),
  primary key (user_id, table_name, uid)
);

-- synced_at sempre reflete a última gravação no servidor (inclusive em upserts).
create or replace function public.set_synced_at() returns trigger as $$
begin
  new.synced_at := now();
  return new;
end;
$$ language plpgsql;

do $$
declare t text;
begin
  foreach t in array array['artists', 'albums', 'copies', 'settings', 'tombstones'] loop
    execute format('drop trigger if exists set_synced_at on public.%I', t);
    execute format('create trigger set_synced_at before insert or update on public.%I for each row execute function public.set_synced_at()', t);
    execute format('create index if not exists %I on public.%I (user_id, synced_at)', t || '_synced_idx', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "dono" on public.%I', t);
    execute format('create policy "dono" on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Keep-alive: o plano gratuito pausa projetos "sem atividade" por 7 dias, e uma
-- simples leitura com a chave anon não bastou. A função abaixo faz uma
-- gravação real (atualiza um carimbo de data) e pode ser chamada pela chave
-- anon via POST /rest/v1/rpc/keepalive. A tabela tem RLS ligada e nenhuma
-- política: só a função (security definer) consegue mexer nela.
create table if not exists public.keepalive (
  id        int primary key,
  pinged_at timestamptz not null default now(),
  pings     bigint not null default 0
);
insert into public.keepalive (id) values (1) on conflict do nothing;
alter table public.keepalive enable row level security;

-- Histórico de pings: cada chamada INSERE uma linha nova (uma atualização da
-- mesma linha, 2x por dia, ainda rendeu aviso de pausa em out/2026). A função
-- apaga o que passar de 500 linhas. A chave anon pode LER esta tabela (mais
-- uma consulta real por rodada); gravar, só pela função.
create table if not exists public.keepalive_log (
  id        bigserial primary key,
  pinged_at timestamptz not null default now(),
  source    text
);
alter table public.keepalive_log enable row level security;
drop policy if exists "leitura" on public.keepalive_log;
create policy "leitura" on public.keepalive_log for select to anon, authenticated using (true);

create or replace function public.keepalive(source text default null) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare t timestamptz;
begin
  update public.keepalive set pinged_at = now(), pings = pings + 1 where id = 1 returning pinged_at into t;
  insert into public.keepalive_log (source) values (coalesce(source, 'rpc'));
  delete from public.keepalive_log
    where id not in (select id from public.keepalive_log order by id desc limit 500);
  return t;
end;
$$;
drop function if exists public.keepalive();
revoke all on function public.keepalive(text) from public;
grant execute on function public.keepalive(text) to anon, authenticated;
