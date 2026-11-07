-- GyC · 041_actas.sql
-- Acta de reunión (w1): datos generales, asistentes (registro por QR con firma desde el teléfono) y acuerdos.
-- Editan el acta el administrador del proyecto (administra_proyecto) y las personas que él designe (redactores).
-- Los asistentes se registran desde una página pública con el enlace secreto del acta (token_asistencia), solo
-- mientras la asistencia esté abierta; ese registro lo hace el API (api/asistencia.js), no el navegador.
-- Ejecutar en el SQL Editor de Neon después de la 040. Se puede ejecutar más de una vez.

set client_min_messages = warning;

create table if not exists public.actas (
  id                 uuid primary key default gen_random_uuid(),
  area_id            uuid not null references public.areas(id) on delete cascade,
  proyecto_id        uuid not null references public.proyectos(id) on delete cascade,
  numero             integer not null check (numero > 0),          -- N° de reunión dentro del proyecto
  tipo               text,
  asunto             text not null,
  codigo             text,
  fecha              date not null default current_date,
  hora               time,
  duracion           text,                                         -- p. ej. 1:00
  lugar              text,
  estado             text not null default 'borrador' check (estado in ('borrador', 'cerrada')),
  asistencia_abierta boolean not null default false,
  token_asistencia   text not null unique default encode(gen_random_bytes(18), 'hex'),
  redactores         text[] not null default '{}',                -- profiles.id designados por el administrador
  created_by         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (proyecto_id, numero)
);
create index if not exists actas_proyecto_idx on public.actas (proyecto_id, fecha desc);

create table if not exists public.acta_asistentes (
  id            uuid primary key default gen_random_uuid(),
  acta_id       uuid not null references public.actas(id) on delete cascade,
  dni           text not null check (dni ~ '^[A-Za-z0-9-]{4,20}$'),
  nombres       text not null check (length(nombres) between 1 and 120),
  apellidos     text not null check (length(apellidos) between 1 and 120),
  cargo         text check (length(cargo) <= 120),
  empresa       text check (length(empresa) <= 120),
  firma         text check (firma is null or (firma like 'data:image/png;base64,%' and length(firma) <= 200000)),
  registrado_en timestamptz not null default now(),
  created_by    text,                                              -- null = registrado por el propio asistente (QR)
  unique (acta_id, dni)
);
create index if not exists acta_asistentes_acta_idx on public.acta_asistentes (acta_id, registrado_en);

create table if not exists public.acta_acuerdos (
  id             uuid primary key default gen_random_uuid(),
  acta_id        uuid not null references public.actas(id) on delete cascade,
  item           integer not null check (item > 0),
  acuerdo        text not null,
  responsable    text,
  responsable_id text,
  fin_programado date,
  estado         text not null default 'Abierto' check (estado in ('Abierto', 'Cerrado', 'Informativo')),
  created_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists acta_acuerdos_acta_idx on public.acta_acuerdos (acta_id, item);

-- updated_at automático
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'actas_updated_at') then
    create trigger actas_updated_at before update on public.actas for each row execute function public.tg_set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'acta_acuerdos_updated_at') then
    create trigger acta_acuerdos_updated_at before update on public.acta_acuerdos for each row execute function public.tg_set_updated_at();
  end if;
end $$;

-- ¿Puede la persona editar esta acta? Administrador del proyecto o designado como redactor
create or replace function public.edita_acta(p_usuario text, p_acta uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.actas a
                  where a.id = p_acta and (public.administra_proyecto(p_usuario, a.proyecto_id) or p_usuario = any(a.redactores)));
$$;

-- Solo el administrador del proyecto designa redactores, cierra o reabre el acta (un redactor no se da más permisos)
create or replace function public.tg_actas_control() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.mi_uid() is null then return new; end if;              -- registro por QR (API) o mantenimiento
  if tg_op = 'UPDATE' and (new.redactores is distinct from old.redactores or new.estado is distinct from old.estado
                           or new.proyecto_id is distinct from old.proyecto_id or new.token_asistencia is distinct from old.token_asistencia)
     and not public.administra_proyecto(public.mi_uid(), old.proyecto_id) then
    raise exception 'Solo el administrador del proyecto designa redactores y cierra o reabre el acta.';
  end if;
  if tg_op = 'INSERT' and not public.administra_proyecto(public.mi_uid(), new.proyecto_id) then
    raise exception 'Solo el administrador del proyecto crea actas.';
  end if;
  return new;
end $$;
drop trigger if exists actas_control on public.actas;
create trigger actas_control before insert or update on public.actas for each row execute function public.tg_actas_control();

-- Un acta cerrada no cambia sus asistentes ni sus acuerdos
create or replace function public.tg_acta_cerrada() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_acta uuid := coalesce(new.acta_id, old.acta_id);
begin
  if exists (select 1 from public.actas where id = v_acta and estado = 'cerrada') then
    raise exception 'El acta está cerrada: reábrala para modificarla.';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists acta_asistentes_cerrada on public.acta_asistentes;
create trigger acta_asistentes_cerrada before insert or update or delete on public.acta_asistentes
  for each row execute function public.tg_acta_cerrada();
drop trigger if exists acta_acuerdos_cerrada on public.acta_acuerdos;
create trigger acta_acuerdos_cerrada before insert or update or delete on public.acta_acuerdos
  for each row execute function public.tg_acta_cerrada();

do $$
begin
  assert to_regclass('public.actas') is not null, 'Falta la tabla actas';
  assert to_regclass('public.acta_asistentes') is not null, 'Falta la tabla acta_asistentes';
  assert to_regclass('public.acta_acuerdos') is not null, 'Falta la tabla acta_acuerdos';
  raise notice '✓ Migración 041_actas ejecutada correctamente.';
end $$;
