-- LPS-GES · 001_esquema.sql
-- Esquema completo. Ejecutar en Supabase > SQL Editor (una sola vez, en orden: 001, 002, 003).
-- Principios: todo editable (listas y parámetros en tablas), desactivar en vez de borrar,
-- preparado para varias áreas (area_id en todas las tablas de negocio).

create extension if not exists pgcrypto;

-- ============================================================
-- Utilidades
-- ============================================================
create or replace function public.tg_set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ============================================================
-- Áreas y usuarios
-- ============================================================
create table public.areas (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  descripcion text,
  activa      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  area_id             uuid references public.areas(id),
  email               text,
  nombre              text not null default '',
  codigo              text,                        -- código corto (p. ej. iniciales)
  rol                 text not null default 'pendiente'
                      check (rol in ('admin','delegado','lider','consulta','pendiente')),
  es_admin_principal  boolean not null default false,
  gerencia_ids        uuid[] not null default '{}', -- gerencias visibles (usuarios de consulta)
  horas_dia           numeric(4,2),                -- capacidad; null = parámetro del área
  activo              boolean not null default true,
  tour_visto          boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table public.delegado_historial (
  id           uuid primary key default gen_random_uuid(),
  area_id      uuid not null references public.areas(id),
  usuario_id   uuid not null references public.profiles(id),
  otorgado_por uuid references public.profiles(id),
  desde        timestamptz not null default now(),
  hasta        timestamptz
);

-- ============================================================
-- Configuración: listas, parámetros y permisos (principio P1)
-- ============================================================
create table public.listas (
  id          uuid primary key default gen_random_uuid(),
  area_id     uuid references public.areas(id),        -- null = común a todas las áreas
  clave       text not null,
  nombre      text not null,
  descripcion text,
  sistema     boolean not null default false,          -- creada por el aplicativo (no se elimina)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (area_id, clave)
);

create table public.lista_valores (
  id          uuid primary key default gen_random_uuid(),
  lista_id    uuid not null references public.listas(id) on delete cascade,
  codigo      text,                                    -- código estable usado por la lógica
  valor       text not null,                           -- texto visible (editable)
  descripcion text,
  orden       integer not null default 0,
  color       text,
  activo      boolean not null default true,
  protegido   boolean not null default false,          -- principio P5: renombrable, no eliminable
  extra       jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on public.lista_valores (lista_id, orden);

create table public.parametros (
  id         uuid primary key default gen_random_uuid(),
  area_id    uuid not null references public.areas(id),
  clave      text not null,
  valor      jsonb not null,
  descripcion text,
  updated_at timestamptz not null default now(),
  unique (area_id, clave)
);

create table public.permisos (
  id         uuid primary key default gen_random_uuid(),
  area_id    uuid not null references public.areas(id),
  rol        text not null check (rol in ('delegado','lider','consulta')),
  accion     text not null,
  permitido  boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (area_id, rol, accion)
);

-- ============================================================
-- Proyectos (menú de selección)
-- ============================================================
create table public.proyectos (
  id               uuid primary key default gen_random_uuid(),
  area_id          uuid not null references public.areas(id),
  codigo           text not null,
  cet_id           uuid references public.lista_valores(id),
  nombre_corto     text not null,
  nombre_completo  text,
  tipo_id          uuid references public.lista_valores(id),
  gerencia_id      uuid references public.lista_valores(id),
  fase_id          uuid references public.lista_valores(id),
  estado           text not null default 'activo'
                   check (estado in ('propuesto','activo','en_pausa','cerrado','rechazado')),
  pais_id          uuid references public.lista_valores(id),
  fecha_inicio     date,
  fecha_fin        date,
  observaciones    text,
  propuesto_por    uuid references public.profiles(id),
  aprobado_por     uuid references public.profiles(id),
  aprobado_at      timestamptz,
  motivo_rechazo   text,
  extra            jsonb not null default '{}',
  created_by       uuid references public.profiles(id) default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index on public.proyectos (area_id, estado);

create table public.proyecto_lideres (
  proyecto_id uuid not null references public.proyectos(id) on delete cascade,
  usuario_id  uuid not null references public.profiles(id) on delete cascade,
  primary key (proyecto_id, usuario_id)
);

create table public.proyecto_favoritos (
  usuario_id  uuid not null references public.profiles(id) on delete cascade,
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
-- Cartera (backlog) y solicitudes de servicio (M-01)
-- ============================================================
create table public.cartera (
  id              uuid primary key default gen_random_uuid(),
  area_id         uuid not null references public.areas(id),
  f_solicitud     date not null default current_date,
  solicitante_id  uuid references public.profiles(id),
  solicitante     text,
  gerencia_id     uuid references public.lista_valores(id),
  proyecto_id     uuid references public.proyectos(id),
  servicio_id     uuid references public.lista_valores(id),
  descripcion     text not null,
  responsable_id  uuid references public.profiles(id),
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
  created_by      uuid references public.profiles(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on public.cartera (area_id, estado);

-- ============================================================
-- Actividades (Look Ahead + Plan semanal en una sola tabla)
--   semana = lunes de la semana. Una actividad de una semana futura es Look Ahead;
--   de la semana en curso o pasada, plan semanal. "comprometida" = pasó al plan.
-- ============================================================
create table public.actividades (
  id              uuid primary key default gen_random_uuid(),
  area_id         uuid not null references public.areas(id),
  semana          date not null check (extract(isodow from semana) = 1),
  responsable_id  uuid not null references public.profiles(id),
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
  extra           jsonb not null default '{}',             -- columnas personalizadas
  created_by      uuid references public.profiles(id) default auth.uid(),
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
  responsable_id  uuid references public.profiles(id),
  f_identificada  date default current_date,
  f_requerida     date,
  f_prometida     date,
  f_levantada     date,
  estado          text not null default 'pendiente' check (estado in ('pendiente','en_gestion','levantada')),
  comentarios     text,
  extra           jsonb not null default '{}',
  created_by      uuid references public.profiles(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on public.restricciones (area_id, estado);

-- Cierre de semana por líder
create table public.cierres (
  id             uuid primary key default gen_random_uuid(),
  area_id        uuid not null references public.areas(id),
  responsable_id uuid not null references public.profiles(id),
  semana         date not null check (extract(isodow from semana) = 1),
  cerrada        boolean not null default true,
  cerrado_at     timestamptz not null default now(),
  cerrado_por    uuid references public.profiles(id) default auth.uid(),
  automatico     boolean not null default false,
  reabierto_at   timestamptz,
  reabierto_por  uuid references public.profiles(id),
  unique (responsable_id, semana)
);

-- Histórico de PAC migrado desde los Excel (las semanas nuevas se calculan de actividades)
create table public.pac_historico (
  id                  uuid primary key default gen_random_uuid(),
  area_id             uuid not null references public.areas(id),
  semana              date not null,
  responsable_id      uuid references public.profiles(id),
  responsable_codigo  text,                 -- nombre en el Excel cuando no hay usuario
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
-- Plantillas: recurrentes (por líder) y de servicio (M-05)
-- ============================================================
create table public.plantillas (
  id            uuid primary key default gen_random_uuid(),
  area_id       uuid not null references public.areas(id),
  tipo          text not null check (tipo in ('recurrente','servicio')),
  nombre        text not null,
  propietario_id uuid references public.profiles(id),
  servicio_id   uuid references public.lista_valores(id),
  activa        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
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
  semana_offset integer not null default 0,     -- plantillas de servicio: semana relativa
  orden        integer not null default 0
);

-- ============================================================
-- Equipo: ubicación diaria y capacidad (M-02)
-- ============================================================
create table public.ubicaciones_dia (
  id            uuid primary key default gen_random_uuid(),
  area_id       uuid not null references public.areas(id),
  usuario_id    uuid not null references public.profiles(id) on delete cascade,
  fecha         date not null,
  ubicacion_id  uuid references public.lista_valores(id),
  nota          text,
  unique (usuario_id, fecha)
);

-- ============================================================
-- Reunión semanal, acuerdos de mejora (M-04)
-- ============================================================
create table public.reuniones (
  id          uuid primary key default gen_random_uuid(),
  area_id     uuid not null references public.areas(id),
  fecha       date not null default current_date,
  semana      date,
  asistentes  uuid[] not null default '{}',
  notas       text,
  created_by  uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.acuerdos (
  id             uuid primary key default gen_random_uuid(),
  area_id        uuid not null references public.areas(id),
  reunion_id     uuid references public.reuniones(id) on delete set null,
  cnc_id         uuid references public.lista_valores(id),
  accion         text not null,
  responsable_id uuid references public.profiles(id),
  fecha          date,
  estado         text not null default 'pendiente' check (estado in ('pendiente','en_proceso','cumplido','cancelado')),
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ============================================================
-- Colaboración: comentarios (M-06), enlaces (M-07), notificaciones
-- ============================================================
create table public.comentarios (
  id          uuid primary key default gen_random_uuid(),
  area_id     uuid not null references public.areas(id),
  entidad     text not null check (entidad in ('actividad','restriccion','proyecto','cartera')),
  entidad_id  uuid not null,
  autor_id    uuid not null references public.profiles(id) default auth.uid(),
  texto       text not null,
  menciones   uuid[] not null default '{}',
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
  autor_id    uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now()
);
create index on public.enlaces (entidad, entidad_id);

create table public.notificaciones (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references public.profiles(id) on delete cascade,
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
  usuario_id  uuid references public.profiles(id) on delete cascade,  -- null = vista estándar
  grilla      text not null,
  nombre      text not null,
  config      jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ============================================================
-- Solicitudes de cambio del aplicativo (M-15) y auditoría
-- ============================================================
create table public.solicitudes_cambio (
  id          uuid primary key default gen_random_uuid(),
  area_id     uuid not null references public.areas(id),
  autor_id    uuid references public.profiles(id) default auth.uid(),
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
  usuario_id  uuid,
  cambios     jsonb,
  created_at  timestamptz not null default now()
);
create index on public.auditoria (tabla, registro_id);
create index on public.auditoria (created_at);

-- updated_at automático
do $$
declare t text;
begin
  foreach t in array array['areas','profiles','listas','lista_valores','parametros','permisos','proyectos',
    'hitos','cartera','actividades','restricciones','plantillas','reuniones','acuerdos',
    'columnas_personalizadas','vistas','solicitudes_cambio']
  loop
    execute format('create trigger trg_%1$s_updated before update on public.%1$s
                    for each row execute function public.tg_set_updated_at()', t);
  end loop;
end $$;
