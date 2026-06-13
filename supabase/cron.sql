-- ============================================================
-- ETAPE 3 — à coller APRES avoir déployé la Edge Function
-- Remplace YOUR_PROJECT_REF et YOUR_ANON_KEY
-- ============================================================

-- Active pg_net (requêtes HTTP depuis postgres)
create extension if not exists pg_net with schema extensions;

-- Lance la Edge Function toutes les minutes
select cron.schedule(
  'poll-patate-douce',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/poll-radio',
    headers := jsonb_build_object(
      'Authorization', 'Bearer YOUR_ANON_KEY',
      'Content-Type',  'application/json'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Pour vérifier que le job est bien créé :
-- select * from cron.job;

-- Pour le supprimer plus tard si besoin :
-- select cron.unschedule('poll-patate-douce');
