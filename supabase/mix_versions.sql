-- ============================================================
-- Versions des playlists enregistrées : une playlist (mixes) a des versions (V1, V2 « + Rock »…),
-- chacune avec ses titres, ses réglages et son lien Spotify si elle y a été créée.
-- À passer après accounts.sql ; reprend les mixes déjà enregistrés comme V1
-- ============================================================

create table if not exists public.mix_versions (
  id          uuid primary key default gen_random_uuid(),
  mix_id      uuid not null references public.mixes on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  n           int  not null check (n > 0),            -- V1, V2…
  label       text not null default '',                -- « Originale », « + Rock », « Régénérée »…
  settings    jsonb not null default '{}',
  tracks      jsonb not null default '[]',
  spotify_url text,
  created_at  timestamptz not null default now(),
  unique (mix_id, n)
);
create index if not exists mix_versions_mix on public.mix_versions (mix_id, n);
alter table public.mix_versions enable row level security;
drop policy if exists "own versions read"   on public.mix_versions;
drop policy if exists "own versions add"    on public.mix_versions;
drop policy if exists "own versions change" on public.mix_versions;
drop policy if exists "own versions remove" on public.mix_versions;
create policy "own versions read"   on public.mix_versions for select to authenticated using (user_id = (select auth.uid()));
-- Une version ne s'ajoute qu'à une playlist du même compte
create policy "own versions add"    on public.mix_versions for insert to authenticated with check (
  user_id = (select auth.uid()) and exists (select 1 from public.mixes m where m.id = mix_id and m.user_id = (select auth.uid())));
create policy "own versions change" on public.mix_versions for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own versions remove" on public.mix_versions for delete to authenticated using (user_id = (select auth.uid()));

-- Playlist : nom, source, dernière modification (pour trier « Tes playlists »)
alter table public.mixes add column if not exists updated_at timestamptz not null default now();

-- Mixes déjà enregistrés (avant les versions) : leurs titres deviennent la V1
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'mixes' and column_name = 'tracks') then
    insert into public.mix_versions (mix_id, user_id, n, label, settings, tracks, spotify_url, created_at)
    select id, user_id, 1, 'Originale', settings, tracks, spotify_url, created_at from public.mixes m
    where not exists (select 1 from public.mix_versions v where v.mix_id = m.id);
    alter table public.mixes drop column tracks, drop column settings, drop column spotify_url;
  end if;
end
$$;
