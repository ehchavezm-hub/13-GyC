-- GyC · 000_gyc_neon_completo.sql
-- Migración consolidada para Neon (PostgreSQL puro).
-- Reemplaza las migraciones 001–034.  Ejecutar UNA SOLA VEZ en el SQL Editor de Neon.
--
-- Diferencias respecto a LPS-GES (Supabase):
--   · profiles.id = TEXT (Clerk user ID como "user_abc123")
--   · Todas las FK a profiles(id) son TEXT sin restricción de FK
--   · Sin auth.users, sin auth.uid(), sin RLS, sin supabase_realtime
--   · La autorización la gestiona la capa API (Vercel Functions + Clerk JWT)
--   · mi_uid() lee el GUC app.current_user_id (lo fija el servidor en cada request)

-- ============================================================
-- Extensiones
-- ============================================================
create extension if not exists pgcrypto;

-- ============================================================
-- Función auxiliar: usuario actual (el servidor lo fija antes de cada query)
-- ============================================================
create or replace function public.mi_uid() returns text
language sql stable as $$
  select nullif(current_setting('app.current_user_id', true), '')
$$;

-- ============================================================
-- Función auxiliar: updated_at automático
-- ============================================================
create or replace function public.tg_set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ============================================================
-- Áreas (empresas)
-- ============================================================
create table public.areas (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  descripcion text,
  activa      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ============================================================
-- Perfiles de usuario (id = Clerk user ID, tipo TEXT)
-- ============================================================
create table public.profiles (
  id                  text primary key,            -- Clerk user ID p.ej. "user_abc123"
  area_id             uuid references public.areas(id),
  email               text,
  nombre              text not null default '',
  codigo              text,
  codigo_plataforma   text,
  rol                 text not null default 'pendiente'
                      check (rol in ('superadmin','admin','delegado','lider','consulta','pendiente')),
  es_admin_principal  boolean not null default false,
  gerencia_ids        uuid[] not null default '{}',
  horas_dia           numeric(4,2),
  activo              boolean not null default true,
  tour_visto          boolean not null default false,
  debe_cambiar_clave  boolean not null default false,
  eliminado           boolean not null default false,
  es_plataforma       boolean not null default false,
  cargo_id            uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table public.delegado_historial (
  id           uuid primary key default gen_random_uuid(),
  area_id      uuid not null references public.areas(id),
  usuario_id   text not null,          -- profiles.id (TEXT, sin FK)
  otorgado_por text,                   -- profiles.id (TEXT, sin FK)
  desde        timestamptz not null default now(),
  hasta        timestamptz
);

-- ============================================================
-- Configuración: listas, parámetros y permisos
-- ============================================================
create table public.listas (
  id          uuid primary key default gen_random_uuid(),
  area_id     uuid references public.areas(id),
  clave       text not null,
  nombre      text not null,
  descripcion text,
  grupo       text,
  sistema     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (area_id, clave)
);

create table public.lista_valores (
  id          uuid primary key default gen_random_uuid(),
  lista_id    uuid not null references public.listas(id) on delete cascade,
  codigo      text,
  valor       text not null,
  descripcion text,
  orden       integer not null default 0,
  color       text,
  activo      boolean not null default true,
  protegido   boolean not null default false,
  extra       jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on public.lista_valores (lista_id, orden);

create table public.parametros (
  id          uuid primary key default gen_random_uuid(),
  area_id     uuid not null references public.areas(id),
  clave       text not null,
  valor       jsonb not null,
  descripcion text,
  updated_at  timestamptz not null default now(),
  unique (area_id, clave)
);

create table public.permisos (
  id        uuid primary key default gen_random_uuid(),
  area_id   uuid not null references public.areas(id),
  rol       text not null check (rol in ('admin','delegado','lider','consulta')),
  accion    text not null,
  permitido boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (area_id, rol, accion)
);

-- ============================================================
-- Portafolios y Programas (jerarquía Empresa → Portafolio → Programa → Proyecto)
-- ============================================================
create table public.portafolios (
  id             uuid primary key default gen_random_uuid(),
  area_id        uuid not null references public.areas(id) on delete cascade,
  codigo         text,
  nombre         text not null,
  descripcion    text,
  responsable_id text,                 -- profiles.id (TEXT, sin FK)
  estado         text not null default 'activo' check (estado in ('activo','inactivo')),
  activo         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on public.portafolios (area_id);

create table public.programas (
  id             uuid primary key default gen_random_uuid(),
  area_id        uuid not null references public.areas(id) on delete cascade,
  portafolio_id  uuid references public.portafolios(id) on delete set null,
  codigo         text,
  nombre         text not null,
  descripcion    text,
  responsable_id text,                 -- profiles.id (TEXT, sin FK)
  estado         text not null default 'activo' check (estado in ('activo','inactivo')),
  activo         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on public.programas (area_id);
create index on public.programas (portafolio_id);

-- ============================================================
-- Proyectos
-- ============================================================
create table public.proyectos (
  id               uuid primary key default gen_random_uuid(),
  area_id          uuid not null references public.areas(id),
  codigo           text not null default '',
  cet_id           uuid references public.lista_valores(id),
  nombre_corto     text not null default '',
  nombre_completo  text,
  nombre           text,                                        -- alias conveniente
  tipo_id          uuid references public.lista_valores(id),
  gerencia_id      uuid references public.lista_valores(id),
  fase_id          uuid references public.lista_valores(id),
  estado           text not null default 'activo'
                   check (estado in ('propuesto','activo','en_pausa','cerrado','rechazado')),
  pais_id          uuid references public.lista_valores(id),
  fecha_inicio     date,
  fecha_fin        date,
  observaciones    text,
  propuesto_por    text,                -- profiles.id (TEXT, sin FK)
  aprobado_por     text,                -- profiles.id (TEXT, sin FK)
  aprobado_at      timestamptz,
  motivo_rechazo   text,
  portafolio_id    uuid references public.portafolios(id) on delete set null,
  programa_id      uuid references public.programas(id)   on delete set null,
  padre_id         uuid references public.proyectos(id)   on delete restrict,
  extra            jsonb not null default '{}',
  created_by       text,                -- profiles.id (TEXT, sin FK)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index on public.proyectos (area_id, estado);
create index on public.proyectos (portafolio_id);
create index on public.proyectos (programa_id);
create index on public.proyectos (padre_id);

create table public.proyecto_lideres (
  proyecto_id uuid not null references public.proyectos(id) on delete cascade,
  usuario_id  text not null,            -- profiles.id (TEXT, sin FK)
  primary key (proyecto_id, usuario_id)
);

create table public.proyecto_favoritos (
  usuario_id  text not null,            -- profiles.id (TEXT, sin FK)
  proyecto_id uuid not null references public.proyectos(id) on delete cascade,
  primary key (usuario_id, proyecto_id)
);

create table public.hitos (
  id          uuid primary key default gen_random_uuid(),
  area_id     uuid not null references public.areas(id),
  proyecto_id uuid not null references public.proyectos(id) on delete cascade,
  nombre      text not null,
  fecha       date,
  estado      text not null default 'pendiente' check (estado in ('pendiente','cumplido','atrasado','cancelado')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ============================================================
-- Cartera (backlog)
-- ============================================================
create table public.cartera (
  id              uuid primary key default gen_random_uuid(),
  area_id         uuid not null references public.areas(id),
  f_solicitud     date not null default current_date,
  solicitante_id  text,                 -- profiles.id (TEXT, sin FK)
  solicitante     text,
  gerencia_id     uuid references public.lista_valores(id),
  proyecto_id     uuid references public.proyectos(id),
  servicio_id     uuid references public.lista_valores(id),
  descripcion     text not null,
  responsable_id  text,                 -- profiles.id (TEXT, sin FK)
  resp2           text,
  f_requerida     date,
  f_comprometida  date,
  tipo_id         uuid references public.lista_valores(id),
  criticidad_id   uuid references public.lista_valores(id),
  estado          text not null default 'abierta'
                  check (estado in ('nueva','abierta','en_proceso','cerrada','rechazada')),
  origen          text not null default 'interna' check (origen in ('interna','solicitud')),
  motivo_rechazo  text,
  extra           jsonb not null default '{}',
  created_by      text,                 -- profiles.id (TEXT, sin FK)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on public.cartera (area_id, estado);

-- ============================================================
-- Actividades (Look Ahead + Plan semanal)
-- ============================================================
create table public.actividades (
  id              uuid primary key default gen_random_uuid(),
  area_id         uuid not null references public.areas(id),
  semana          date not null check (extract(isodow from semana) = 1),
  responsable_id  text not null,        -- profiles.id (TEXT, sin FK)
  resp2           text,
  proyecto_id     uuid references public.proyectos(id),
  gerencia_id     uuid references public.lista_valores(id),
  cet_id          uuid references public.lista_valores(id),
  servicio_id     uuid references public.lista_valores(id),
  descripcion     text not null default '',
  hh_lu numeric(5,2) not null default 0,
  hh_ma numeric(5,2) not null default 0,
  hh_mi numeric(5,2) not null default 0,
  hh_ju numeric(5,2) not null default 0,
  hh_vi numeric(5,2) not null default 0,
  hh_sa numeric(5,2) not null default 0,
  hh_do numeric(5,2) not null default 0,
  hh_total        numeric(6,2) generated always as (hh_lu+hh_ma+hh_mi+hh_ju+hh_vi+hh_sa+hh_do) stored,
  hh_real         numeric(6,2),
  tipo            text not null default 'programada' check (tipo in ('programada','no_programada')),
  comprometida    boolean not null default false,
  estado_la       text not null default 'pendiente'
                  check (estado_la in ('pendiente','con_restriccion','lista','trasladada','cancelada')),
  estado          text not null default 'programado'
                  check (estado in ('programado','completado','no_completado','cancelado')),
  cnc_id          uuid references public.lista_valores(id),
  comentario      text,
  origen          text not null default 'manual'
                  check (origen in ('manual','cartera','recurrente','plantilla','solicitud','arrastre','importacion')),
  origen_id       uuid,
  cartera_id      uuid references public.cartera(id) on delete set null,
  semana_original date,
  orden           numeric not null default 0,
  extra           jsonb not null default '{}',
  created_by      text,                 -- profiles.id (TEXT, sin FK)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on public.actividades (area_id, semana);
create index on public.actividades (responsable_id, semana);
create index on public.actividades (proyecto_id);

create table public.restricciones (
  id              uuid primary key default gen_random_uuid(),
  area_id         uuid not null references public.areas(id),
  actividad_id    uuid references public.actividades(id) on delete set null,
  proyecto_id     uuid references public.proyectos(id),
  descripcion     text not null,
  tipo_id         uuid references public.lista_valores(id),
  responsable     text,
  responsable_id  text,                 -- profiles.id (TEXT, sin FK)
  f_identificada  date default current_date,
  f_requerida     date,
  f_prometida     date,
  f_levantada     date,
  estado          text not null default 'pendiente' check (estado in ('pendiente','en_gestion','levantada')),
  comentarios     text,
  extra           jsonb not null default '{}',
  created_by      text,                 -- profiles.id (TEXT, sin FK)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on public.restricciones (area_id, estado);

create table public.cierres (
  id             uuid primary key default gen_random_uuid(),
  area_id        uuid not null references public.areas(id),
  responsable_id text not null,         -- profiles.id (TEXT, sin FK)
  semana         date not null check (extract(isodow from semana) = 1),
  cerrada        boolean not null default true,
  cerrado_at     timestamptz not null default now(),
  cerrado_por    text,                  -- profiles.id (TEXT, sin FK)
  automatico     boolean not null default false,
  reabierto_at   timestamptz,
  reabierto_por  text,                  -- profiles.id (TEXT, sin FK)
  unique (responsable_id, semana)
);

create table public.pac_historico (
  id                  uuid primary key default gen_random_uuid(),
  area_id             uuid not null references public.areas(id),
  semana              date not null,
  responsable_id      text,             -- profiles.id (TEXT, sin FK)
  responsable_codigo  text,
  completadas         integer not null default 0,
  no_completadas      integer not null default 0,
  canceladas          integer not null default 0,
  hh_plan             numeric(8,2),
  hh_completadas      numeric(8,2),
  fuente              text,
  created_at          timestamptz not null default now()
);
create index on public.pac_historico (area_id, semana);

-- ============================================================
-- Plantillas
-- ============================================================
create table public.plantillas (
  id             uuid primary key default gen_random_uuid(),
  area_id        uuid not null references public.areas(id),
  tipo           text not null check (tipo in ('recurrente','servicio')),
  nombre         text not null,
  propietario_id text,                  -- profiles.id (TEXT, sin FK)
  servicio_id    uuid references public.lista_valores(id),
  activa         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table public.plantilla_items (
  id           uuid primary key default gen_random_uuid(),
  plantilla_id uuid not null references public.plantillas(id) on delete cascade,
  proyecto_id  uuid references public.proyectos(id),
  gerencia_id  uuid references public.lista_valores(id),
  cet_id       uuid references public.lista_valores(id),
  servicio_id  uuid references public.lista_valores(id),
  descripcion  text not null,
  resp2        text,
  hh_lu numeric(5,2) not null default 0,
  hh_ma numeric(5,2) not null default 0,
  hh_mi numeric(5,2) not null default 0,
  hh_ju numeric(5,2) not null default 0,
  hh_vi numeric(5,2) not null default 0,
  hh_sa numeric(5,2) not null default 0,
  hh_do numeric(5,2) not null default 0,
  semana_offset integer not null default 0,
  orden        integer not null default 0
);

-- ============================================================
-- Equipo: ubicación diaria
-- ============================================================
create table public.ubicaciones_dia (
  id            uuid primary key default gen_random_uuid(),
  area_id       uuid not null references public.areas(id),
  usuario_id    text not null,          -- profiles.id (TEXT, sin FK)
  fecha         date not null,
  ubicacion_id  uuid references public.lista_valores(id),
  nota          text,
  unique (usuario_id, fecha)
);

-- ============================================================
-- Reunión semanal y acuerdos
-- ============================================================
create table public.reuniones (
  id          uuid primary key default gen_random_uuid(),
  area_id     uuid not null references public.areas(id),
  fecha       date not null default current_date,
  semana      date,
  asistentes  text[] not null default '{}',    -- profiles.id (Clerk, TEXT)
  notas       text,
  created_by  text,                     -- profiles.id (TEXT, sin FK)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.acuerdos (
  id             uuid primary key default gen_random_uuid(),
  area_id        uuid not null references public.areas(id),
  reunion_id     uuid references public.reuniones(id) on delete set null,
  cnc_id         uuid references public.lista_valores(id),
  accion         text not null,
  responsable_id text,                  -- profiles.id (TEXT, sin FK)
  fecha          date,
  estado         text not null default 'pendiente' check (estado in ('pendiente','en_proceso','cumplido','cancelado')),
  created_by     text,                  -- profiles.id (TEXT, sin FK)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ============================================================
-- Colaboración: comentarios, enlaces, notificaciones
-- ============================================================
create table public.comentarios (
  id          uuid primary key default gen_random_uuid(),
  area_id     uuid not null references public.areas(id),
  entidad     text not null check (entidad in ('actividad','restriccion','proyecto','cartera')),
  entidad_id  uuid not null,
  autor_id    text not null,            -- profiles.id (TEXT, sin FK)
  texto       text not null,
  menciones   text[] not null default '{}',
  created_at  timestamptz not null default now()
);
create index on public.comentarios (entidad, entidad_id);

create table public.enlaces (
  id          uuid primary key default gen_random_uuid(),
  area_id     uuid not null references public.areas(id),
  entidad     text not null check (entidad in ('actividad','restriccion','proyecto','cartera')),
  entidad_id  uuid not null,
  titulo      text not null,
  url         text not null check (url ~* '^https?://'),
  autor_id    text,                     -- profiles.id (TEXT, sin FK)
  created_at  timestamptz not null default now()
);
create index on public.enlaces (entidad, entidad_id);

create table public.notificaciones (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  text not null,            -- profiles.id (TEXT, sin FK)
  tipo        text not null,
  texto       text not null,
  ruta        text,
  leida       boolean not null default false,
  created_at  timestamptz not null default now()
);
create index on public.notificaciones (usuario_id, leida);

-- ============================================================
-- Grillas: columnas personalizadas y vistas guardadas
-- ============================================================
create table public.columnas_personalizadas (
  id         uuid primary key default gen_random_uuid(),
  area_id    uuid not null references public.areas(id),
  grilla     text not null check (grilla in ('actividades','cartera','restricciones','proyectos')),
  clave      text not null,
  nombre     text not null,
  tipo       text not null check (tipo in ('texto','numero','fecha','lista','casilla')),
  lista_id   uuid references public.listas(id),
  orden      integer not null default 0,
  activa     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (area_id, grilla, clave)
);

create table public.vistas (
  id          uuid primary key default gen_random_uuid(),
  area_id     uuid not null references public.areas(id),
  usuario_id  text,                     -- profiles.id (TEXT, sin FK); null = vista estándar
  grilla      text not null,
  nombre      text not null,
  config      jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ============================================================
-- Solicitudes de cambio y auditoría
-- ============================================================
create table public.solicitudes_cambio (
  id          uuid primary key default gen_random_uuid(),
  area_id     uuid not null references public.areas(id),
  autor_id    text,                     -- profiles.id (TEXT, sin FK)
  titulo      text not null,
  descripcion text,
  pantalla    text,
  prioridad   text not null default 'media' check (prioridad in ('alta','media','baja')),
  estado      text not null default 'recibida'
              check (estado in ('recibida','en_analisis','aprobada','en_desarrollo','entregada','descartada')),
  respuesta   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.auditoria (
  id          bigserial primary key,
  area_id     uuid,
  tabla       text not null,
  registro_id uuid,
  accion      text not null,
  usuario_id  text,                     -- profiles.id (TEXT, sin FK)
  cambios     jsonb,
  created_at  timestamptz not null default now()
);
create index on public.auditoria (tabla, registro_id);
create index on public.auditoria (created_at);

-- ============================================================
-- Organigrama del equipo (from migration 014)
-- ============================================================
create table public.organigrama_nodos (
  id          uuid primary key default gen_random_uuid(),
  area_id     uuid not null references public.areas(id),
  tipo        text not null default 'persona' check (tipo in ('unidad','persona')),
  titulo      text,
  usuario_id  text,                     -- profiles.id (TEXT, sin FK)
  padre_id    uuid references public.organigrama_nodos(id) on delete set null,
  x           numeric,
  y           numeric,
  orden       integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on public.organigrama_nodos (area_id);

-- ============================================================
-- Empresa_miembros: un usuario en varias empresas (from migration 030)
-- ============================================================
create table public.empresa_miembros (
  usuario_id         text not null,     -- profiles.id (TEXT, sin FK)
  area_id            uuid not null references public.areas(id) on delete cascade,
  rol                text not null,
  activo             boolean not null default true,
  es_admin_principal boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  primary key (usuario_id, area_id)
);
create index on public.empresa_miembros (area_id);

-- ============================================================
-- Programa de Arranque (from migration 033)
-- ============================================================
create table public.programa_arranque_items (
  id           serial primary key,
  item_codigo  text not null unique,
  proceso      text not null,
  area_lider   text not null,
  obligatorio  boolean not null default false,
  descripcion  text not null,
  orden        integer not null
);

create table public.programa_arranque (
  id                   uuid primary key default gen_random_uuid(),
  proyecto_id          uuid not null references public.proyectos(id) on delete cascade,
  cr_proyecto          text,
  fecha_movilizacion   date,
  fecha_construccion   date,
  fecha_actualizacion  date,
  num_semanas          integer not null default 8,
  created_at           timestamptz not null default now(),
  unique (proyecto_id)
);

create table public.programa_arranque_detalle (
  id           uuid primary key default gen_random_uuid(),
  programa_id  uuid not null references public.programa_arranque(id) on delete cascade,
  item_codigo  text not null references public.programa_arranque_items(item_codigo),
  responsable  text,
  fecha_plan   date,
  fecha_real   date,
  comentarios  text,
  semanas      jsonb not null default '[]',
  updated_at   timestamptz not null default now(),
  unique (programa_id, item_codigo)
);

create index on public.programa_arranque (proyecto_id);
create index on public.programa_arranque_detalle (programa_id);

-- ============================================================
-- updated_at automático en todas las tablas principales
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array[
    'areas','profiles','listas','lista_valores','parametros','permisos',
    'portafolios','programas','proyectos',
    'hitos','cartera','actividades','restricciones','plantillas','reuniones','acuerdos',
    'columnas_personalizadas','vistas','solicitudes_cambio',
    'organigrama_nodos','empresa_miembros']
  loop
    execute format(
      'create or replace trigger trg_%1$s_updated before update on public.%1$s
       for each row execute function public.tg_set_updated_at()', t);
  end loop;
end $$;

-- ============================================================
-- Función de auditoría (referenciada desde triggers de portafolios/programas)
-- ============================================================
create or replace function public.tg_auditoria() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid;
  v_area uuid;
begin
  begin v_id   := (case when tg_op <> 'DELETE' then to_jsonb(new) else to_jsonb(old) end ->>'id')::uuid;   exception when others then null; end;
  begin v_area := (case when tg_op <> 'DELETE' then to_jsonb(new) else to_jsonb(old) end ->>'area_id')::uuid; exception when others then null; end;
  insert into public.auditoria (area_id, tabla, registro_id, accion, usuario_id, cambios)
  values (
    v_area,
    tg_table_name,
    v_id,
    lower(tg_op),
    public.mi_uid(),
    case
      when tg_op = 'INSERT' then to_jsonb(new)
      when tg_op = 'DELETE' then to_jsonb(old)
      else jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new))
    end
  );
  return null;
end $$;

-- ============================================================
-- Trigger: estado_la sigue a sus restricciones (from migration 016)
-- ============================================================
create or replace function public.tg_restriccion_estado_la() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_act uuid;
  v_abiertas boolean;
begin
  foreach v_act in array array_remove(array[
      case when tg_op <> 'INSERT' then old.actividad_id end,
      case when tg_op <> 'DELETE' then new.actividad_id end], null) loop
    select exists (select 1 from public.restricciones r where r.actividad_id = v_act and r.estado <> 'levantada') into v_abiertas;
    begin
      update public.actividades a
         set estado_la = case when v_abiertas then 'con_restriccion' else 'lista' end
       where a.id = v_act
         and ((v_abiertas and a.estado_la in ('pendiente', 'lista'))
              or (not v_abiertas and a.estado_la = 'con_restriccion'));
    exception when others then null;
    end;
  end loop;
  return null;
end $$;

create trigger restriccion_estado_la
  after insert or delete or update of estado, actividad_id on public.restricciones
  for each row execute function public.tg_restriccion_estado_la();

-- ============================================================
-- Trigger: Grupo LPS (sub-proyecto) hereda portafolio/programa del padre (from migrations 024/031)
-- ============================================================
create or replace function public.tg_subproyecto() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_padre public.proyectos;
begin
  if new.padre_id is not null then
    if new.padre_id = new.id then raise exception 'Un proyecto no puede ser su propio padre.'; end if;
    select * into v_padre from public.proyectos where id = new.padre_id;
    if v_padre.id is null or v_padre.area_id <> new.area_id then
      raise exception 'El proyecto padre no pertenece a esta empresa.';
    end if;
    if v_padre.padre_id is not null then
      raise exception 'Un Grupo LPS no puede tener Grupos LPS.';
    end if;
    if tg_op = 'UPDATE' and exists (select 1 from public.proyectos h where h.padre_id = new.id) then
      raise exception 'Este proyecto tiene Grupos LPS: no puede ser Grupo LPS de otro.';
    end if;
    new.portafolio_id := v_padre.portafolio_id;
    new.programa_id   := v_padre.programa_id;
  end if;
  return new;
end $$;

create or replace trigger trg_proyectos_subproyecto
  before insert or update of padre_id, portafolio_id, programa_id, area_id on public.proyectos
  for each row execute function public.tg_subproyecto();

create or replace function public.tg_subproyectos_siguen() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (new.portafolio_id, new.programa_id) is distinct from (old.portafolio_id, old.programa_id) then
    update public.proyectos
       set portafolio_id = new.portafolio_id, programa_id = new.programa_id
     where padre_id = new.id;
  end if;
  return null;
end $$;

create or replace trigger trg_proyectos_subproyectos_siguen
  after update of portafolio_id, programa_id on public.proyectos
  for each row execute function public.tg_subproyectos_siguen();

-- ============================================================
-- Trigger: validar jerarquía misma empresa (from migration 023)
-- ============================================================
create or replace function public.tg_jerarquia_misma_empresa() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_table_name = 'programas' then
    if new.portafolio_id is not null and not exists (
        select 1 from public.portafolios f where f.id = new.portafolio_id and f.area_id = new.area_id) then
      raise exception 'El portafolio no pertenece a esta empresa.';
    end if;
  else
    if new.portafolio_id is not null and not exists (
        select 1 from public.portafolios f where f.id = new.portafolio_id and f.area_id = new.area_id) then
      raise exception 'El portafolio no pertenece a esta empresa.';
    end if;
    if new.programa_id is not null and not exists (
        select 1 from public.programas g where g.id = new.programa_id and g.area_id = new.area_id) then
      raise exception 'El programa no pertenece a esta empresa.';
    end if;
  end if;
  return new;
end $$;

create or replace trigger trg_programas_jerarquia
  before insert or update of portafolio_id, area_id on public.programas
  for each row execute function public.tg_jerarquia_misma_empresa();
create or replace trigger trg_proyectos_jerarquia
  before insert or update of portafolio_id, programa_id, area_id on public.proyectos
  for each row execute function public.tg_jerarquia_misma_empresa();

-- Auditoria en portafolios/programas
create or replace trigger trg_portafolios_auditoria
  after insert or update or delete on public.portafolios
  for each row execute function public.tg_auditoria();
create or replace trigger trg_programas_auditoria
  after insert or update or delete on public.programas
  for each row execute function public.tg_auditoria();

-- ============================================================
-- Trigger: sincroniza empresa_miembros cuando cambia profiles (from migration 030)
-- ============================================================
create or replace function public.tg_sync_miembro() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.eliminado then
    delete from public.empresa_miembros where usuario_id = new.id;
    return new;
  end if;
  if tg_op = 'UPDATE' and old.area_id is not null and old.area_id is distinct from new.area_id
     and coalesce(current_setting('lpsgt.cambio_empresa', true), '') <> 'on' then
    delete from public.empresa_miembros where usuario_id = new.id and area_id = old.area_id;
  end if;
  if new.area_id is null or new.es_plataforma then return new; end if;
  insert into public.empresa_miembros (usuario_id, area_id, rol, activo, es_admin_principal)
  values (new.id, new.area_id, new.rol, new.activo, new.es_admin_principal)
  on conflict (usuario_id, area_id) do update
    set rol = excluded.rol, activo = excluded.activo,
        es_admin_principal = excluded.es_admin_principal, updated_at = now();
  return new;
end $$;

create trigger trg_profiles_miembro
  after insert or update of area_id, rol, activo, es_admin_principal, eliminado on public.profiles
  for each row execute function public.tg_sync_miembro();

-- ============================================================
-- Funciones de utilidad (from migration 003)
-- ============================================================

create or replace function public.sembrar_lista(p_area uuid, p_clave text, p_nombre text, p_valores jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_lista uuid;
  v jsonb;
  i int := 0;
begin
  insert into public.listas (area_id, clave, nombre, sistema)
  values (p_area, p_clave, p_nombre, true)
  on conflict (area_id, clave) do update set nombre = excluded.nombre
  returning id into v_lista;
  for v in select * from jsonb_array_elements(p_valores) loop
    i := i + 1;
    insert into public.lista_valores (lista_id, codigo, valor, orden, color, protegido, extra)
    values (v_lista, v->>'codigo', v->>'valor', i * 10, v->>'color',
            coalesce((v->>'protegido')::boolean, false), coalesce(v->'extra', '{}'::jsonb));
  end loop;
  return v_lista;
end $$;

create or replace function public.sembrar_area(p_area uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.listas where area_id = p_area) then
    raise notice 'El área ya tiene listas; no se vuelve a sembrar.';
    return;
  end if;

  perform public.sembrar_lista(p_area, 'gerencias', 'Gerencias (clientes internos)', '[
    {"codigo":"GI","valor":"Gerencia de Ingeniería"},
    {"codigo":"GOI","valor":"Gerencia de Obras Industriales"},
    {"codigo":"GOC","valor":"Gerencia de Obras Civiles"},
    {"codigo":"GOF","valor":"Gerencia de Obras de Infraestructura"},
    {"codigo":"PyL","valor":"Propuestas y Licitaciones"},
    {"codigo":"GOI_CH","valor":"Gerencia de Obras Industriales Chile"},
    {"codigo":"GOC_CH","valor":"Gerencia de Obras Civiles Chile"},
    {"codigo":"GIPT","valor":"Gerencia de Innovación"}]');

  perform public.sembrar_lista(p_area, 'cet', 'CET (códigos de proyectos internos)', '[]');
  perform public.sembrar_lista(p_area, 'servicios', 'Servicios / Entregables', '[
    {"valor":"Seguimiento implementación BIM"},
    {"valor":"Envío y recepción de documentos técnicos"},
    {"valor":"Monitoreo y control de RFI"},
    {"valor":"Gestión de las comunicaciones"},
    {"valor":"Consultas técnicas"},
    {"valor":"Metrados"},
    {"valor":"Mejora de procesos"},
    {"valor":"Gestión del conocimiento"},
    {"valor":"Planificación, monitoreo y control del área"},
    {"valor":"Propuestas y licitaciones"}]');
  perform public.sembrar_lista(p_area, 'categorias_servicio', 'Categorías de servicio', '[
    {"valor":"Proyecto"},{"valor":"Mejora de procesos"},{"valor":"Gestión del conocimiento"},{"valor":"Gestión del área"}]');
  perform public.sembrar_lista(p_area, 'tipos_proyecto', 'Tipos de proyecto', '[
    {"valor":"Proyecto"},{"valor":"Proceso interno"},{"valor":"Gestión del área"},{"valor":"Capacitación / conocimiento"}]');
  perform public.sembrar_lista(p_area, 'fases', 'Fases de proyecto', '[
    {"valor":"Diseño"},{"valor":"Preconstrucción"},{"valor":"Construcción"},{"valor":"Cierre"},{"valor":"Permanente"}]');
  perform public.sembrar_lista(p_area, 'paises', 'Países', '[
    {"valor":"Perú"},{"valor":"Chile"},{"valor":"Colombia"},{"valor":"Bolivia"}]');

  perform public.sembrar_lista(p_area, 'estados_proyecto', 'Estados de proyecto', '[
    {"codigo":"propuesto","valor":"Propuesto","color":"#EDC948","protegido":true},
    {"codigo":"activo","valor":"Activo","color":"#59A14F","protegido":true},
    {"codigo":"en_pausa","valor":"En pausa","color":"#BAB0AC","protegido":true},
    {"codigo":"cerrado","valor":"Cerrado","color":"#4E79A7","protegido":true},
    {"codigo":"rechazado","valor":"Rechazado","color":"#E15759","protegido":true}]');
  perform public.sembrar_lista(p_area, 'tipos_actividad', 'Tipos de compromiso', '[
    {"codigo":"programada","valor":"Programada","protegido":true},
    {"codigo":"no_programada","valor":"No programada","protegido":true}]');
  perform public.sembrar_lista(p_area, 'estados_la', 'Estados de Look Ahead', '[
    {"codigo":"pendiente","valor":"Pendiente","color":"#BAB0AC","protegido":true},
    {"codigo":"con_restriccion","valor":"Con restricción","color":"#E15759","protegido":true},
    {"codigo":"lista","valor":"Lista","color":"#59A14F","protegido":true},
    {"codigo":"trasladada","valor":"Trasladada al plan","color":"#4E79A7","protegido":true},
    {"codigo":"cancelada","valor":"Cancelada","color":"#9E9E9E","protegido":true}]');
  perform public.sembrar_lista(p_area, 'estados_compromiso', 'Estados de compromiso', '[
    {"codigo":"programado","valor":"Programado","color":"#EDC948","protegido":true},
    {"codigo":"completado","valor":"Completado","color":"#59A14F","protegido":true},
    {"codigo":"no_completado","valor":"No completado","color":"#E15759","protegido":true},
    {"codigo":"cancelado","valor":"Cancelado","color":"#BAB0AC","protegido":true}]');
  perform public.sembrar_lista(p_area, 'cnc', 'Causas de no cumplimiento (CNC)', '[
    {"valor":"Mala planificación / subestimación de HH"},
    {"valor":"Trabajo previo no terminado (pre-requisito)"},
    {"valor":"Sin información del cliente / información faltante"},
    {"valor":"Indefinición técnica / problema de diseño o planos"},
    {"valor":"Aprobación pendiente (interna o del cliente)"},
    {"valor":"Decisión de cliente"},
    {"valor":"Cambio de prioridad"},
    {"valor":"Dependencia externa / de otra área"},
    {"valor":"Falta de recursos (personal no disponible)"},
    {"valor":"Herramientas, software o accesos no disponibles"},
    {"valor":"Contratos / órdenes de cambio"},
    {"valor":"Permisos / autorizaciones faltantes"},
    {"valor":"Condición no prevista"},
    {"valor":"Fuerza mayor (incluye clima)"},
    {"valor":"Me olvidé"},
    {"valor":"Otra causa (especificar en comentario)"},
    {"codigo":"no_reportado","valor":"No reportado al cierre","protegido":true}]');
  perform public.sembrar_lista(p_area, 'tipos_restriccion', 'Tipos de restricción', '[
    {"valor":"Información del cliente"},{"valor":"Aprobación"},{"valor":"Recursos"},
    {"valor":"Dependencia de otra área"},{"valor":"Accesos / software"},{"valor":"Contractual"},{"valor":"Otro"}]');
  perform public.sembrar_lista(p_area, 'estados_restriccion', 'Estados de restricción', '[
    {"codigo":"pendiente","valor":"Pendiente","color":"#E15759","protegido":true},
    {"codigo":"en_gestion","valor":"En gestión","color":"#EDC948","protegido":true},
    {"codigo":"levantada","valor":"Levantada","color":"#59A14F","protegido":true}]');
  perform public.sembrar_lista(p_area, 'criticidad', 'Criticidad', '[
    {"valor":"Alta","color":"#E15759"},{"valor":"Media","color":"#EDC948"},{"valor":"Baja","color":"#59A14F"}]');
  perform public.sembrar_lista(p_area, 'tipos_cartera', 'Tipos de cartera', '[{"valor":"Proyecto"},{"valor":"Permanente"}]');
  perform public.sembrar_lista(p_area, 'estados_cartera', 'Estados de cartera', '[
    {"codigo":"nueva","valor":"Solicitud nueva","color":"#F28E2B","protegido":true},
    {"codigo":"abierta","valor":"Abierto","color":"#4E79A7","protegido":true},
    {"codigo":"en_proceso","valor":"En proceso","color":"#EDC948","protegido":true},
    {"codigo":"cerrada","valor":"Cerrado","color":"#59A14F","protegido":true},
    {"codigo":"rechazada","valor":"Rechazado","color":"#E15759","protegido":true}]');
  perform public.sembrar_lista(p_area, 'ubicaciones', 'Ubicaciones', '[
    {"codigo":"oficina","valor":"Oficina","color":"#4E79A7","extra":{"cuenta_capacidad":true}},
    {"codigo":"proyecto","valor":"Proyecto (obra)","color":"#F28E2B","extra":{"cuenta_capacidad":true}},
    {"codigo":"remoto","valor":"Remoto","color":"#76B7B2","extra":{"cuenta_capacidad":true}},
    {"codigo":"vacaciones","valor":"Vacaciones / licencia","color":"#BAB0AC","extra":{"cuenta_capacidad":false}},
    {"codigo":"feriado","valor":"Feriado","color":"#B07AA1","extra":{"cuenta_capacidad":false}}]');
  perform public.sembrar_lista(p_area, 'cargos', 'Cargos', '[
    {"valor":"Gerente de Proyecto"},{"valor":"Jefe de Producción"},{"valor":"Planificador"},
    {"valor":"Jefe de Oficina Técnica"},{"valor":"Administrador de Contrato"},{"valor":"Administrador de Proyecto"},
    {"valor":"Jefe de SSOMA"},{"valor":"Jefe de Calidad"},{"valor":"Residente"}]');

  insert into public.parametros (area_id, clave, valor, descripcion) values
    (p_area, 'meta_pac',            '0.80',   'Meta de PAC (0 a 1)'),
    (p_area, 'umbral_ambar',        '0.60',   'Desde este PAC el semáforo es ámbar'),
    (p_area, 'semanas_lookahead',   '3',      'Semanas del Look Ahead'),
    (p_area, 'horas_dia',           '8',      'Horas disponibles por día laborable (capacidad por defecto)'),
    (p_area, 'dias_laborables',     '[1,2,3,4,5]', 'Días laborables (1 = lunes … 7 = domingo)'),
    (p_area, 'cierre',              '{"dia":5,"hora":"17:00"}', 'Cierre semanal (día ISO y hora)'),
    (p_area, 'reunion',             '{"dia":5,"hora":"08:00"}', 'Reunión semanal (día ISO y hora)'),
    (p_area, 'cierre_automatico',   'true',   'Cerrar automáticamente las semanas vencidas'),
    (p_area, 'alerta_dias',         '3',      'Días de anticipación para alertas de restricciones'),
    (p_area, 'arrastre_alerta',     '2',      'Semanas pendientes desde las que se alerta un arrastre'),
    (p_area, 'zona_horaria',        '"America/Lima"', 'Zona horaria del área'),
    (p_area, 'version_app',         '"GyC V1.00.00"', 'Texto del encabezado de los PDF'),
    (p_area, 'firma_pdf',           '"By EHCM"', 'Texto del pie de los PDF'),
    (p_area, 'reunion_minutos',     '{"cierre":10,"avance":10,"restricciones":10,"compromisos":20,"lookahead":10}', 'Minutos por paso del modo reunión'),
    (p_area, 'reconocimientos',     '{"mejor_pac":true,"mayor_mejora":true}', 'Reconocimientos mensuales del tablero');

  -- Matriz de permisos: delegado=true por defecto; lider y consulta parten en false
  insert into public.permisos (area_id, rol, accion, permitido)
  select p_area, r.rol, a.accion, (r.rol = 'delegado')
    from (values ('delegado'),('lider'),('consulta')) r(rol)
    cross join (values
      ('ver_semana'),('crear_semana'),('editar_semana'),('cerrar_semana'),
      ('ver_compromiso'),('crear_compromiso'),('editar_compromiso'),('cerrar_compromiso'),
      ('ver_restriccion'),('crear_restriccion'),('editar_restriccion'),('resolver_restriccion'),
      ('ver_cartera'),('crear_cartera'),('editar_cartera'),('exportar_pdf'),
      ('ver_indicadores'),('importar_datos'),('ver_solicitud'),('crear_solicitud'),
      ('gestionar_usuarios'),('eliminar_usuarios'),('exportar_respaldo')
    ) a(accion);
  -- lider: 6 acciones activas por defecto
  update public.permisos set permitido = true
   where area_id = p_area and rol = 'lider'
     and accion in ('ver_semana','crear_semana','editar_semana','ver_compromiso','crear_compromiso','editar_compromiso');
  -- consulta: 3 acciones activas por defecto
  update public.permisos set permitido = true
   where area_id = p_area and rol = 'consulta'
     and accion in ('ver_semana','ver_compromiso','ver_indicadores');
  -- admin permisos
  insert into public.permisos (area_id, rol, accion, permitido)
  select p_area, r.rol, x.accion, r.rol = 'admin'
    from (values ('admin')) r(rol)
    cross join (values ('eliminar_usuarios'), ('exportar_respaldo')) x(accion)
  on conflict do nothing;
end $$;

-- ============================================================
-- Cierre automático de semanas vencidas (from migration 003)
-- ============================================================
create or replace function public.cerrar_semanas_vencidas() returns integer
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_cnc uuid;
  v_n int := 0;
  v_cierre jsonb;
  v_tz text;
  v_limite timestamptz;
begin
  perform set_config('lpsgt.cierre_en_curso', 'on', true);
  for r in
    select distinct a.area_id, a.responsable_id, a.semana
      from public.actividades a
     where a.comprometida
       and a.semana < date_trunc('week', now())::date + 7
       and not exists (select 1 from public.cierres c where c.responsable_id = a.responsable_id and c.semana = a.semana)
  loop
    select valor into v_cierre from public.parametros where area_id = r.area_id and clave = 'cierre';
    select valor #>> '{}' into v_tz from public.parametros where area_id = r.area_id and clave = 'zona_horaria';
    if coalesce((select valor::text from public.parametros where area_id = r.area_id and clave = 'cierre_automatico'), 'true') <> 'true' then
      continue;
    end if;
    v_limite := ((r.semana + (coalesce((v_cierre->>'dia')::int, 5) - 1))::text || ' ' ||
                 coalesce(v_cierre->>'hora', '17:00'))::timestamp at time zone coalesce(v_tz, 'America/Lima');
    if now() < v_limite then continue; end if;

    select lv.id into v_cnc from public.lista_valores lv join public.listas l on l.id = lv.lista_id
     where l.area_id = r.area_id and l.clave = 'cnc' and lv.codigo = 'no_reportado';
    update public.actividades
       set estado = 'no_completado', cnc_id = coalesce(cnc_id, v_cnc)
     where responsable_id = r.responsable_id and semana = r.semana and comprometida
       and (estado = 'programado' or (estado = 'no_completado' and cnc_id is null));
    insert into public.cierres (area_id, responsable_id, semana, cerrada, automatico, cerrado_por)
    values (r.area_id, r.responsable_id, r.semana, true, true, null);
    insert into public.notificaciones (usuario_id, tipo, texto, ruta)
    values (r.responsable_id, 'cierre_automatico',
            'Tu semana del ' || to_char(r.semana, 'DD/MM/YYYY') || ' se cerró automáticamente.',
            '#/plan?semana=' || r.semana);
    v_n := v_n + 1;
  end loop;
  perform set_config('lpsgt.cierre_en_curso', 'off', true);
  return v_n;
end $$;

-- ============================================================
-- Exportación de respaldo (simplificada: sin auth.uid())
-- ============================================================
create or replace function public.exportar_respaldo() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v jsonb := jsonb_build_object('generado', now(), 'version', 2);
  v_tmp jsonb;
  t text;
begin
  foreach t in array array[
    'areas','profiles','listas','lista_valores','parametros','permisos','proyectos',
    'portafolios','programas','proyecto_lideres','hitos','cartera','actividades',
    'restricciones','cierres','pac_historico','plantillas','plantilla_items',
    'ubicaciones_dia','reuniones','acuerdos','comentarios','enlaces',
    'columnas_personalizadas','vistas','solicitudes_cambio','delegado_historial',
    'organigrama_nodos']
  loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x', t) into v_tmp;
    v := v || jsonb_build_object(t, v_tmp);
  end loop;
  return v;
end $$;

-- ============================================================
-- Funciones de empresa_miembros (from migration 030, adapted)
-- ============================================================

create or replace function public.pertenece(p_usuario text, p_area uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles where id = p_usuario and area_id = p_area)
      or exists (select 1 from public.empresa_miembros where usuario_id = p_usuario and area_id = p_area and activo)
$$;

create or replace function public.mover_a_otra_empresa(p_usuario text, p_dejar uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare m public.empresa_miembros;
begin
  select * into m from public.empresa_miembros
   where usuario_id = p_usuario and area_id <> p_dejar and activo order by created_at limit 1;
  if not found then return false; end if;
  perform set_config('lpsgt.cambio_empresa', 'on', true);
  update public.profiles
     set area_id = m.area_id, rol = m.rol, activo = m.activo, es_admin_principal = m.es_admin_principal
   where id = p_usuario;
  perform set_config('lpsgt.cambio_empresa', 'off', true);
  return true;
end $$;

create or replace function public.cambiar_empresa_activa(p_usuario text, p_area uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare m public.empresa_miembros;
begin
  select * into m from public.empresa_miembros where usuario_id = p_usuario and area_id = p_area and activo;
  if not found then raise exception 'No pertenece a esa empresa.'; end if;
  perform set_config('lpsgt.cambio_empresa', 'on', true);
  update public.profiles
     set area_id = m.area_id, rol = m.rol, activo = m.activo, es_admin_principal = m.es_admin_principal
   where id = p_usuario;
  perform set_config('lpsgt.cambio_empresa', 'off', true);
end $$;

create or replace function public.eliminar_usuario(p_usuario text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_obj public.profiles;
begin
  select * into v_obj from public.profiles where id = p_usuario;
  if not found then raise exception 'Usuario no encontrado.'; end if;
  if v_obj.es_admin_principal then raise exception 'El administrador principal no se puede eliminar.'; end if;

  -- Pertenece a otras empresas: solo se le retira de la empresa activa
  if exists (select 1 from public.empresa_miembros where usuario_id = p_usuario and area_id <> v_obj.area_id and activo) then
    delete from public.proyecto_lideres where usuario_id = p_usuario
       and proyecto_id in (select id from public.proyectos where area_id = v_obj.area_id);
    perform public.mover_a_otra_empresa(p_usuario, v_obj.area_id);
    delete from public.empresa_miembros where usuario_id = p_usuario and area_id = v_obj.area_id;
    return 'retirado';
  end if;

  update public.profiles
     set eliminado = true, activo = false, email = null,
         rol = case when rol in ('superadmin','admin','delegado') then 'lider' else rol end
   where id = p_usuario;
  delete from public.proyecto_lideres where usuario_id = p_usuario;
  return 'desactivado';
end $$;

create or replace function public.eliminar_empresa(p_area uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  if not exists (select 1 from public.areas where id = p_area) then
    raise exception 'Empresa no encontrada.';
  end if;
  perform set_config('lpsgt.eliminando_empresa', 'on', true);
  perform set_config('lpsgt.cierre_en_curso', 'on', true);
  for r in select id from public.profiles where area_id = p_area loop
    perform public.mover_a_otra_empresa(r.id, p_area);
  end loop;
  delete from public.restricciones where area_id = p_area;
  delete from public.acuerdos where area_id = p_area;
  delete from public.reuniones where area_id = p_area;
  delete from public.hitos where area_id = p_area;
  delete from public.actividades where area_id = p_area;
  delete from public.cartera where area_id = p_area;
  delete from public.cierres where area_id = p_area;
  delete from public.pac_historico where area_id = p_area;
  delete from public.ubicaciones_dia where area_id = p_area;
  delete from public.comentarios where area_id = p_area;
  delete from public.enlaces where area_id = p_area;
  delete from public.solicitudes_cambio where area_id = p_area;
  delete from public.plantilla_items
   where plantilla_id in (select id from public.plantillas where area_id = p_area)
      or proyecto_id  in (select id from public.proyectos where area_id = p_area);
  delete from public.plantillas where area_id = p_area;
  delete from public.proyecto_lideres where proyecto_id in (select id from public.proyectos where area_id = p_area);
  delete from public.proyecto_favoritos where proyecto_id in (select id from public.proyectos where area_id = p_area);
  delete from public.proyectos where area_id = p_area and padre_id is not null;
  delete from public.proyectos where area_id = p_area;
  delete from public.programas where area_id = p_area;
  delete from public.portafolios where area_id = p_area;
  delete from public.vistas where area_id = p_area;
  delete from public.columnas_personalizadas where area_id = p_area;
  delete from public.organigrama_nodos where area_id = p_area;
  delete from public.delegado_historial where area_id = p_area;
  delete from public.permisos where area_id = p_area;
  delete from public.parametros where area_id = p_area;
  delete from public.notificaciones where usuario_id in (select id from public.profiles where area_id = p_area);
  delete from public.profiles where area_id = p_area;
  delete from public.lista_valores where lista_id in (select id from public.listas where area_id = p_area);
  delete from public.listas where area_id = p_area;
  delete from public.auditoria where area_id = p_area;
  delete from public.areas where id = p_area;
  perform set_config('lpsgt.cierre_en_curso', 'off', true);
  perform set_config('lpsgt.eliminando_empresa', 'off', true);
end $$;

-- ============================================================
-- Datos iniciales Cosapi (from migrations 034 + initial area seed)
-- ============================================================
do $$
declare
  v_area_id uuid;
  v_port_id uuid;
  v_prog_id uuid;
  v_proy_id uuid;
begin
  -- Área Cosapi
  insert into public.areas (nombre, activa)
  values ('Cosapi', true)
  on conflict do nothing
  returning id into v_area_id;

  if v_area_id is null then
    select id into v_area_id from public.areas where nombre = 'Cosapi' limit 1;
  end if;

  -- Sembrar listas/parámetros/permisos del área
  perform public.sembrar_area(v_area_id);

  -- Portafolio
  insert into public.portafolios (nombre, area_id, activo)
  values ('Obras Edificaciones', v_area_id, true)
  on conflict do nothing
  returning id into v_port_id;

  if v_port_id is null then
    select id into v_port_id from public.portafolios
    where nombre = 'Obras Edificaciones' and area_id = v_area_id limit 1;
  end if;

  -- Programa
  insert into public.programas (nombre, portafolio_id, area_id, activo)
  values ('Hospitales', v_port_id, v_area_id, true)
  on conflict do nothing
  returning id into v_prog_id;

  if v_prog_id is null then
    select id into v_prog_id from public.programas
    where nombre = 'Hospitales' and portafolio_id = v_port_id limit 1;
  end if;

  -- Proyecto
  insert into public.proyectos (codigo, nombre_corto, nombre_completo, nombre, programa_id, portafolio_id, area_id, estado)
  values ('HAZ', 'Hospital Azángaro', 'Hospital Azángaro - Puno', 'Hospital Azángaro - Puno', v_prog_id, v_port_id, v_area_id, 'activo')
  on conflict do nothing
  returning id into v_proy_id;

  raise notice 'Datos Cosapi creados: area=%, portafolio=%, programa=%, proyecto=%',
    v_area_id, v_port_id, v_prog_id, v_proy_id;
  raise notice 'Crear usuarios desde la interfaz de administración una vez registrados en Clerk.';
end $$;

-- ============================================================
-- Ítems maestros del Programa de Arranque — 74 ítems (from migration 033)
-- ============================================================
insert into public.programa_arranque_items (item_codigo, proceso, area_lider, obligatorio, descripcion, orden) values
 ('1',  'Transferencia', 'Gerencia de Proyecto', true, 'Seguimiento a la Transferencia de Documentos de Contratación (Licitación, Comercial, Presupuestos) al Equipo de Dirección del Proyecto mediante Acta de Transferencia.', 1),
 ('1a', 'Transferencia', 'Producción', true, 'Seguimiento a la Reunión de Transferencia específica de Aspectos Técnicos/Operativos', 2),
 ('1b', 'Transferencia', 'Costos', true, 'Seguimiento a la Reunión de Transferencia específica de Aspectos Económicos/Financieros (Presupuesto, Flujo de caja, etc.)', 3),
 ('1c', 'Transferencia', 'Administración Contractual', true, 'Seguimiento a la Reunión de Transferencia específica de Riesgos (Matriz de Gestión de Riesgos)', 4),
 ('1d', 'Transferencia', 'Administración Contractual', true, 'Seguimiento a la Reunión de Transferencia específica de Términos del Contrato', 5),
 ('1e', 'Transferencia', 'Gerencia de Proyecto', true, 'Seguimiento a la definición de Ratios de Retroalimentación y Procedimientos Constructivos Detallados', 6),
 ('2',  'Contrato Principal', 'Administración Contractual', true, 'Seguimiento a la Firma del Contrato', 7),
 ('2a', 'Contrato Principal', 'Administración Contractual', true, 'Organización del Taller del Conocimiento del Contrato (y entrega de Presentación)', 8),
 ('2b', 'Contrato Principal', 'Gerencia de Proyecto', true, 'Evaluación del EDP sobre el Conocimiento del Contrato, enlace remitido por AC de Sede', 9),
 ('3',  'Contrato Principal', 'Administración Contractual', true, 'Análisis de Riesgos y Oportunidades (matriz de gestión de riesgos actualizada)', 10),
 ('4',  'Contrato Principal', 'Administración Contractual', true, 'Flujograma de gestión de cambios/adicionales', 11),
 ('5',  'Contrato Principal', 'Administración Contractual', true, 'Flujograma de gestión de Valorizaciones', 12),
 ('6',  'Contrato Principal', 'Administración Contractual', false, 'Identificación de Stakeholders', 13),
 ('7',  'Contrato Principal', 'Administración Contractual', false, 'Legalización del Cuaderno de Obra', 14),
 ('8',  'Campamento de Obra', 'Administración de Proyecto', false, 'Movilización de facilidades (Módulo de avanzada)', 15),
 ('9',  'Campamento de Obra', 'Administración de Proyecto', false, 'Alquiler o Convenio de Áreas para Plantas de Asfalto, Concreto, agregados, etc.', 16),
 ('10', 'Movilización Equipos', 'Producción', false, 'Instalación de Equipos claves (Planta de Asfalto, Planta de Concreto, Grúas, Encofrados y Andamios, etc.)', 17),
 ('11', 'Campamento de Obra', 'Calidad', false, 'Implementación de las instalaciones del Laboratorio de Suelos y Concreto (Según aplique)', 18),
 ('12', 'Campamento de Obra', 'Equipos', false, 'Implementación de Taller de Equipos', 19),
 ('13', 'Campamento de Obra', 'Administración de Proyecto', true, 'Layout de Almacén de Obra', 20),
 ('14', 'Campamento de Obra', 'Administración de Proyecto', false, 'Contratación de Servicios Generales (Hospedaje, Alimentación, limpieza, lavandería, guardianía, etc.)', 21),
 ('15', 'Campamento de Obra', 'Administración de Proyecto', false, 'Visitar la Zona de Ejecución del Proyecto para identificar facilidades y tomar acciones', 22),
 ('16', 'Campamento de Obra', 'Administración de Proyecto', true, 'Registro de Nuevo Establecimiento de la Empresa en la zona de Ejecución del Proyecto en la Sunat (Dirección Fiscal de Establecimiento) incluye Almacén', 23),
 ('17', 'Campamento de Obra', 'Administración de Proyecto', false, 'Definir medios de transporte para el personal Empleado y Obrero a la zona de Ejecución del Proyecto', 24),
 ('18', 'Financiero', 'Costos', true, 'Creación del Centro de Beneficio (CeBe)', 25),
 ('19', 'Financiero', 'Administración Contractual', false, 'Carta Fianza del Adelanto', 26),
 ('20', 'Financiero', 'Administración Contractual', false, 'Carta Fianza de Fiel Cumplimiento', 27),
 ('21', 'Financiero', 'Administración Contractual', false, 'Solicitud de Adelanto de Obra', 28),
 ('22', 'Financiero', 'Administración Contractual', false, 'Seguros de Obra (CAR, EAR, TREC, etc.)', 29),
 ('23', 'Financiero', 'Administración de Proyecto', true, 'Flujo de Caja Inicial (Análisis de financiamiento del Proyecto)', 30),
 ('24', 'Financiero', 'Administración de Proyecto', true, 'Apertura de Fondo Fijo', 31),
 ('25', 'Financiero', 'Administración de Proyecto', false, 'Seguimiento a la Constitución de Fideicomiso', 32),
 ('26', 'Movilización Staff', 'Gerencia de Proyecto', true, 'Definición del Equipo de Dirección del Proyecto (EDP)', 33),
 ('27', 'Movilización Staff', 'Administración de Proyecto', true, 'Elaboración Organigrama, incluyendo fecha de ingreso.', 34),
 ('28', 'Financiero', 'Costos', true, 'Definición del Plan de Fases', 35),
 ('29', 'Financiero', 'Costos', true, 'Elaboración del Resultado Operativo versión 0', 36),
 ('30', 'Revisión Alcance', 'Oficina Técnica', true, 'Revisión del Expediente Técnico y compatibilización (Planos, Especificaciones Técnicas, Ronda de Consultas, Estudio de Suelos, Estudio Medio Ambiental, Estudio de Hidrología)', 37),
 ('31', 'Revisión Alcance', 'Oficina Técnica', true, 'Presentación del Cronograma de elaboración de Metrados.', 38),
 ('32', 'Revisión Alcance', 'Oficina Técnica', true, '1ra Actualización de Metrados', 39),
 ('33', 'Movilización Equipos', 'Equipos', true, 'Verificación de la facilidad del acceso a la Obra (ancho de camino, ciudades con calles estrechas, radio de curva, etc.) para el transporte de materiales, equipos y otros.', 40),
 ('34', 'Movilización Equipos', 'Planificación', true, 'Elaborar Histograma detallado de Equipos', 41),
 ('35', 'Movilización Equipos', 'Equipos', true, 'Revisión del cumplimiento de Estándares de Calidad y Seguridad del Cliente para Equipos y Vehículos asignados al Proyecto', 42),
 ('36', 'Movilización Equipos', 'Equipos', true, 'Flujograma de proceso de incorporación de equipos y vehículos.', 43),
 ('37', 'Movilización Equipos', 'Equipos', true, 'Atención y verificación de incorporación de Equipos para el Arranque (Retroexcavadora, Camión grúa, etc.…) incluido Operadores', 44),
 ('38', 'Movilización Mano de Obra', 'Planificación', true, 'Elaborar Histograma detallado de Mano de Obra', 45),
 ('39', 'Movilización Mano de Obra', 'Administración de Proyecto', true, 'Revisión del Cumplimiento de los Requisitos mínimos que exige el Cliente para la contratación e ingreso de Personal Obrero (Operadores, Conductores, Soldadores, etc.) y personal Empleado (Reclutamiento y acreditación)', 46),
 ('40', 'Movilización Mano de Obra', 'Administración de Proyecto', true, 'Flujograma del Proceso de incorporación, inducción y acreditación del personal.', 47),
 ('41', 'Movilización Mano de Obra', 'Administración de Proyecto', true, 'Ingreso de Personal Obreros para el Arranque (Construcción del Campamento, Primeras actividades)', 48),
 ('42', 'Procura Materiales', 'Oficina Técnica', true, 'Seguimiento a la Capacitación de procesos y mecanismos de compras (según casuística)', 49),
 ('43', 'Procura Materiales', 'Oficina Técnica', true, 'Elaboración listado de materiales y equipos permanentes', 50),
 ('44', 'Procura Materiales', 'Planificación', true, 'Elaboración del Programa de Compras', 51),
 ('45', 'Procura Materiales', 'Oficina Técnica', true, 'Elaboración de Solicitudes para Materiales, Equipos permanentes para la etapa de arranque y su seguimiento de llegada a obra.', 52),
 ('46', 'Procura Materiales', 'Calidad', false, 'Elaboración de Solicitudes de Equipos de medición y ensayo para laboratorio de suelos y concreto', 53),
 ('47', 'Procura Materiales', 'Calidad', false, 'Llegada de equipos de medición y ensayo para laboratorio de suelos y concreto', 54),
 ('48', 'Procura Materiales', 'SSOMA', true, 'Definición y seguimiento a llegada de materiales para el arranque de Proyecto (EPPs, señaléticas, etc.)', 55),
 ('49', 'Subcontratos y Servicios Críticos', 'Producción', true, 'Definición y seguimiento de los Subcontratos y Servicios Críticos necesarios para el arranque (Alcance técnico con OT, Condiciones Particulares con AC, Adjudicación con Procura Sede)', 56),
 ('50', 'Tecnología de la Información', 'Administración de Proyecto', true, 'Seguimiento al suministro de Hardware (incluyendo Software), Internet, nube, file Server, etc.', 57),
 ('51', 'Permisos', 'Administración de Proyecto', true, 'Registro RENOCC (coordinar con Relaciones Laborales Sede Legal)', 58),
 ('52', 'Permisos', 'Administración de Proyecto', false, 'Certificado de Inexistencia de Restos Arqueológicos', 59),
 ('53', 'Permisos', 'Administración de Proyecto', false, 'Gestión de Licencias (de Construcción, demolición, derecho de vía; etc.)', 60),
 ('54', 'Permisos', 'Administración de Proyecto', false, 'Permiso de explotación de canteras y de plantas de concreto, asfalto o similares (Propietarios, Denuncio Minero y Municipalidades)', 61),
 ('55', 'Plan de Ejecución', 'Producción', true, 'Elaborar el Plan de Ejecución del Proyecto', 62),
 ('56', 'Subcontratos y Servicios Críticos', 'Planificación', true, 'Coordinación para capacitación del uso del Aplicativo RES', 63),
 ('57', 'Subcontratos y Servicios Críticos', 'Planificación', true, 'Elaboración del Programa de Subcontratación y Servicios Críticos', 64),
 ('58', 'Plan de Ejecución', 'Planificación', true, 'Elaboración Cronograma de Obra (Línea Base contractual) Actualizado, listado de hitos, Diagrama Tiempo camino (si aplica), Curva S, Base de Programación.', 65),
 ('59', 'Plan de Ejecución', 'Planificación', true, 'Creación del ISP cero.', 66),
 ('60', 'Plan de Ejecución', 'Calidad', true, 'Aprobación Plan de Calidad (incluye: listado de Planes de puntos de inspección y ensayo, Matriz de calidad y formatos)', 67),
 ('61', 'Plan de Ejecución', 'Oficina Técnica', false, 'Plan de Topografía', 68),
 ('62', 'Plan de Ejecución', 'Calidad', false, 'Estudio de Canteras (Calidad y Potencia) del Proyecto y Nueva Alternativas', 69),
 ('63', 'Plan de Ejecución', 'Producción', true, 'Elaboración de Procedimientos Escritos de Trabajo Seguro / Procedimientos Constructivos', 70),
 ('64', 'Plan de Ejecución', 'SSOMA', true, 'Elaboración y Aprobación del Plan de Seguridad e IPERC Línea Base', 71),
 ('65', 'Plan de Ejecución', 'SSOMA', false, 'Elaboración y Aprobación del Programa Anual de Seguridad (Minero)', 72),
 ('66', 'Plan de Ejecución', 'SSOMA', false, 'Elaboración y Aprobación del Plan de Medio Ambiente, Aspectos Ambientales, Materiales Peligrosos (Minero)', 73),
 ('67', 'Plan de Ejecución', 'SSOMA', true, 'Elaboración del Plan de Salud Ocupacional y Mapa de Riesgos', 74),
 ('68', 'Plan de Ejecución', 'SSOMA', true, 'Elaboración del Plan de Emergencia', 75),
 ('69', 'Plan de Ejecución', 'Oficina Técnica', true, 'Levantamiento Topográfico Inicial de Áreas de Trabajo', 76),
 ('70', 'Plan de Gestión del Proyecto', 'Gerencia de Proyecto', true, 'Elaboración del Plan de Gestión de Proyectos', 77),
 ('71', 'Plan de Gestión del Proyecto', 'Producción', true, 'Implementación del Last Planner (incluyendo elaboración del lookahead inicial, mínimo 4 semanas)', 78),
 ('72', 'Plan de Gestión del Proyecto', 'Producción', false, 'Elaboración del Plan de implementación VDC', 79),
 ('73', 'Plan de Gestión del Proyecto', 'Oficina Técnica', true, 'Plan de Ejecución BIM', 80),
 ('74', 'Plan de Gestión del Proyecto', 'Calidad', true, 'Desarrollo del programa de implementación del sistema de gestión de calidad', 81)
on conflict (item_codigo) do nothing;

-- ============================================================
-- Verificación final
-- ============================================================
do $$
begin
  assert (select count(*) from public.programa_arranque_items) = 81,
    'Se esperaban 81 ítems del programa de arranque (74 numerados + subítems)';
  assert (select count(*) from public.areas) >= 1,
    'Se esperaba al menos 1 área (Cosapi)';
  assert (select count(*) from public.portafolios) >= 1,
    'Se esperaba al menos 1 portafolio (Obras Edificaciones)';
  assert (select count(*) from public.proyectos) >= 1,
    'Se esperaba al menos 1 proyecto (Hospital Azángaro)';
  raise notice '✓ Migración 000_gyc_neon_completo ejecutada correctamente.';
  raise notice '  Tablas: %, programa_arranque_items: 81, área: Cosapi',
    (select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE');
end $$;
