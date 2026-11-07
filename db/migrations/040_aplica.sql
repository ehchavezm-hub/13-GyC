-- GyC · 040_aplica.sql
-- CR-PG-SGP-01-F1 r1 (versión con pestaña "3.Listas"): la columna "Obligatorio" pasa a "Aplica" con la lista
-- de aplicabilidad Si / N/A, que se decide en cada proyecto. Sin valor, se usa la del formato:
-- Si para los ítems obligatorios y N/A para los opcionales.
-- Ejecutar en el SQL Editor de Neon después de la 039. Se puede ejecutar más de una vez.

set client_min_messages = warning;

alter table public.programa_arranque_detalle
  add column if not exists aplica text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'programa_arranque_detalle_aplica_check') then
    alter table public.programa_arranque_detalle
      add constraint programa_arranque_detalle_aplica_check check (aplica in ('si', 'na'));
  end if;
end $$;

do $$
begin
  assert exists (select 1 from information_schema.columns where table_schema = 'public'
                  and table_name = 'programa_arranque_detalle' and column_name = 'aplica'),
    'Falta programa_arranque_detalle.aplica';
  raise notice '✓ Migración 040_aplica ejecutada correctamente.';
end $$;
