-- ============================================================
-- ETAPE 1 — à coller dans SQL Editor > New query
-- ============================================================

-- Table historique
create table public.plays (
  id        bigint generated always as identity primary key,
  title     text not null,
  artist    text not null default '',
  played_at timestamptz not null default now()
);

create index on public.plays (played_at desc);

-- Realtime (pour que le frontend se mette à jour en direct)
alter publication supabase_realtime add table public.plays;

-- RLS
alter table public.plays enable row level security;

-- Lecture publique ; écriture réservée au serveur (Edge Function poll-radio, clé service_role qui ignore RLS)
create policy "anon read" on public.plays for select to anon using (true);
