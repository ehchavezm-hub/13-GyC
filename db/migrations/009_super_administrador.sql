-- LPS-GES · 009 · Rol Super administrador
-- superadmin: todos los permisos siempre; único que asigna superadmin / admin / delegado y que edita
--             la columna "Administrador" de la matriz de permisos. El administrador principal pasa a superadmin.
-- admin:      ya no tiene todo fijo: usa la columna "admin" de la matriz (por defecto, todo permitido).

create or replace function public.es_superadmin() returns boolean
language sql stable as $$ select public.mi_rol() = 'superadmin' or public.es_admin_principal() $$;
create or replace function public.es_admin() returns boolean
language sql stable as $$ select public.mi_rol() in ('superadmin','admin') $$;

-- Restricciones de rol
alter table public.profiles drop constraint if exists profiles_rol_check;
alter table public.profiles add constraint profiles_rol_check
  check (rol in ('superadmin','admin','delegado','consulta','pendiente') or public.rol_planifica(rol));
alter table public.permisos drop constraint if exists permisos_rol_check;
alter table public.permisos add constraint permisos_rol_check
  check (rol in ('admin','delegado','consulta') or public.rol_planifica(rol));

create or replace function public.es_miembro() returns boolean
language sql stable as $$ select public.mi_rol() in ('superadmin','admin','delegado','consulta') or public.rol_planifica(public.mi_rol()) $$;
create or replace function public.es_staff() returns boolean
language sql stable as $$ select public.mi_rol() in ('superadmin','admin','delegado') or public.rol_planifica(public.mi_rol()) $$;
create or replace function public.es_gestor() returns boolean
language sql stable as $$ select public.mi_rol() in ('superadmin','admin','delegado') $$;

create or replace function public.puede(p_accion text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when public.mi_rol() = 'superadmin' then true
    when public.mi_rol() = 'admin' then coalesce(
      (select permitido from public.permisos where area_id = public.mi_area() and rol = 'admin' and accion = p_accion), true)
    when public.mi_rol() in ('delegado','consulta') or public.rol_planifica(public.mi_rol()) then coalesce(
      (select permitido from public.permisos
        where area_id = public.mi_area() and rol = public.mi_rol() and accion = p_accion),
      (select permitido from public.permisos
        where area_id = public.mi_area() and rol = 'lider' and accion = p_accion
          and public.rol_planifica(public.mi_rol())),
      false)
    else false end
$$;

-- El principal pasa a superadmin (antes de cambiar la protección de perfiles)
update public.profiles set rol = 'superadmin' where es_admin_principal and rol = 'admin';

-- Alta: el primer usuario de un área es superadmin principal
create or replace function public.tg_nuevo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_area uuid;
  v_hay_admin boolean;
  v_por_admin boolean := coalesce(new.raw_app_meta_data, '{}'::jsonb) ? 'creado_por';
begin
  v_area := nullif(new.raw_app_meta_data->>'area_id', '')::uuid;
  if v_area is null or not exists (select 1 from public.areas where id = v_area) then
    select id into v_area from public.areas where activa order by created_at limit 1;
  end if;
  select exists (select 1 from public.profiles where area_id = v_area and rol in ('superadmin','admin')) into v_hay_admin;
  insert into public.profiles (id, area_id, email, nombre, rol, es_admin_principal, debe_cambiar_clave)
  values (new.id, v_area, new.email,
          coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)),
          case when v_hay_admin then 'pendiente' else 'superadmin' end,
          not v_hay_admin, v_por_admin);
  if v_hay_admin and not v_por_admin then
    insert into public.notificaciones (usuario_id, tipo, texto, ruta)
    select p.id, 'usuario_nuevo', 'Nuevo usuario por aprobar: ' || coalesce(new.email, ''), '#/config/usuarios'
      from public.profiles p where p.area_id = v_area and p.rol in ('superadmin','admin','delegado') and p.activo;
  end if;
  return new;
end $$;

-- Protección de perfiles: solo el superadmin asigna o retira superadmin / admin / delegado
create or replace function public.tg_proteger_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_yo public.profiles;
  v_super boolean;
begin
  if new.rol = 'delegado' and old.rol <> 'delegado' then
    insert into public.delegado_historial (area_id, usuario_id, otorgado_por) values (new.area_id, new.id, auth.uid());
  elsif old.rol = 'delegado' and new.rol <> 'delegado' then
    update public.delegado_historial set hasta = now() where usuario_id = new.id and hasta is null;
  end if;

  if auth.uid() is null then return new; end if;            -- SQL directo / servicio
  select * into v_yo from public.profiles where id = auth.uid();
  v_super := v_yo.rol = 'superadmin' or v_yo.es_admin_principal;

  if new.es_admin_principal is distinct from old.es_admin_principal then
    raise exception 'El administrador principal solo se cambia desde la base de datos.';
  end if;
  if old.es_admin_principal and (new.rol is distinct from old.rol or not new.activo) then
    raise exception 'El administrador principal no puede perder su rol ni desactivarse.';
  end if;

  if (new.rol, new.activo, new.area_id, new.gerencia_ids)
     is distinct from (old.rol, old.activo, old.area_id, old.gerencia_ids) then
    if not public.puede('gestionar_usuarios') then
      raise exception 'No tiene permiso para cambiar roles, gerencias o el estado de usuarios.';
    end if;
    if old.rol in ('superadmin','admin') and not v_super and new.id <> v_yo.id then
      raise exception 'Solo el super administrador modifica a un administrador.';
    end if;
    if (old.rol in ('superadmin','admin','delegado') or new.rol in ('superadmin','admin','delegado'))
       and new.rol is distinct from old.rol and not v_super then
      raise exception 'Solo el super administrador asigna o retira los roles de super administrador, administrador y delegado.';
    end if;
  end if;
  return new;
end $$;

create or replace function public.notificar_gestores(p_area uuid, p_tipo text, p_texto text, p_ruta text)
returns void language sql security definer set search_path = public as $$
  insert into public.notificaciones (usuario_id, tipo, texto, ruta)
  select id, p_tipo, p_texto, p_ruta from public.profiles
   where area_id = p_area and rol in ('superadmin','admin','delegado') and activo and id is distinct from auth.uid()
$$;
revoke execute on function public.notificar_gestores(uuid, text, text, text) from public, anon, authenticated;

-- Políticas que exigían rol 'admin'
drop policy if exists areas_upd on public.areas;
create policy areas_upd on public.areas for update to authenticated using (id = public.mi_area() and public.es_admin());
drop policy if exists profiles_del on public.profiles;
create policy profiles_del on public.profiles for delete to authenticated
  using (area_id = public.mi_area() and public.es_superadmin() and not es_admin_principal);
-- Matriz de permisos: administradores la editan; la columna "admin" solo el superadmin
drop policy if exists permisos_ins on public.permisos;
drop policy if exists permisos_upd on public.permisos;
create policy permisos_ins on public.permisos for insert to authenticated
  with check (area_id = public.mi_area() and public.es_admin() and (rol <> 'admin' or public.es_superadmin()));
create policy permisos_upd on public.permisos for update to authenticated
  using (area_id = public.mi_area() and public.es_admin() and (rol <> 'admin' or public.es_superadmin()))
  with check (area_id = public.mi_area() and public.es_admin() and (rol <> 'admin' or public.es_superadmin()));

-- Acciones nuevas en la matriz (antes fijas del administrador)
insert into public.permisos (area_id, rol, accion, permitido)
select a.id, r.rol, x.accion, r.rol = 'admin'
  from public.areas a
 cross join (values ('admin'), ('delegado')) r(rol)
 cross join (values ('eliminar_usuarios'), ('exportar_respaldo')) x(accion)
on conflict do nothing;

-- Eliminar usuarios: administradores con permiso; a un administrador solo lo elimina el superadmin
create or replace function public.eliminar_usuario(p_usuario uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_obj public.profiles;
begin
  if auth.uid() is null or not public.es_admin() or not public.puede('eliminar_usuarios') then
    raise exception 'Solo el administrador puede eliminar usuarios.';
  end if;
  select * into v_obj from public.profiles where id = p_usuario and area_id = public.mi_area();
  if not found then raise exception 'Usuario no encontrado.'; end if;
  if v_obj.id = auth.uid() then raise exception 'No puede eliminarse a sí mismo.'; end if;
  if v_obj.es_admin_principal then raise exception 'El administrador principal no se puede eliminar.'; end if;
  if v_obj.rol in ('superadmin','admin') and not public.es_superadmin() then
    raise exception 'Solo el super administrador elimina a un administrador.';
  end if;

  begin
    delete from auth.users where id = p_usuario;
    return 'eliminado';
  exception when foreign_key_violation then
    null;
  end;

  update auth.users
     set email = 'eliminado+' || p_usuario || '@lpsgt.invalid', banned_until = 'infinity'
   where id = p_usuario;
  update public.profiles
     set eliminado = true, activo = false, email = null,
         rol = case when rol in ('superadmin', 'admin', 'delegado') then 'lider' else rol end
   where id = p_usuario;
  delete from public.proyecto_lideres where usuario_id = p_usuario;
  return 'desactivado';
end $$;
revoke execute on function public.eliminar_usuario(uuid) from public, anon;
grant execute on function public.eliminar_usuario(uuid) to authenticated;

-- Respaldo completo: administradores con permiso (o service_role sin usuario)
create or replace function public.exportar_respaldo() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v jsonb := jsonb_build_object('generado', now(), 'version', 1);
  v_tmp jsonb;
  t text;
  v_area uuid := public.mi_area();
  v_filtrar boolean := auth.uid() is not null;
  v_tiene_area boolean;
  v_rol_jwt text := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                             nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
begin
  if not v_filtrar and v_rol_jwt is not null and v_rol_jwt <> 'service_role' then
    raise exception 'No autorizado.';
  end if;
  if v_filtrar and not (public.es_admin() and public.puede('exportar_respaldo')) then
    raise exception 'Solo el administrador puede exportar el respaldo completo.';
  end if;
  foreach t in array array['areas','profiles','listas','lista_valores','parametros','permisos','proyectos',
    'proyecto_lideres','hitos','cartera','actividades','restricciones','cierres','pac_historico','plantillas',
    'plantilla_items','ubicaciones_dia','reuniones','acuerdos','comentarios','enlaces','columnas_personalizadas',
    'vistas','solicitudes_cambio','delegado_historial']
  loop
    select exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = t and column_name = 'area_id')
      into v_tiene_area;
    if v_filtrar and v_tiene_area then
      execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x
                       where x.area_id = $1 or x.area_id is null', t) into v_tmp using v_area;
    elsif v_filtrar and t = 'areas' then
      execute 'select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.areas x where x.id = $1'
        into v_tmp using v_area;
    else
      execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x', t) into v_tmp;
    end if;
    v := v || jsonb_build_object(t, v_tmp);
  end loop;
  return v;
end $$;
revoke execute on function public.exportar_respaldo() from public, anon;
grant execute on function public.exportar_respaldo() to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.exportar_respaldo() to service_role;
  end if;
end $$;
