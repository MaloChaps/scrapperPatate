-- ============================================================
-- Genre + miniature iTunes par titre, remplis par la Edge Function
-- (quelques titres à chaque passage du cron, pour rester sous la limite iTunes)
-- ============================================================

-- Même normalisation que trackKey() côté client : minuscules, espaces compactés
create or replace function public.track_key(artist text, title text) returns text
language sql immutable as $$
  select lower(btrim(regexp_replace(coalesce(artist, ''), '\s+', ' ', 'g')))
      || '|' ||
         lower(btrim(regexp_replace(coalesce(title,  ''), '\s+', ' ', 'g')))
$$;

create table if not exists public.track_info (
  key        text generated always as (public.track_key(artist, title)) stored primary key,
  artist     text not null default '',
  title      text not null,
  genre      text not null default '',   -- '' = pas de correspondance iTunes fiable
  art        text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.track_info enable row level security;
drop policy if exists "anon read" on public.track_info;
create policy "anon read" on public.track_info for select to anon using (true);

-- Titres joués qui n'ont pas encore d'info (les plus récents d'abord)
create or replace function public.tracks_missing_info(n int)
returns table (artist text, title text)
language sql stable as $$
  select artist, title from (
    select distinct on (public.track_key(p.artist, p.title)) p.artist, p.title, p.played_at
    from public.plays p
    where not exists (select 1 from public.track_info t where t.key = public.track_key(p.artist, p.title))
    order by public.track_key(p.artist, p.title), p.played_at desc
  ) x
  order by played_at desc
  limit n
$$;
revoke execute on function public.tracks_missing_info(int) from public, anon, authenticated;
