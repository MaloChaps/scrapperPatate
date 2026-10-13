-- ============================================================
-- Lancement des comptes : la radio n'est plus publique
-- À passer EN MÊME TEMPS que la mise en ligne de la branche produit
-- (l'ancien site lit plays / track_info sans compte et cesserait de marcher)
-- ============================================================

-- Les comptes avec l'accès radio lisent déjà plays / track_info (accounts.sql, « radio read ») : on retire la lecture publique
drop policy if exists "anon read" on public.plays;
drop policy if exists "anon read" on public.track_info;

-- Retour en arrière :
-- create policy "anon read" on public.plays      for select to anon using (true);
-- create policy "anon read" on public.track_info for select to anon using (true);
