-- GyC · 036_cuentas_preasignadas.sql
-- Roles asignados por correo ANTES de que la persona ingrese por primera vez con Clerk.
-- Al primer ingreso, gyc_alta_usuario aplica la preasignación (empresa, rol, principal, propietario de la plataforma)
-- en lugar de dejar a la persona "pendiente". Si el perfil ya existe, se aplica de inmediato.
-- Ejecutar en el SQL Editor de Neon después de la 035. Se puede ejecutar más de una vez.
--
-- Uso (en el SQL Editor):
--   insert into cuentas_preasignadas (email, rol, es_plataforma, area_id)
--   values ('persona@empresa.com', 'superadmin', true, (select id from areas where nombre = 'Cosapi'))
--   on conflict (email) do update set rol = excluded.rol, es_plataforma = excluded.es_plataforma,
--     es_admin_principal = excluded.es_admin_principal, area_id = excluded.area_id;

set client_min_messages = warning;

create table if not exists public.cuentas_preasignadas (
  email              text primary key check (email = lower(email)),
  area_id            uuid references public.areas(id) on delete cascade,
  rol                text not null default 'lider'
                     check (rol in ('superadmin','admin','delegado','lider','consulta')),
  es_admin_principal boolean not null default false,
  es_plataforma      boolean not null default false,
  aplicada_at        timestamptz,
  created_at         timestamptz not null default now()
);

-- Aplica una preasignación a un perfil existente
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
         es_plataforma = v_p.es_plataforma or v_c.es_plataforma,
         es_admin_principal = v_p.es_admin_principal or v_c.es_admin_principal
   where id = p_id;
  update public.cuentas_preasignadas set aplicada_at = now() where email = v_c.email;
end $$;

-- Alta del perfil al primer ingreso (reemplaza la de la 035): primero la preasignación por correo
create or replace function public.gyc_alta_usuario(p_id text, p_nombre text, p_email text)
returns setof public.profiles
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_area uuid;
  v_primero boolean;
  v_pre boolean;
begin
  perform pg_advisory_xact_lock(hashtext('gyc_alta_usuario'));
  if exists (select 1 from public.profiles where id = p_id) then
    return query select * from public.profiles where id = p_id;
    return;
  end if;
  select id into v_area from public.areas where activa order by created_at limit 1;
  select exists (select 1 from public.cuentas_preasignadas where email = lower(nullif(p_email, ''))) into v_pre;
  select not v_pre and not exists (select 1 from public.profiles where not eliminado) into v_primero;
  insert into public.profiles (id, area_id, email, nombre, rol, es_admin_principal, es_plataforma, activo)
  values (p_id, v_area, lower(nullif(p_email, '')), coalesce(nullif(p_nombre, ''), split_part(p_email, '@', 1), p_id),
          case when v_primero then 'superadmin' else 'pendiente' end, v_primero, v_primero, true);
  if v_pre then
    perform public.gyc_aplicar_preasignacion(p_id);
  elsif not v_primero and v_area is not null then
    insert into public.notificaciones (usuario_id, tipo, texto, ruta)
    select p.id, 'usuario_nuevo', 'Nuevo usuario por aprobar: ' || coalesce(p_email, p_nombre, p_id), '#/config/usuarios'
      from public.profiles p
     where p.area_id = v_area and p.rol in ('superadmin','admin','delegado') and p.activo and not p.eliminado;
  end if;
  return query select * from public.profiles where id = p_id;
end $$;

-- Preasignación nueva o cambiada para alguien que ya ingresó: se aplica de inmediato
create or replace function public.tg_preasignacion_existente() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id text;
begin
  for v_id in select id from public.profiles where lower(email) = new.email loop
    perform public.gyc_aplicar_preasignacion(v_id);
  end loop;
  return new;
end $$;
drop trigger if exists trg_preasignacion_existente on public.cuentas_preasignadas;
create trigger trg_preasignacion_existente
  after insert or update of area_id, rol, es_admin_principal, es_plataforma on public.cuentas_preasignadas
  for each row execute function public.tg_preasignacion_existente();

do $$
begin
  assert exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'cuentas_preasignadas'),
    'Falta la tabla cuentas_preasignadas';
  raise notice '✓ Migración 036_cuentas_preasignadas ejecutada correctamente.';
end $$;
