-- ============================================================
-- Communauté : une playlist peut être publiée (une de ses versions), visible par tout le monde
-- (page Community, lien partageable, même sans compte). Le nom de l'auteur est celui qu'il choisit
-- (profiles.display_name), copié à la publication : les fiches des comptes restent privées.
-- À passer après mix_versions.sql
-- ============================================================

alter table public.profiles add column if not exists display_name text check (char_length(display_name) <= 40);
-- Chacun peut changer son nom affiché (seulement cette colonne : radio et admin restent réservés au serveur)
drop policy if exists "own name" on public.profiles;
create policy "own name" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;

alter table public.mixes add column if not exists published_version uuid references public.mix_versions on delete set null;
alter table public.mixes add column if not exists published_at timestamptz;
alter table public.mixes add column if not exists author_name text not null default '';
alter table public.mixes add column if not exists blurb text not null default '' check (char_length(blurb) <= 280);
create index if not exists mixes_published on public.mixes (published_at desc) where published_version is not null;

-- Lecture publique : la playlist publiée et sa version publiée, rien d'autre
drop policy if exists "published read" on public.mixes;
create policy "published read" on public.mixes for select to anon, authenticated using (published_version is not null);
drop policy if exists "published version read" on public.mix_versions;
create policy "published version read" on public.mix_versions for select to anon, authenticated using (
  exists (select 1 from public.mixes m where m.published_version = mix_versions.id));
