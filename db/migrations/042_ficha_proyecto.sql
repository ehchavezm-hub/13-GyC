-- GyC · 042_ficha_proyecto.sql
-- Ficha del proyecto (CR-PG-SGP-01-F1 r1, pestaña "0.Ficha del proyecto"): datos generales, plazos, presupuesto,
-- alcance, volúmenes principales, organización del proyecto (staff) y fotos.
-- Los campos de la versión anterior (CR, inicio/fin contractual, movilización y construcción) se conservan:
-- "Inicio/Fin programado" de la ficha son inicio_contractual/fin_contractual (los usa el Programa de Arranque).
-- Ejecutar en el SQL Editor de Neon después de la 041. Se puede ejecutar más de una vez.

set client_min_messages = warning;

alter table public.proyectos
  add column if not exists cebe                 text,
  add column if not exists unidad_negocio       text,
  add column if not exists ubicacion            text,
  add column if not exists pais                 text,
  add column if not exists tipo_proyecto        text,
  add column if not exists cliente              text,
  add column if not exists supervision          text,
  add column if not exists inicio_real          date,
  add column if not exists fin_real             date,
  add column if not exists modalidad_ejecucion  text,
  add column if not exists sistema_contratacion text,
  add column if not exists presupuesto_inicial  numeric(16,2),
  add column if not exists presupuesto_final    numeric(16,2),
  add column if not exists moneda               text not null default 'US$',
  add column if not exists alcance              text;

-- Volúmenes principales (una fila con es_titulo = true agrupa las siguientes, p. ej. "Torre de Captación N°05")
create table if not exists public.proyecto_volumenes (
  id               uuid primary key default gen_random_uuid(),
  proyecto_id      uuid not null references public.proyectos(id) on delete cascade,
  orden            integer not null default 0,
  descripcion      text not null,
  es_titulo        boolean not null default false,
  cantidad_inicial numeric(18,3),
  cantidad_final   numeric(18,3),
  unidad           text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists proyecto_volumenes_proy_idx on public.proyecto_volumenes (proyecto_id, orden);

-- Organización del proyecto: cargo, titular y contraturno o reemplazo
create table if not exists public.proyecto_staff (
  id          uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.proyectos(id) on delete cascade,
  orden       integer not null default 0,
  cargo       text not null,
  principal   text,
  reemplazo   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists proyecto_staff_proy_idx on public.proyecto_staff (proyecto_id, orden);

-- Fotos del proyecto (JPEG reducido en el navegador, como data URL)
create table if not exists public.proyecto_fotos (
  id          uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.proyectos(id) on delete cascade,
  orden       integer not null default 0,
  titulo      text,
  imagen      text not null check (imagen like 'data:image/jpeg;base64,%' and length(imagen) <= 1500000),
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists proyecto_fotos_proy_idx on public.proyecto_fotos (proyecto_id, orden);

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'proyecto_volumenes_updated_at') then
    create trigger proyecto_volumenes_updated_at before update on public.proyecto_volumenes for each row execute function public.tg_set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'proyecto_staff_updated_at') then
    create trigger proyecto_staff_updated_at before update on public.proyecto_staff for each row execute function public.tg_set_updated_at();
  end if;
end $$;

do $$
begin
  assert exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'proyectos' and column_name = 'alcance'),
    'Falta proyectos.alcance';
  assert to_regclass('public.proyecto_volumenes') is not null, 'Falta la tabla proyecto_volumenes';
  assert to_regclass('public.proyecto_staff') is not null, 'Falta la tabla proyecto_staff';
  assert to_regclass('public.proyecto_fotos') is not null, 'Falta la tabla proyecto_fotos';
  raise notice '✓ Migración 042_ficha_proyecto ejecutada correctamente.';
end $$;
