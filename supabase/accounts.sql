-- ============================================================
-- Comptes (sur invitation), accès à la radio, mixes enregistrés
-- N'enlève rien à plays / track_info (lecture publique gardée jusqu'au lancement : launch.sql)
-- ============================================================

-- Une fiche par compte, créée à l'inscription (invitation). Les droits ne se changent
-- que côté serveur (fonction admin, clé service_role) : le site ne peut que lire sa propre fiche
create table if not exists public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  email      text not null default '',
  radio      boolean not null default false,  -- accès à la radio et aux mixes faits avec ses titres
  admin      boolean not null default false,  -- peut inviter et donner l'accès radio
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for select to authenticated using (id = (select auth.uid()));

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email) values (new.id, coalesce(new.email, '')) on conflict (id) do nothing;
  return new;
end
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Mixes enregistrés : réglages (ce qu'il faut pour régénérer ou ajuster) et titres retenus
create table if not exists public.mixes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null check (char_length(name) between 1 and 100),
  source      text not null default 'spotify' check (source in ('spotify', 'radio')),
  settings    jsonb not null default '{}',
  tracks      jsonb not null default '[]',
  spotify_url text,
  created_at  timestamptz not null default now()
);
create index if not exists mixes_user_created on public.mixes (user_id, created_at desc);
alter table public.mixes enable row level security;
drop policy if exists "own mixes read"   on public.mixes;
drop policy if exists "own mixes add"    on public.mixes;
drop policy if exists "own mixes change" on public.mixes;
drop policy if exists "own mixes remove" on public.mixes;
create policy "own mixes read"   on public.mixes for select to authenticated using (user_id = (select auth.uid()));
create policy "own mixes add"    on public.mixes for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own mixes change" on public.mixes for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own mixes remove" on public.mixes for delete to authenticated using (user_id = (select auth.uid()));

-- Le compte connecté a-t-il accès à la radio ? (utilisé par launch.sql)
create or replace function public.has_radio() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select radio from public.profiles where id = (select auth.uid())), false)
$$;

-- Comptes avec l'accès radio : lecture de la radio (la lecture publique « anon read » est retirée par launch.sql)
drop policy if exists "radio read" on public.plays;
create policy "radio read" on public.plays for select to authenticated using (public.has_radio());
drop policy if exists "radio read" on public.track_info;
create policy "radio read" on public.track_info for select to authenticated using (public.has_radio());

-- Premier compte admin (après l'avoir invité depuis Authentication > Users) :
-- update public.profiles set admin = true, radio = true where email = 'ton@email';
