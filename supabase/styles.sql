-- ============================================================
-- Styles des titres de la radio (remplis par la Edge Function fill-styles)
-- À coller APRÈS avoir déployé fill-styles
-- ============================================================

-- null = pas encore traité, {} = aucun style connu
alter table public.track_info add column if not exists styles text[];

-- Quelques artistes par minute (étiquettes Last.fm, sinon genres d'album Deezer)
select cron.schedule(
  'fill-styles',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://wnbcoczjfqyxggkfyooh.supabase.co/functions/v1/fill-styles',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InduYmNvY3pqZnF5eGdna2Z5b29oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNTQ1MDYsImV4cCI6MjA5NjkzMDUwNn0.0mO3O7xqMDwTLGx-5zrVLzW8ed0WoNDKP03eHji2v9o',
      'Content-Type',  'application/json'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Avancement : select count(*) filter (where styles is null) as restants from public.track_info;
-- Pour arrêter : select cron.unschedule('fill-styles');
