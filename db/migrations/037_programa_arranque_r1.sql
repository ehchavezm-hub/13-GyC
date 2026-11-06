-- GyC · 037_programa_arranque_r1.sql
-- Programa de Arranque según el formato CR-PG-SGP-01-F1 r1:
--   · Información del proyecto (pestaña 0): CR, inicio y fin contractual, inicio de movilización y de construcción
--   · Definición (cabecera amarilla, reunión de definición): responsable, inicio y fin programado, comentarios
--   · Seguimiento (cabecera verde, cada reunión de seguimiento): fecha de revisión, % avance acumulado,
--     comentarios y fin re-programado — un registro por ítem y por reunión (historial)
--   · Cuentas preasignadas con sus proyectos (miembros del proyecto al primer ingreso)
-- Ejecutar en el SQL Editor de Neon después de la 036. Se puede ejecutar más de una vez.

set client_min_messages = warning;

-- ── Información del proyecto ─────────────────────────────────────────────────
alter table public.proyectos
  add column if not exists cr                 text,
  add column if not exists inicio_contractual date,
  add column if not exists fin_contractual    date,
  add column if not exists fecha_movilizacion date,
  add column if not exists fecha_construccion date;

-- Lo que ya se hubiera cargado en la cabecera del programa de arranque pasa al proyecto
update public.proyectos p
   set cr = coalesce(p.cr, pa.cr_proyecto),
       fecha_movilizacion = coalesce(p.fecha_movilizacion, pa.fecha_movilizacion),
       fecha_construccion = coalesce(p.fecha_construccion, pa.fecha_construccion)
  from public.programa_arranque pa
 where pa.proyecto_id = p.id
   and (pa.cr_proyecto is not null or pa.fecha_movilizacion is not null or pa.fecha_construccion is not null);

-- ── Definición (amarillo) ────────────────────────────────────────────────────
alter table public.programa_arranque_detalle
  add column if not exists responsable_id    text,          -- profiles.id (TEXT, sin FK)
  add column if not exists inicio_programado date,
  add column if not exists fin_programado    date;

update public.programa_arranque_detalle
   set inicio_programado = fecha_plan
 where inicio_programado is null and fecha_plan is not null;

-- ── Seguimiento (verde): una fila por ítem y reunión ─────────────────────────
create table if not exists public.programa_arranque_seguimiento (
  id               uuid primary key default gen_random_uuid(),
  programa_id      uuid not null references public.programa_arranque(id) on delete cascade,
  item_codigo      text not null references public.programa_arranque_items(item_codigo),
  fecha_revision   date not null,
  avance           numeric(5,2) check (avance between 0 and 100),   -- % avance acumulado
  comentarios      text,
  fin_reprogramado date,
  created_by       text,                                            -- profiles.id (TEXT, sin FK)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (programa_id, item_codigo, fecha_revision)
);
create index if not exists programa_arranque_seguimiento_prog_idx
  on public.programa_arranque_seguimiento (programa_id, fecha_revision);

drop trigger if exists trg_programa_arranque_seguimiento_updated on public.programa_arranque_seguimiento;
create trigger trg_programa_arranque_seguimiento_updated before update on public.programa_arranque_seguimiento
  for each row execute function public.tg_set_updated_at();
drop trigger if exists trg_programa_arranque_detalle_updated on public.programa_arranque_detalle;
create trigger trg_programa_arranque_detalle_updated before update on public.programa_arranque_detalle
  for each row execute function public.tg_set_updated_at();

-- ── Cuentas preasignadas: también sus proyectos ──────────────────────────────
alter table public.cuentas_preasignadas
  add column if not exists nombre       text,
  add column if not exists proyecto_ids uuid[] not null default '{}';

create or replace function public.gyc_aplicar_preasignacion(p_id text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_p public.profiles;
  v_c public.cuentas_preasignadas;
begin
  select * into v_p from public.profiles where id = p_id;
  if not found or v_p.email is null then return; end if;
  select * into v_c from public.cuentas_preasignadas where email = lower(v_p.email);
  if not found then return; end if;
  update public.profiles
     set area_id = coalesce(v_c.area_id, v_p.area_id, (select id from public.areas where activa order by created_at limit 1)),
         rol = v_c.rol,
         activo = true,
         eliminado = false,
         nombre = case when coalesce(v_p.nombre, '') in ('', v_p.email, split_part(v_p.email, '@', 1)) and v_c.nombre is not null
                       then v_c.nombre else v_p.nombre end,
         es_plataforma = v_p.es_plataforma or v_c.es_plataforma,
         es_admin_principal = v_p.es_admin_principal or v_c.es_admin_principal
   where id = p_id;
  insert into public.proyecto_lideres (proyecto_id, usuario_id)
  select x, p_id from unnest(v_c.proyecto_ids) x
   where exists (select 1 from public.proyectos where id = x)
  on conflict do nothing;
  update public.cuentas_preasignadas set aplicada_at = now() where email = v_c.email;
end $$;

drop trigger if exists trg_preasignacion_existente on public.cuentas_preasignadas;
create trigger trg_preasignacion_existente
  after insert or update of area_id, rol, es_admin_principal, es_plataforma, proyecto_ids, nombre on public.cuentas_preasignadas
  for each row execute function public.tg_preasignacion_existente();

-- El respaldo de la empresa incluye el seguimiento del programa de arranque
create or replace function public.exportar_respaldo_area(p_area uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v jsonb := jsonb_build_object('generado', now(), 'version', 3, 'area_id', p_area);
  v_tmp jsonb;
  t text;
begin
  foreach t in array array[
    'listas','parametros','permisos','proyectos','portafolios','programas','hitos','cartera','actividades',
    'restricciones','cierres','pac_historico','plantillas','ubicaciones_dia','reuniones','acuerdos','comentarios',
    'enlaces','columnas_personalizadas','vistas','solicitudes_cambio','delegado_historial','organigrama_nodos',
    'supervisiones']
  loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x where x.area_id = $1', t)
      into v_tmp using p_area;
    v := v || jsonb_build_object(t, v_tmp);
  end loop;
  v := v || jsonb_build_object(
    'areas', (select coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.areas a where a.id = p_area),
    'profiles', (select coalesce(jsonb_agg(to_jsonb(p)), '[]') from public.profiles p
                  where p.area_id = p_area or p.id in (select usuario_id from public.empresa_miembros where area_id = p_area)),
    'lista_valores', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.lista_valores x
                       where x.lista_id in (select id from public.listas where area_id = p_area)),
    'proyecto_lideres', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.proyecto_lideres x
                          where x.proyecto_id in (select id from public.proyectos where area_id = p_area)),
    'plantilla_items', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.plantilla_items x
                         where x.plantilla_id in (select id from public.plantillas where area_id = p_area)),
    'programa_arranque', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.programa_arranque x
                           where x.proyecto_id in (select id from public.proyectos where area_id = p_area)),
    'programa_arranque_detalle', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.programa_arranque_detalle x
                                   join public.programa_arranque pa on pa.id = x.programa_id
                                   join public.proyectos p on p.id = pa.proyecto_id where p.area_id = p_area),
    'programa_arranque_seguimiento', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.programa_arranque_seguimiento x
                                       join public.programa_arranque pa on pa.id = x.programa_id
                                       join public.proyectos p on p.id = pa.proyecto_id where p.area_id = p_area));
  return v;
end $$;

do $$
begin
  assert exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'proyectos' and column_name = 'inicio_contractual'),
    'Falta proyectos.inicio_contractual';
  assert exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'programa_arranque_seguimiento'),
    'Falta programa_arranque_seguimiento';
  raise notice '✓ Migración 037_programa_arranque_r1 ejecutada correctamente.';
end $$;
