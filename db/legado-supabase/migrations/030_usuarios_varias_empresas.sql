-- LPS-GES · 030 · Un usuario en varias empresas (p. ej. super administrador de dos empresas)
-- Diseño que solo AGREGA: cada perfil sigue teniendo su empresa activa (profiles.area_id, con la que trabajan todas las
-- reglas de seguridad) y empresa_miembros registra a qué otras empresas pertenece y con qué rol. El usuario cambia de
-- empresa activa desde el menú (Edge Function admin-usuarios › cambiar_empresa). Lo que antes funcionaba sigue igual:
-- «pertenece a la empresa» = empresa activa O membresía.
-- Se puede ejecutar más de una vez.

create table if not exists public.empresa_miembros (
  usuario_id         uuid not null references public.profiles(id) on delete cascade,
  area_id            uuid not null references public.areas(id) on delete cascade,
  rol                text not null,
  activo             boolean not null default true,
  es_admin_principal boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  primary key (usuario_id, area_id)
);
create index if not exists empresa_miembros_area_idx on public.empresa_miembros (area_id);
alter table public.empresa_miembros enable row level security;
drop policy if exists miembros_sel on public.empresa_miembros;
-- Lectura: las propias membresías y las de la empresa activa (para el equipo). La escritura la hace el servidor.
create policy miembros_sel on public.empresa_miembros for select to authenticated
  using (usuario_id = (select auth.uid()) or (area_id = (select public.mi_area()) and (select public.es_miembro())));
grant select on public.empresa_miembros to authenticated;

-- ¿El usuario pertenece a la empresa? (empresa activa o membresía activa)
create or replace function public.pertenece(p_usuario uuid, p_area uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles where id = p_usuario and area_id = p_area)
      or exists (select 1 from public.empresa_miembros where usuario_id = p_usuario and area_id = p_area and activo)
$$;
revoke execute on function public.pertenece(uuid, uuid) from public, anon;
grant execute on function public.pertenece(uuid, uuid) to authenticated;

-- La empresa activa de cada perfil queda registrada como membresía con su rol (los propietarios de la plataforma no:
-- administran todas las empresas sin pertenecer a ellas). MOVER a alguien de empresa (cambiar profiles.area_id) le quita
-- la membresía anterior; solo el cambio de empresa activa hecho por el sistema (lpsgt.cambio_empresa) la conserva.
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
    set rol = excluded.rol, activo = excluded.activo, es_admin_principal = excluded.es_admin_principal, updated_at = now();
  return new;
end $$;
revoke execute on function public.tg_sync_miembro() from public, anon, authenticated;
drop trigger if exists trg_profiles_miembro on public.profiles;
create trigger trg_profiles_miembro after insert or update of area_id, rol, activo, es_admin_principal, eliminado on public.profiles
  for each row execute function public.tg_sync_miembro();

insert into public.empresa_miembros (usuario_id, area_id, rol, activo, es_admin_principal)
select id, area_id, rol, activo, es_admin_principal from public.profiles
 where area_id is not null and not coalesce(eliminado, false) and not coalesce(es_plataforma, false)
on conflict (usuario_id, area_id) do nothing;

-- El equipo de la empresa activa también ve a sus miembros que hoy trabajan en otra empresa (nombres en el historial)
alter policy profiles_sel on public.profiles
  using (id = (select auth.uid())
         or ((area_id = (select public.mi_area())
              or exists (select 1 from public.empresa_miembros m
                          where m.usuario_id = profiles.id and m.area_id = (select public.mi_area()) and m.activo))
             and (select public.es_miembro())));

-- Líderes de proyecto: cualquier miembro de la empresa
alter policy proy_lideres_ins on public.proyecto_lideres
  with check ((select public.es_gestor())
              and exists (select 1 from public.proyectos p where p.id = proyecto_lideres.proyecto_id and p.area_id = (select public.mi_area()))
              and public.pertenece(proyecto_lideres.usuario_id, (select public.mi_area())));
alter policy proy_lideres_upd on public.proyecto_lideres
  using ((select public.es_gestor())
         and exists (select 1 from public.proyectos p where p.id = proyecto_lideres.proyecto_id and p.area_id = (select public.mi_area())))
  with check ((select public.es_gestor())
              and exists (select 1 from public.proyectos p where p.id = proyecto_lideres.proyecto_id and p.area_id = (select public.mi_area()))
              and public.pertenece(proyecto_lideres.usuario_id, (select public.mi_area())));

-- Referencias a personas (responsable, solicitante, etc.): basta con que pertenezca a la empresa
create or replace function public.tg_misma_area() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  i int;
  v_col text;
  v_tab text;
  v_id uuid;
  v_ok boolean;
  v_nuevo jsonb := to_jsonb(new);
  v_viejo jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
begin
  if auth.uid() is null then return new; end if;           -- SQL directo, migraciones y servicio
  for i in 0 .. tg_nargs - 1 loop
    v_col := split_part(tg_argv[i], ':', 1);
    v_tab := split_part(tg_argv[i], ':', 2);
    v_id := nullif(v_nuevo ->> v_col, '')::uuid;
    continue when v_id is null;
    continue when tg_op = 'UPDATE' and v_viejo ->> v_col is not distinct from v_nuevo ->> v_col
                  and (v_tab <> '*' or v_viejo ->> 'entidad' is not distinct from v_nuevo ->> 'entidad');
    if v_tab = '*' then
      v_tab := case v_nuevo ->> 'entidad' when 'actividad' then 'actividades' when 'restriccion' then 'restricciones'
                                          when 'proyecto' then 'proyectos' when 'cartera' then 'cartera' end;
    end if;
    if v_tab = 'lista_valores' then
      select exists (select 1 from public.lista_valores v join public.listas l on l.id = v.lista_id
                      where v.id = v_id and (l.area_id is null or l.area_id = new.area_id)) into v_ok;
    elsif v_tab = 'profiles' then
      v_ok := public.pertenece(v_id, new.area_id);
    elsif v_tab in ('proyectos','actividades','restricciones','cartera','reuniones','listas','organigrama_nodos') then
      execute format('select exists (select 1 from public.%I where id = $1 and area_id = $2)', v_tab)
        using v_id, new.area_id into v_ok;
    else
      raise exception 'tg_misma_area: tabla no prevista %', v_tab;
    end if;
    if not v_ok then
      raise exception 'Referencia no válida en "%": el registro no existe o pertenece a otra área.', v_col
        using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;

-- Protección de perfiles: cambio de empresa activa hecho por el propio sistema (retirar a alguien de una empresa)
create or replace function public.tg_proteger_perfil() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
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
  if coalesce(current_setting('lpsgt.cambio_empresa', true), '') = 'on' then return new; end if;
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
    if not public.es_admin() then
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

-- Pasa al usuario a otra de sus empresas (la primera que tenga) cuando deja la actual. Devuelve false si no tiene otra.
create or replace function public.mover_a_otra_empresa(p_usuario uuid, p_dejar uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare m public.empresa_miembros;
begin
  select * into m from public.empresa_miembros
   where usuario_id = p_usuario and area_id <> p_dejar and activo order by created_at limit 1;
  if not found then return false; end if;
  perform set_config('lpsgt.cambio_empresa', 'on', true);
  update public.profiles set area_id = m.area_id, rol = m.rol, activo = m.activo, es_admin_principal = m.es_admin_principal
   where id = p_usuario;
  perform set_config('lpsgt.cambio_empresa', 'off', true);
  return true;
end $$;
revoke execute on function public.mover_a_otra_empresa(uuid, uuid) from public, anon, authenticated;

-- Cambio de empresa activa de un usuario que pertenece a varias (lo pide él desde el menú, vía el servidor)
create or replace function public.cambiar_empresa_activa(p_usuario uuid, p_area uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare m public.empresa_miembros;
begin
  select * into m from public.empresa_miembros where usuario_id = p_usuario and area_id = p_area and activo;
  if not found then raise exception 'No pertenece a esa empresa.'; end if;
  perform set_config('lpsgt.cambio_empresa', 'on', true);
  update public.profiles set area_id = m.area_id, rol = m.rol, activo = m.activo, es_admin_principal = m.es_admin_principal
   where id = p_usuario;
  perform set_config('lpsgt.cambio_empresa', 'off', true);
end $$;
revoke execute on function public.cambiar_empresa_activa(uuid, uuid) from public, anon, authenticated;

-- Eliminar usuario desde una empresa: si pertenece a otras, solo se le retira de esta (su cuenta sigue)
create or replace function public.eliminar_usuario(p_usuario uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_obj public.profiles;
  v_area uuid := public.mi_area();
  v_rol text;
  v_principal boolean;
begin
  if auth.uid() is null or not public.es_admin() or not public.puede('eliminar_usuarios') then
    raise exception 'Solo el administrador puede eliminar usuarios.';
  end if;
  if not public.pertenece(p_usuario, v_area) then raise exception 'Usuario no encontrado.'; end if;
  select * into v_obj from public.profiles where id = p_usuario;
  if not found then raise exception 'Usuario no encontrado.'; end if;
  if v_obj.id = auth.uid() then raise exception 'No puede eliminarse a sí mismo.'; end if;
  select coalesce(m.rol, v_obj.rol), coalesce(m.es_admin_principal, v_obj.es_admin_principal and v_obj.area_id = v_area)
    into v_rol, v_principal
    from (select 1) x left join public.empresa_miembros m on m.usuario_id = p_usuario and m.area_id = v_area;
  if v_principal then raise exception 'El administrador principal no se puede eliminar.'; end if;
  if v_rol in ('superadmin','admin') and not public.es_superadmin() then
    raise exception 'Solo el super administrador elimina a un administrador.';
  end if;

  -- Pertenece también a otras empresas: solo se le retira de esta
  if exists (select 1 from public.empresa_miembros where usuario_id = p_usuario and area_id <> v_area and activo) then
    delete from public.proyecto_lideres where usuario_id = p_usuario
       and proyecto_id in (select id from public.proyectos where area_id = v_area);
    if v_obj.area_id = v_area then perform public.mover_a_otra_empresa(p_usuario, v_area); end if;
    delete from public.empresa_miembros where usuario_id = p_usuario and area_id = v_area;
    return 'retirado';
  end if;
  if v_obj.area_id <> v_area then raise exception 'Usuario no encontrado.'; end if;

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

-- Eliminar empresa: quien pertenece también a otra empresa no se elimina; pasa a otra de sus empresas
create or replace function public.eliminar_empresa(p_area uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  if not exists (select 1 from public.areas where id = p_area) then
    raise exception 'Empresa no encontrada.';
  end if;
  if exists (select 1 from public.profiles where area_id = p_area and es_plataforma) then
    raise exception 'Un propietario de la plataforma está trabajando en esa empresa. Que abra otra empresa primero.';
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
  delete from public.plantilla_items where plantilla_id in (select id from public.plantillas where area_id = p_area)
                                        or proyecto_id in (select id from public.proyectos where area_id = p_area);
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
  delete from public.areas where id = p_area;                  -- sus membresías se borran en cascada
  perform set_config('lpsgt.cierre_en_curso', 'off', true);
  perform set_config('lpsgt.eliminando_empresa', 'off', true);
end $$;
revoke execute on function public.eliminar_empresa(uuid) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.eliminar_empresa(uuid) to service_role;
    grant all on public.empresa_miembros to service_role;
    grant execute on function public.cambiar_empresa_activa(uuid, uuid) to service_role;
    grant execute on function public.mover_a_otra_empresa(uuid, uuid) to service_role;
  end if;
end $$;
