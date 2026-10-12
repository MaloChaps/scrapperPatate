-- ============================================================
-- Écriture dans plays réservée au serveur (2026-10-12)
-- Les titres sont notés par la Edge Function poll-radio (clé service_role, qui ignore RLS)
-- et elle écarte déjà les doublons : le site n'a plus besoin d'écrire ni de supprimer.
-- ============================================================
drop policy if exists "anon insert" on public.plays;
drop policy if exists "anon delete" on public.plays;
