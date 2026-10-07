-- ============================================================
-- ETAPE 3 — à coller APRES avoir déployé la Edge Function
-- (project ref et anon key déjà renseignés)
-- ============================================================

-- Active pg_cron (planificateur) et pg_net (requêtes HTTP depuis postgres)
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Lance la Edge Function toutes les minutes
select cron.schedule(
  'poll-patate-douce',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://wnbcoczjfqyxggkfyooh.supabase.co/functions/v1/poll-radio',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InduYmNvY3pqZnF5eGdna2Z5b29oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNTQ1MDYsImV4cCI6MjA5NjkzMDUwNn0.0mO3O7xqMDwTLGx-5zrVLzW8ed0WoNDKP03eHji2v9o',
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
