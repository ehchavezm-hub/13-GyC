-- LPS-GES · 023_portafolios_programas.sql
-- Jerarquía de cada empresa: Empresa (área) → Portafolio → Programa → Proyecto.
-- Las tablas se crearon primero desde el SQL Editor (especificacion/08-migracion-portafolios-programas.sql) con
-- reglas abiertas a cualquier usuario de cualquier empresa; esta migración las deja en el repositorio y las aísla:
--   · cada empresa solo ve sus portafolios y programas;
--   · los crean y modifican el administrador y el delegado de la empresa.
-- Se puede ejecutar más de una vez (sin "drop": las reglas existentes se renombran y modifican).

set client_min_messages = warning;

create table if not exists public.portafolios (
  id              uuid primary key default gen_random_uuid(),
  area_id         uuid not null references public.areas(id) on delete cascade,
  codigo          text,
  nombre          text not null,
  descripcion     text,
  responsable_id  uuid references public.profiles(id) on delete set null,
  estado          text not null default 'activo' check (estado in ('activo','inactivo')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.programas (
  id              uuid primary key default gen_random_uuid(),
  area_id         uuid not null references public.areas(id) on delete cascade,
  portafolio_id   uuid references public.portafolios(id) on delete set null,
  codigo          text,
  nombre          text not null,
  descripcion     text,
  responsable_id  uuid references public.profiles(id) on delete set null,
  estado          text not null default 'activo' check (estado in ('activo','inactivo')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.proyectos
  add column if not exists portafolio_id uuid references public.portafolios(id) on delete set null,
  add column if not exists programa_id   uuid references public.programas(id)   on delete set null;

create index if not exists portafolios_area_idx on public.portafolios (area_id);
create index if not exists programas_area_idx on public.programas (area_id);
create index if not exists programas_portafolio_idx on public.programas (portafolio_id);
create index if not exists proyectos_portafolio_idx on public.proyectos (portafolio_id);
create index if not exists proyectos_programa_idx on public.proyectos (programa_id);

create or replace trigger trg_portafolios_updated_at before update on public.portafolios
  for each row execute function public.tg_set_updated_at();
create or replace trigger trg_programas_updated_at before update on public.programas
  for each row execute function public.tg_set_updated_at();
create or replace trigger trg_portafolios_auditoria after insert or update or delete on public.portafolios
  for each row execute function public.tg_auditoria();
create or replace trigger trg_programas_auditoria after insert or update or delete on public.programas
  for each row execute function public.tg_auditoria();

alter table public.portafolios enable row level security;
alter table public.programas enable row level security;

-- Un programa, y el portafolio y el programa de un proyecto, deben ser de la misma empresa
create or replace function public.tg_jerarquia_misma_empresa() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_table_name = 'programas' then
    if new.portafolio_id is not null and not exists (select 1 from public.portafolios f where f.id = new.portafolio_id and f.area_id = new.area_id) then
      raise exception 'El portafolio no pertenece a esta empresa.';
    end if;
  else
    if new.portafolio_id is not null and not exists (select 1 from public.portafolios f where f.id = new.portafolio_id and f.area_id = new.area_id) then
      raise exception 'El portafolio no pertenece a esta empresa.';
    end if;
    if new.programa_id is not null and not exists (select 1 from public.programas g where g.id = new.programa_id and g.area_id = new.area_id) then
      raise exception 'El programa no pertenece a esta empresa.';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.tg_jerarquia_misma_empresa() from public, anon, authenticated;
create or replace trigger trg_programas_jerarquia before insert or update of portafolio_id, area_id on public.programas
  for each row execute function public.tg_jerarquia_misma_empresa();
create or replace trigger trg_proyectos_jerarquia before insert or update of portafolio_id, programa_id, area_id on public.proyectos
  for each row execute function public.tg_jerarquia_misma_empresa();

do $$
declare t text;
begin
  foreach t in array array['portafolios', 'programas'] loop
    -- Regla abierta creada desde el SQL Editor → regla de gestión (solo administrador y delegado de la empresa)
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'auth_all_' || t) then
      execute format('alter policy %I on public.%I rename to %I', 'auth_all_' || t, t, t || '_gestion');
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_gestion') then
      execute format('alter policy %I on public.%I using (area_id = (select public.mi_area()) and (select public.es_gestor()))
                        with check (area_id = (select public.mi_area()) and (select public.es_gestor()))', t || '_gestion', t);
    else
      execute format('create policy %I on public.%I for all to authenticated
                        using (area_id = (select public.mi_area()) and (select public.es_gestor()))
                        with check (area_id = (select public.mi_area()) and (select public.es_gestor()))', t || '_gestion', t);
    end if;
    -- Lectura: todos los miembros de la empresa
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_sel') then
      execute format('create policy %I on public.%I for select to authenticated using (area_id = (select public.mi_area()))', t || '_sel', t);
    end if;
  end loop;
end $$;
