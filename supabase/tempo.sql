-- ============================================================
-- Tempo des titres de la radio (rempli par la Edge Function fill-tempo)
-- À coller APRÈS avoir déployé fill-tempo
-- ============================================================

-- null = pas encore traité, 0 = introuvable
alter table public.track_info add column if not exists bpm smallint;

-- Quelques titres par minute (BPM Deezer, sinon calculé sur l'extrait de 30 s)
select cron.schedule(
  'fill-tempo',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://wnbcoczjfqyxggkfyooh.supabase.co/functions/v1/fill-tempo',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InduYmNvY3pqZnF5eGdna2Z5b29oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNTQ1MDYsImV4cCI6MjA5NjkzMDUwNn0.0mO3O7xqMDwTLGx-5zrVLzW8ed0WoNDKP03eHji2v9o',
      'Content-Type',  'application/json'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Avancement : select count(*) filter (where bpm is null) as restants, count(*) filter (where bpm > 0) as connus from public.track_info;
-- Pour arrêter : select cron.unschedule('fill-tempo');
