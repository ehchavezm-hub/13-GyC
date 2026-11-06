-- Pruebas de reglas de negocio y seguridad (se ejecutan con run.sh)
\set ON_ERROR_STOP 1

create or replace function public.debe_fallar(p_sql text, p_msg text default '') returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if p_msg <> '' and position(p_msg in sqlerrm) = 0 then
      raise exception 'Falló con un mensaje inesperado: % (esperado: %)', sqlerrm, p_msg;
    end if;
    return;
  end;
  raise exception 'Se esperaba un error y no ocurrió: %', p_sql;
end $$;
grant execute on function public.debe_fallar(text, text) to authenticated;

create or replace function public.como(p_email text) returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claim.sub', (select id::text from auth.users where email = p_email), false);
end $$;
grant execute on function public.como(text) to authenticated;

-- Usuarios: el primero es administrador principal
insert into auth.users (email, raw_user_meta_data) values
  ('admin@x.pe', '{"nombre":"Admin"}'), ('lider1@x.pe', '{"nombre":"Lider Uno"}'),
  ('lider2@x.pe', '{"nombre":"Lider Dos"}'), ('consulta@x.pe', '{}'), ('delegado@x.pe', '{}');

do $$
begin
  assert (select rol from profiles p join auth.users u on u.id = p.id where u.email = 'admin@x.pe') = 'superadmin', 'primer usuario no es superadmin';
  assert (select es_admin_principal from profiles p join auth.users u on u.id = p.id where u.email = 'admin@x.pe'), 'no es principal';
  assert (select rol from profiles p join auth.users u on u.id = p.id where u.email = 'lider1@x.pe') = 'pendiente', 'segundo no pendiente';
  assert (select count(*) from notificaciones where tipo = 'usuario_nuevo') = 4, 'faltan avisos de usuario nuevo';
  assert (select count(*) from listas) >= 18, 'listas no sembradas';
  assert (select count(*) from permisos) = 138, 'matriz de permisos incompleta (20 acciones × 6 roles + 2 acciones nuevas × admin y delegado + 2 acciones × 7 roles de la 018)';
end $$;

-- Datos base (como superusuario)
update profiles set rol = 'lider' where email in ('lider1@x.pe', 'lider2@x.pe');
update profiles set rol = 'delegado' where email = 'delegado@x.pe';
update profiles set rol = 'consulta',
  gerencia_ids = array[(select lv.id from lista_valores lv join listas l on l.id = lv.lista_id where l.clave = 'gerencias' and lv.codigo = 'GI')]
  where email = 'consulta@x.pe';

insert into proyectos (area_id, codigo, nombre_corto, gerencia_id, estado)
select a.id, 'P-1', 'Proyecto GI', (select lv.id from lista_valores lv join listas l on l.id = lv.lista_id where l.clave='gerencias' and lv.codigo='GI'), 'activo' from areas a;
insert into proyectos (area_id, codigo, nombre_corto, gerencia_id, estado)
select a.id, 'P-2', 'Proyecto GOC', (select lv.id from lista_valores lv join listas l on l.id = lv.lista_id where l.clave='gerencias' and lv.codigo='GOC'), 'activo' from areas a;

-- ---------- Líder ----------
set role authenticated;
-- PPT v5: "crear_cartera" del líder parte en falso; el administrador lo habilita para que proponga proyectos
select como('admin@x.pe');
update permisos set permitido = true where rol = 'lider' and accion = 'crear_cartera';
select como('lider1@x.pe');

insert into actividades (area_id, semana, responsable_id, proyecto_id, descripcion, comprometida, hh_lu)
values (mi_area(), date_trunc('week', current_date)::date, auth.uid(),
        (select id from proyectos where codigo = 'P-1'), 'Actividad propia', true, 2);

select debe_fallar($q$
  insert into actividades (area_id, semana, responsable_id, descripcion)
  values (mi_area(), date_trunc('week', current_date)::date,
          (select id from profiles where email = 'lider2@x.pe'), 'Para otro líder') $q$, 'row-level security');

select debe_fallar($q$ insert into actividades (area_id, semana, responsable_id, descripcion)
  values (mi_area(), current_date - extract(isodow from current_date)::int + 2, auth.uid(), 'No es lunes') $q$);

do $$ begin assert (select hh_total from actividades where descripcion = 'Actividad propia') = 2, 'hh_total'; end $$;
-- Sincronización de la grilla: la fila nueva lleva un id creado en el navegador; un reintento con el mismo id se rechaza
-- («duplicate key») y la app lo toma como ya guardado: no hay duplicados
insert into actividades (id, area_id, semana, responsable_id, descripcion)
values ('5c1d0000-0000-4000-8000-000000000001', mi_area(), date_trunc('week', current_date)::date, auth.uid(), 'Con id del navegador');
select debe_fallar($q$ insert into actividades (id, area_id, semana, responsable_id, descripcion)
  values ('5c1d0000-0000-4000-8000-000000000001', mi_area(), date_trunc('week', current_date)::date, auth.uid(), 'Reintento') $q$, 'duplicate key');
do $$ begin assert (select count(*) from actividades where id = '5c1d0000-0000-4000-8000-000000000001') = 1, 'id del navegador'; end $$;
delete from actividades where id = '5c1d0000-0000-4000-8000-000000000001';   -- solo base de pruebas local

-- Cierre: no se puede con compromisos sin estado
select debe_fallar($q$ insert into cierres (area_id, responsable_id, semana)
  values (mi_area(), auth.uid(), date_trunc('week', current_date)::date) $q$, 'sin estado final');

update actividades set estado = 'no_completado' where descripcion = 'Actividad propia';
select debe_fallar($q$ insert into cierres (area_id, responsable_id, semana)
  values (mi_area(), auth.uid(), date_trunc('week', current_date)::date) $q$, 'sin causa');

update actividades set cnc_id = (select lv.id from lista_valores lv join listas l on l.id = lv.lista_id
  where l.clave = 'cnc' order by lv.orden limit 1) where descripcion = 'Actividad propia';
insert into cierres (area_id, responsable_id, semana) values (mi_area(), auth.uid(), date_trunc('week', current_date)::date);

select debe_fallar($q$ update actividades set descripcion = 'cambio' where descripcion = 'Actividad propia' $q$, 'está cerrada');
update cierres set cerrada = false;  -- el líder no reabre: RLS no le muestra la fila para actualizar
do $$ begin assert (select cerrada from cierres limit 1), 'el líder reabrió la semana'; end $$;

-- Proyectos (matriz PPT v5, migración 020): con "crear_cartera" el líder propone; las altas directas
-- son del administrador o el delegado
insert into proyectos (area_id, codigo, nombre_corto, estado, propuesto_por)
values (mi_area(), 'P-3', 'Propuesto por líder', 'propuesto', auth.uid());
select debe_fallar($q$ insert into proyectos (area_id, codigo, nombre_corto, estado)
  values (mi_area(), 'P-4', 'Activo directo', 'activo') $q$, 'row-level security');

-- Listas: el líder no edita
select debe_fallar($q$ insert into lista_valores (lista_id, valor)
  values ((select id from listas where clave = 'cnc'), 'Nueva causa') $q$, 'row-level security');

-- Comentario con mención
insert into comentarios (area_id, entidad, entidad_id, texto, menciones)
values (mi_area(), 'actividad', (select id from actividades limit 1), 'Revisar @Lider Dos',
        array[(select id from profiles where email = 'lider2@x.pe')]);

select debe_fallar($q$ select exportar_respaldo() $q$, 'Solo el administrador');

-- ---------- Delegado ----------
select como('delegado@x.pe');
-- PPT v5: gestionar usuarios es solo del administrador; la RLS no le deja actualizar perfiles ajenos
update profiles set rol = 'lider' where email = 'admin@x.pe';
update profiles set rol = 'delegado' where email = 'lider2@x.pe';
do $$ begin
  assert (select rol from profiles where email = 'admin@x.pe') <> 'lider', 'el delegado cambió el rol del administrador';
  assert (select rol from profiles where email = 'lider2@x.pe') <> 'delegado', 'el delegado asignó el rol delegado';
end $$;
update profiles set nombre = 'Líder Dos' where email = 'lider2@x.pe';
update cierres set cerrada = false;
do $$ begin assert not (select cerrada from cierres limit 1), 'el delegado no pudo reabrir'; end $$;
update proyectos set estado = 'activo', aprobado_por = auth.uid(), aprobado_at = now() where codigo = 'P-3';
delete from profiles where email = 'lider2@x.pe';  -- RLS: el delegado no elimina usuarios
do $$ begin assert (select count(*) from profiles where email = 'lider2@x.pe') = 1, 'el delegado eliminó un usuario'; end $$;

-- Valores protegidos
select debe_fallar($q$ delete from lista_valores where codigo = 'completado' $q$, 'protegido');
update lista_valores set valor = 'Hecho' where codigo = 'completado';

-- ---------- Consulta ----------
-- PPT v5: "crear_solicitud" de consulta parte en falso; el administrador lo habilita en la matriz
select como('admin@x.pe');
update permisos set permitido = true where rol = 'consulta' and accion = 'crear_solicitud';
select como('consulta@x.pe');
do $$ begin
  assert (select count(*) from proyectos) = 1, 'consulta ve proyectos de otras gerencias';
  assert (select count(*) from actividades) = 1, 'consulta no ve actividades de su gerencia';
  assert (select count(*) from restricciones) = 0, 'consulta ve restricciones';
end $$;
insert into cartera (area_id, descripcion, origen, estado, solicitante_id)
values (mi_area(), 'Necesito metrados', 'solicitud', 'nueva', auth.uid());
select debe_fallar($q$ insert into cartera (area_id, descripcion) values (mi_area(), 'interna') $q$, 'row-level security');

-- ---------- Líder 2: notificaciones ----------
select como('lider2@x.pe');
do $$ begin
  assert (select count(*) from notificaciones where tipo = 'mencion') = 1, 'no llegó la mención';
  assert (select count(*) from actividades where descripcion = 'Actividad propia') = 1, 'líder no ve actividades del equipo';
end $$;
update actividades set descripcion = 'x' where descripcion = 'Actividad propia';
do $$ begin assert (select count(*) from actividades where descripcion = 'x') = 0, 'líder editó actividad ajena'; end $$;

-- ---------- Admin ----------
select como('admin@x.pe');
do $$ begin
  assert (select count(*) from notificaciones where tipo = 'proyecto_propuesto') = 1, 'sin aviso de proyecto propuesto';
  assert (select count(*) from notificaciones where tipo = 'solicitud_nueva') = 1, 'sin aviso de solicitud';
  assert jsonb_array_length(exportar_respaldo()->'actividades') = 1, 'respaldo incompleto';
  assert (select count(*) from auditoria where tabla = 'actividades') >= 3, 'auditoría vacía';
end $$;
update profiles set rol = 'delegado' where email = 'lider2@x.pe';
do $$ begin assert (select count(*) from delegado_historial where hasta is null) = 2, 'historial de delegado'; end $$;

-- ---------- Cierre automático ----------
reset role;
insert into actividades (area_id, semana, responsable_id, descripcion, comprometida)
select area_id, date_trunc('week', current_date)::date - 14, id, 'Semana vencida sin reportar', true
  from profiles where email = 'lider1@x.pe';
do $$ begin
  assert cerrar_semanas_vencidas() >= 1, 'no cerró semanas vencidas';
  assert (select estado from actividades where descripcion = 'Semana vencida sin reportar') = 'no_completado', 'estado no actualizado';
  assert (select lv.codigo from actividades a join lista_valores lv on lv.id = a.cnc_id
           where a.descripcion = 'Semana vencida sin reportar') = 'no_reportado', 'CNC no reportado';
end $$;

-- ---------- Funciones sensibles con la clave pública ----------
set role anon;
do $$ begin
  begin perform exportar_respaldo(); raise exception 'anon pudo exportar';
  exception when insufficient_privilege then null; end;
  begin perform cerrar_semanas_vencidas(); raise exception 'anon pudo cerrar semanas';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set role authenticated;
do $$ begin perform set_config('request.jwt.claim.sub', '', false); end $$;
do $$ begin perform set_config('request.jwt.claim.role', 'authenticated', false); end $$;
do $$ begin
  begin perform exportar_respaldo(); raise exception 'sin usuario pudo exportar';
  exception when raise_exception then if sqlerrm <> 'No autorizado.' then raise; end if; end;
  begin perform notificar_gestores(null, 'x', 'x', null); raise exception 'authenticated pudo notificar';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin perform set_config('request.jwt.claim.role', 'service_role', false); end $$;
set role service_role;
do $$ begin assert jsonb_array_length(exportar_respaldo()->'areas') >= 1, 'service_role sin respaldo'; end $$;
reset role;

-- ---------- Usuario creado por el administrador (Edge Function) ----------
insert into auth.users (email, raw_user_meta_data, raw_app_meta_data)
values ('creado@x.pe', '{"nombre":"Creado por admin"}', jsonb_build_object('creado_por', (select id from profiles where email = 'admin@x.pe')));
do $$ begin
  assert (select debe_cambiar_clave and rol = 'pendiente' from profiles where email = 'creado@x.pe'), 'perfil creado por admin';
  assert not exists (select 1 from notificaciones where texto like '%creado@x.pe%'), 'no debe avisar al crear por admin';
end $$;

-- ---------- Eliminar usuarios ----------
set role authenticated;
select como('delegado@x.pe');
do $$ begin
  begin perform eliminar_usuario((select id from profiles where email = 'creado@x.pe')); raise exception 'delegado pudo eliminar';
  exception when raise_exception then if sqlerrm not like 'Solo el administrador%' then raise; end if; end;
end $$;
select como('admin@x.pe');
do $$ begin
  -- sin historial: se borra por completo
  assert eliminar_usuario((select id from profiles where email = 'creado@x.pe')) = 'eliminado', 'debía eliminarse';
  -- con historial (lider1 tiene actividades): se conserva desactivado
  assert eliminar_usuario((select id from profiles where email = 'lider1@x.pe')) = 'desactivado', 'debía desactivarse';
  begin perform eliminar_usuario((select id from profiles where es_admin_principal)); raise exception 'eliminó al principal';
  exception when raise_exception then if sqlerrm not like 'No puede eliminarse%' and sqlerrm not like 'El administrador principal%' then raise; end if; end;
end $$;
reset role;
do $$ begin
  assert not exists (select 1 from auth.users where email = 'creado@x.pe'), 'cuenta no borrada';
  assert (select p.eliminado and not p.activo and p.email is null from profiles p join auth.users u on u.id = p.id
           where u.email like 'eliminado+%'), 'perfil con historial no desactivado';
  assert exists (select 1 from actividades a join profiles p on p.id = a.responsable_id where p.eliminado), 'historial perdido';
end $$;

-- ---------- Roles de planificación (021: un solo rol "lider") ----------
reset role;
do $$ begin perform set_config('request.jwt.claim.sub', '', false); end $$;
insert into auth.users (email) values ('equipo@x.pe'), ('actividad@x.pe');
update profiles set rol = 'lider' where email in ('equipo@x.pe', 'actividad@x.pe');
do $$ begin
  assert public.rol_planifica('lider') and not public.rol_planifica('resp_equipo'), 'solo el líder planifica';
  begin update profiles set rol = 'resp_actividad' where email = 'actividad@x.pe'; raise exception 'aceptó un rol retirado';
  exception when check_violation then null; end;
  begin update profiles set rol = 'inventado' where email = 'actividad@x.pe'; raise exception 'aceptó rol inválido';
  exception when check_violation then null; end;
end $$;
set role authenticated;
select como('equipo@x.pe');
do $$ begin
  assert es_staff() and es_miembro(), 'el líder debe planificar';
  assert not puede('cerrar_semana'), 'el líder no cierra semanas de otros por defecto';
end $$;
reset role;
do $$ begin perform set_config('request.jwt.claim.sub', '', false); end $$;

-- ---------- Super administrador (009) ----------
reset role;
do $$ begin perform set_config('request.jwt.claim.sub', '', false); end $$;
insert into auth.users (email) values ('admin2@x.pe');
update profiles set rol = 'admin' where email = 'admin2@x.pe';
set role authenticated;
select como('admin2@x.pe');
do $$ begin
  assert es_admin() and not es_superadmin(), 'admin2 es admin, no super';
  assert puede('exportar_pdf'), 'admin tiene todo por defecto';
end $$;
select debe_fallar($q$ insert into permisos (area_id, rol, accion, permitido) select mi_area(), 'admin', 'exportar_pdf', false
  on conflict (area_id, rol, accion) do update set permitido = excluded.permitido $q$, 'row-level security');
update permisos set permitido = false where rol = 'delegado' and accion = 'importar_datos';
select debe_fallar($q$ update profiles set rol = 'delegado' where email = 'equipo@x.pe' $q$, 'super administrador');
select como('admin@x.pe');
do $$ begin
  assert coalesce((select permitido from permisos where rol = 'admin' and accion = 'exportar_pdf'), true), 'admin editó su propia columna';
  assert not (select permitido from permisos where rol = 'delegado' and accion = 'importar_datos'), 'admin no pudo editar al delegado';
end $$;
insert into permisos (area_id, rol, accion, permitido) select mi_area(), 'admin', 'exportar_pdf', false
  on conflict (area_id, rol, accion) do update set permitido = excluded.permitido;  -- superadmin sí
select como('admin2@x.pe');
do $$ begin assert not puede('exportar_pdf'), 'superadmin no pudo restringir al admin'; end $$;
reset role;

-- ---------- Eliminar proyectos (011) ----------
reset role;
do $$ begin perform set_config('request.jwt.claim.sub', '', false); end $$;
insert into proyectos (area_id, codigo, nombre_corto, estado) select id, 'BORRAR-1', 'Sin historial', 'activo' from areas limit 1;
set role authenticated;
select como('consulta@x.pe');
delete from proyectos where codigo = 'BORRAR-1';            -- consulta: RLS no lo permite
select como('admin@x.pe');
do $$ begin assert exists (select 1 from proyectos where codigo = 'BORRAR-1'), 'consulta borró un proyecto'; end $$;
delete from proyectos where codigo = 'BORRAR-1';
do $$ begin assert not exists (select 1 from proyectos where codigo = 'BORRAR-1'), 'admin no pudo borrar proyecto sin historial'; end $$;
select debe_fallar($q$ delete from proyectos where id = (select proyecto_id from actividades where proyecto_id is not null limit 1) $q$, 'foreign key');
reset role;

-- ---------- Eliminar proyecto con historial (012) ----------
set role authenticated;
select como('equipo@x.pe');
select debe_fallar($q$ select eliminar_proyecto_completo((select proyecto_id from actividades where proyecto_id is not null limit 1)) $q$, 'Solo un administrador');
select como('admin@x.pe');
do $$ declare v_p uuid; r jsonb; begin
  select proyecto_id into v_p from actividades where proyecto_id is not null limit 1;
  r := eliminar_proyecto_completo(v_p);
  assert (r->>'actividades')::int >= 1, 'no contó actividades';
  assert not exists (select 1 from proyectos where id = v_p), 'proyecto no borrado';
  assert not exists (select 1 from actividades where proyecto_id = v_p), 'actividades no borradas';
end $$;
reset role;

-- ---------- Cargos (013) ----------
do $$ begin
  assert (select count(*) from lista_valores v join listas l on l.id = v.lista_id where l.clave = 'cargos') = 6, 'lista de cargos';
end $$;
update profiles set cargo_id = (select v.id from lista_valores v join listas l on l.id = v.lista_id where l.clave = 'cargos' limit 1) where email = 'admin@x.pe';

-- ---------- Organigrama (014) ----------
set role authenticated;
select como('admin@x.pe');
insert into organigrama_nodos (area_id, tipo, titulo) values (mi_area(), 'unidad', 'Gerencia Técnica');
do $$ begin assert jsonb_array_length(exportar_respaldo()->'organigrama_nodos') = 1, 'organigrama en el respaldo'; end $$;
select como('consulta@x.pe');
select debe_fallar($q$ insert into organigrama_nodos (area_id, tipo, titulo) values (mi_area(), 'unidad', 'X') $q$, 'row-level security');
reset role;

-- ---------- Endurecimiento (015): aislamiento entre áreas, autoría y funciones ----------
select set_config('request.jwt.claim.sub', '', false);
insert into areas (nombre) values ('Otra área');
insert into auth.users (email, raw_user_meta_data) values ('otra@x.pe', '{"nombre":"Otra"}');
update profiles set area_id = (select id from areas where nombre = 'Otra área'), rol = 'superadmin' where email = 'otra@x.pe';
insert into proyectos (area_id, codigo, nombre_corto, estado)
select id, 'AJENO-1', 'Proyecto de otra área', 'activo' from areas where nombre = 'Otra área';
insert into proyectos (area_id, codigo, nombre_corto, estado)
select area_id, 'P-SEG', 'Proyecto propio', 'activo' from profiles where email = 'admin@x.pe';
set role authenticated;
select como('otra@x.pe');
do $$ begin
  assert (select string_agg(codigo, ',') from proyectos) = 'AJENO-1', 'la otra área ve proyectos ajenos';
  assert not exists (select 1 from actividades), 'la otra área ve actividades ajenas';
  assert not exists (select 1 from profiles where email = 'admin@x.pe'), 'la otra área ve usuarios ajenos';
end $$;
select como('admin@x.pe');
do $$ begin assert not exists (select 1 from proyectos where codigo = 'AJENO-1'), 've el proyecto de otra área'; end $$;
reset role;
-- IDs ajenos conocidos (se obtienen como superusuario para simular la manipulación de IDs)
select set_config('prueba.proy_ajeno', (select id::text from proyectos where codigo = 'AJENO-1'), false);
select set_config('prueba.persona_ajena', (select id::text from profiles where email = 'otra@x.pe'), false);
set role authenticated;
select como('admin@x.pe');
select debe_fallar($q$ insert into actividades (area_id, semana, responsable_id, proyecto_id, descripcion)
  values (mi_area(), date_trunc('week', current_date)::date + 14, auth.uid(), current_setting('prueba.proy_ajeno')::uuid, 'X') $q$, 'otra área');
select debe_fallar($q$ insert into actividades (area_id, semana, responsable_id, descripcion)
  values (mi_area(), date_trunc('week', current_date)::date + 14, current_setting('prueba.persona_ajena')::uuid, 'X') $q$, 'otra área');
insert into actividades (area_id, semana, responsable_id, descripcion)
values (mi_area(), date_trunc('week', current_date)::date + 21, auth.uid(), 'Para mover');
select debe_fallar($q$ update actividades set proyecto_id = current_setting('prueba.proy_ajeno')::uuid where descripcion = 'Para mover' $q$, 'otra área');
select debe_fallar($q$ insert into comentarios (area_id, entidad, entidad_id, texto) values (mi_area(), 'proyecto', current_setting('prueba.proy_ajeno')::uuid, 'X') $q$, 'otra área');
select debe_fallar($q$ insert into proyecto_lideres values (current_setting('prueba.proy_ajeno')::uuid, auth.uid()) $q$, 'row-level security');
select debe_fallar($q$ insert into proyecto_lideres values ((select id from proyectos where codigo = 'P-SEG'), current_setting('prueba.persona_ajena')::uuid) $q$, 'row-level security');
insert into plantillas (area_id, tipo, nombre) values (mi_area(), 'servicio', 'Plantilla seg');
select debe_fallar($q$ insert into plantilla_items (plantilla_id, descripcion, proyecto_id)
  values ((select id from plantillas where nombre = 'Plantilla seg'), 'X', current_setting('prueba.proy_ajeno')::uuid) $q$, 'otra área');
-- Autoría: aunque se envíe otro autor, queda el usuario real
insert into enlaces (area_id, entidad, entidad_id, titulo, url, autor_id)
values (mi_area(), 'proyecto', (select id from proyectos where codigo = 'P-SEG'), 'Doc', 'https://x.pe',
        (select id from profiles where email = 'lider1@x.pe'));
do $$ begin assert (select autor_id from enlaces where titulo = 'Doc') = auth.uid(), 'autor suplantado en enlaces'; end $$;
-- Mención a una persona de otra área: no le llega notificación
insert into comentarios (area_id, entidad, entidad_id, texto, menciones)
values (mi_area(), 'proyecto', (select id from proyectos where codigo = 'P-SEG'), 'Hola', array[current_setting('prueba.persona_ajena')::uuid]);
reset role;
do $$ begin
  assert not exists (select 1 from notificaciones n join profiles p on p.id = n.usuario_id where p.email = 'otra@x.pe' and n.tipo = 'mencion'), 'mención cruzó de área';
  assert not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname not in ('como', 'debe_fallar', 'registro_abierto')
                      and has_function_privilege('anon', p.oid, 'execute')), 'anon puede ejecutar funciones security definer';
  assert not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname not in ('como', 'debe_fallar')
                      and not coalesce(p.proconfig::text like '%search_path=public, pg_temp%', false)), 'función definer sin search_path fijo';
  assert not exists (select 1 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity), 'tabla sin RLS';
end $$;

-- ---------- 016: el Estado LA sigue a las restricciones, las levante quien las levante ----------
insert into auth.users (email, raw_user_meta_data) values ('lider3@x.pe', '{"nombre":"Lider Tres"}'), ('lider4@x.pe', '{"nombre":"Lider Cuatro"}');
update profiles set rol = 'lider', activo = true, area_id = (select area_id from profiles where email = 'admin@x.pe')
 where email in ('lider3@x.pe', 'lider4@x.pe');
set role authenticated;
select como('lider3@x.pe');
insert into actividades (area_id, semana, responsable_id, descripcion, comprometida, estado_la)
values (mi_area(), date_trunc('week', current_date)::date + 14, auth.uid(), 'LA con restricción', false, 'pendiente');
insert into restricciones (area_id, actividad_id, descripcion, estado)
values (mi_area(), (select id from actividades where descripcion = 'LA con restricción'), 'Falta información', 'pendiente');
do $$ begin assert (select estado_la from actividades where descripcion = 'LA con restricción') = 'con_restriccion', 'no pasó a Con restricción'; end $$;
-- Otra persona del equipo la levanta (no puede editar la actividad, pero el Estado LA se actualiza igual)
select como('lider4@x.pe');
update actividades set descripcion = 'Editada por otro' where descripcion = 'LA con restricción';   -- RLS: no la modifica
update restricciones set estado = 'levantada', f_levantada = current_date where descripcion = 'Falta información';
reset role;
do $$ begin
  assert not exists (select 1 from actividades where descripcion = 'Editada por otro'), 'otra persona editó la actividad';
  assert (select estado_la from actividades where descripcion = 'LA con restricción') = 'lista', 'no pasó a Lista al levantar la última restricción';
end $$;
set role authenticated;
select como('lider3@x.pe');
update restricciones set estado = 'pendiente', f_levantada = null where descripcion = 'Falta información';
delete from restricciones where descripcion = 'Falta información';
reset role;
do $$ begin assert (select estado_la from actividades where descripcion = 'LA con restricción') = 'lista', 'no volvió a Lista al eliminar la restricción'; end $$;

-- ---------- 020 (PPT v5): proyectos y CET / Servicio los agrega el administrador o el delegado ----------
set role authenticated;
select como('admin@x.pe');
insert into proyectos (area_id, codigo, nombre_corto, estado) values (mi_area(), 'A-1', 'Proyecto del administrador', 'activo');
insert into lista_valores (lista_id, codigo, valor) values ((select id from listas where clave = 'servicios' and area_id = mi_area()), 'CET-A1', 'Servicio del administrador');
select como('lider3@x.pe');
select debe_fallar($q$ insert into proyectos (area_id, codigo, nombre_corto, estado) values (mi_area(), 'L-1', 'No', 'activo') $q$, 'row-level security');
select debe_fallar($q$ insert into lista_valores (lista_id, codigo, valor) values ((select id from listas where clave = 'servicios' and area_id = mi_area()), 'CET-L1', 'No') $q$, 'row-level security');
update proyectos set nombre_corto = 'X' where codigo = 'A-1';                         -- RLS no lo modifica
reset role;
do $$ begin
  assert (select nombre_corto from proyectos where codigo = 'A-1') = 'Proyecto del administrador', 'el líder editó un proyecto';
  assert exists (select 1 from lista_valores where codigo = 'CET-A1'), 'el administrador no agregó el CET / Servicio';
end $$;

-- ---------- 019: empresas ----------
insert into areas (nombre) values ('Empresa Dos');
do $$ begin assert not registro_abierto() or (select count(*) from areas where activa) <= 1, 'registro abierto con varias empresas'; end $$;
select inicializar_empresa((select id from areas where nombre = 'Empresa Dos'), '{
  "listas":[{"clave":"gerencias","nombre":"Gerencias","grupo":"G","valores":[]},
            {"clave":"estados_la","nombre":"Estados LA","valores":[{"codigo":"lista","valor":"Lista","protegido":true}]}],
  "parametros":{"meta_pac":0.8},
  "permisos":[{"rol":"lider","accion":"comentar","permitido":true}]}');
do $$ begin
  assert (select count(*) from listas l join areas a on a.id = l.area_id where a.nombre = 'Empresa Dos') = 2, 'listas de la empresa nueva';
  assert (select count(*) from parametros p join areas a on a.id = p.area_id where a.nombre = 'Empresa Dos') = 1, 'parámetros de la empresa nueva';
  assert not registro_abierto(), 'con varias empresas el registro público debe cerrarse';
end $$;
select debe_fallar($q$ select inicializar_empresa((select id from areas where nombre = 'Empresa Dos'), '{}') $q$, 'ya tiene');
set role authenticated;
select como('lider3@x.pe');
do $$ begin assert (select count(*) from areas) = 1, 'un usuario normal ve otras empresas'; end $$;
select debe_fallar($q$ update profiles set es_plataforma = true where id = auth.uid() $q$, 'plataforma');
select debe_fallar($q$ select inicializar_empresa((select id from areas limit 1), '{}') $q$, 'permission denied');
reset role;
update profiles set es_plataforma = true where email = 'admin@x.pe';
set role authenticated;
select como('admin@x.pe');
do $$ begin assert (select count(*) from areas) >= 2, 'el administrador de la plataforma no ve las empresas'; end $$;
reset role;

-- ---------- 023: Portafolio → Programa → Proyecto, aislados por empresa ----------
set role authenticated;
select como('admin@x.pe');
insert into portafolios (area_id, codigo, nombre) values (mi_area(), 'PF-1', 'Portafolio Uno');
insert into programas (area_id, portafolio_id, codigo, nombre) values (mi_area(), (select id from portafolios where codigo = 'PF-1'), 'PG-1', 'Programa Uno');
update proyectos set programa_id = (select id from programas where codigo = 'PG-1'), portafolio_id = (select id from portafolios where codigo = 'PF-1') where codigo = 'A-1';
select como('lider3@x.pe');
do $$ begin assert (select count(*) from portafolios) = 1 and (select count(*) from programas) = 1, 'el líder no ve la estructura de su empresa'; end $$;
select debe_fallar($q$ insert into portafolios (area_id, nombre) values (mi_area(), 'No') $q$, 'row-level security');
update programas set nombre = 'X' where codigo = 'PG-1';                               -- RLS: el líder no modifica
select como('otra@x.pe');
do $$ begin assert (select count(*) from portafolios) = 0 and (select count(*) from programas) = 0, 'otra empresa ve portafolios ajenos'; end $$;
insert into portafolios (area_id, codigo, nombre) values (mi_area(), 'PF-OTRA', 'De la otra empresa');
reset role;
do $$ begin assert (select nombre from programas where codigo = 'PG-1') = 'Programa Uno', 'el líder modificó un programa'; end $$;
-- No se mezclan empresas: un programa no puede colgar de un portafolio de otra empresa
do $$ begin
  begin
    update programas set portafolio_id = (select id from portafolios where codigo = 'PF-OTRA') where codigo = 'PG-1';
    raise exception 'aceptó un portafolio de otra empresa';
  exception when raise_exception then if sqlerrm not like 'El portafolio no pertenece%' then raise; end if; end;
end $$;

-- ---------- 024: sub-proyectos ----------
set role authenticated;
select como('admin@x.pe');
insert into proyectos (area_id, codigo, nombre_corto, estado, padre_id) values (mi_area(), 'A-1.1', 'Sub-proyecto uno', 'activo', (select id from proyectos where codigo = 'A-1'));
do $$ begin
  assert (select programa_id from proyectos where codigo = 'A-1.1') = (select programa_id from proyectos where codigo = 'A-1'), 'el sub-proyecto no heredó el programa';
end $$;
select debe_fallar($q$ insert into proyectos (area_id, codigo, nombre_corto, estado, padre_id) values (mi_area(), 'A-1.1.1', 'Nieto', 'activo', (select id from proyectos where codigo = 'A-1.1')) $q$, 'no puede tener Grupos LPS');
select debe_fallar($q$ update proyectos set padre_id = (select id from proyectos where codigo = 'A-1.1') where codigo = 'A-1' $q$, 'no puede tener Grupos LPS');
-- el padre cambia de programa: el sub-proyecto lo sigue
insert into programas (area_id, portafolio_id, codigo, nombre) values (mi_area(), (select id from portafolios where codigo = 'PF-1'), 'PG-2', 'Programa Dos');
update proyectos set programa_id = (select id from programas where codigo = 'PG-2') where codigo = 'A-1';
do $$ begin assert (select programa_id from proyectos where codigo = 'A-1.1') = (select id from programas where codigo = 'PG-2'), 'el sub-proyecto no siguió al padre'; end $$;
reset role;

-- ---------- 025: eliminar una empresa sin historial, en una sola transacción ----------
reset role;
insert into areas (nombre) values ('Empresa para borrar');
select sembrar_area((select id from areas where nombre = 'Empresa para borrar'));
do $$ begin
  assert exists (select 1 from lista_valores v join listas l on l.id = v.lista_id
                  where l.area_id = (select id from areas where nombre = 'Empresa para borrar') and v.protegido), 'la empresa de prueba no tiene valores protegidos';
end $$;
select eliminar_empresa((select id from areas where nombre = 'Empresa para borrar'));
do $$ begin
  assert not exists (select 1 from areas where nombre = 'Empresa para borrar'), 'no se eliminó la empresa';
  assert coalesce(current_setting('lpsgt.eliminando_empresa', true), '') <> 'on', 'quedó desactivada la protección de valores';
end $$;
-- Cualquier empresa, también con proyectos, sub-proyectos, actividades (semana cerrada) y restricciones
insert into areas (nombre) values ('Empresa con historial');
select sembrar_area((select id from areas where nombre = 'Empresa con historial'));
insert into auth.users (email, raw_user_meta_data) values ('hist@x.pe', '{"nombre":"Hist"}');
update profiles set area_id = (select id from areas where nombre = 'Empresa con historial'), rol = 'lider', activo = true where email = 'hist@x.pe';
insert into portafolios (area_id, nombre) select id, 'PF hist' from areas where nombre = 'Empresa con historial';
insert into proyectos (area_id, codigo, nombre_corto, estado, portafolio_id) select a.id, 'H-1', 'Proyecto hist', 'activo', f.id
  from areas a join portafolios f on f.area_id = a.id where a.nombre = 'Empresa con historial';
insert into proyectos (area_id, codigo, nombre_corto, estado, padre_id) select area_id, 'H-1.1', 'Sub hist', 'activo', id from proyectos where codigo = 'H-1';
insert into actividades (area_id, responsable_id, semana, proyecto_id, descripcion, comprometida, estado)
  select p.area_id, u.id, date_trunc('week', current_date)::date - 7, p.id, 'Actividad hist', true, 'completado'
  from proyectos p, profiles u where p.codigo = 'H-1.1' and u.email = 'hist@x.pe';
insert into restricciones (area_id, actividad_id, proyecto_id, descripcion, estado)
  select area_id, id, proyecto_id, 'Restricción hist', 'pendiente' from actividades where descripcion = 'Actividad hist';
insert into cierres (area_id, responsable_id, semana, cerrada) select area_id, responsable_id, semana, true from actividades where descripcion = 'Actividad hist';
select eliminar_empresa((select id from areas where nombre = 'Empresa con historial'));
do $$ begin
  assert not exists (select 1 from areas where nombre = 'Empresa con historial'), 'no se eliminó la empresa con historial';
  assert not exists (select 1 from proyectos where codigo in ('H-1', 'H-1.1')), 'quedaron proyectos';
  assert not exists (select 1 from actividades where descripcion = 'Actividad hist'), 'quedaron actividades';
  assert not exists (select 1 from profiles where email = 'hist@x.pe'), 'quedó el usuario';
  assert exists (select 1 from areas where nombre <> 'Empresa con historial'), 'se borraron otras empresas';
end $$;
select debe_fallar($q$ delete from lista_valores where codigo = 'completado' $q$, 'protegido');
set role authenticated;
select como('admin@x.pe');
select debe_fallar($q$ select eliminar_empresa(mi_area()) $q$, 'permission denied');
reset role;

-- ---------- Pedido 15: mover un proyecto con sub-proyectos a otra empresa (misma secuencia que admin-usuarios) ----------
reset role;
insert into areas (nombre) values ('Destino');
insert into portafolios (area_id, codigo, nombre) select id, 'PF-D', 'Portafolio destino' from areas where nombre = 'Destino';
insert into proyectos (area_id, codigo, nombre_corto, estado, portafolio_id)
  select area_id, 'MV-1', 'A mover', 'activo', id from portafolios where codigo = 'PF-1';
insert into proyectos (area_id, codigo, nombre_corto, estado, padre_id) select area_id, 'MV-1.1', 'Sub a mover', 'activo', id from proyectos where codigo = 'MV-1';
update proyectos set padre_id = null where codigo = 'MV-1.1';
update proyectos set area_id = (select id from areas where nombre = 'Destino'), gerencia_id = null, cet_id = null, fase_id = null, pais_id = null, tipo_id = null,
  padre_id = null, programa_id = null, portafolio_id = (select id from portafolios where codigo = 'PF-D') where codigo = 'MV-1';
update proyectos set area_id = (select id from areas where nombre = 'Destino'), gerencia_id = null, padre_id = (select id from proyectos where codigo = 'MV-1'),
  portafolio_id = (select portafolio_id from proyectos where codigo = 'MV-1'), programa_id = null where codigo = 'MV-1.1';
do $$ begin
  assert (select count(*) from proyectos p join areas a on a.id = p.area_id where a.nombre = 'Destino' and p.codigo in ('MV-1', 'MV-1.1')) = 2, 'no se movieron';
  assert (select padre_id from proyectos where codigo = 'MV-1.1') = (select id from proyectos where codigo = 'MV-1'), 'el sub-proyecto perdió su padre';
  assert (select portafolio_id from proyectos where codigo = 'MV-1.1') = (select id from portafolios where codigo = 'PF-D'), 'el sub-proyecto no tomó el portafolio de destino';
end $$;

-- ---------- 026: eliminar un proyecto con historial y sub-proyectos (servidor) ----------
reset role;
insert into proyectos (area_id, codigo, nombre_corto, estado) select id, 'DEL-1', 'A eliminar', 'activo' from areas where nombre <> 'Destino' order by created_at limit 1;
insert into proyectos (area_id, codigo, nombre_corto, estado, padre_id) select area_id, 'DEL-1.1', 'Sub a eliminar', 'activo', id from proyectos where codigo = 'DEL-1';
insert into actividades (area_id, responsable_id, semana, proyecto_id, descripcion, comprometida, estado)
  select p.area_id, u.id, date_trunc('week', current_date)::date - 14, p.id, 'Act a eliminar', true, 'completado'
  from proyectos p, profiles u where p.codigo = 'DEL-1.1' and u.email = 'lider3@x.pe';
insert into cierres (area_id, responsable_id, semana, cerrada) select area_id, responsable_id, semana, true from actividades where descripcion = 'Act a eliminar'
  on conflict do nothing;
insert into restricciones (area_id, actividad_id, proyecto_id, descripcion, estado)
  select area_id, id, proyecto_id, 'Rest a eliminar', 'pendiente' from actividades where descripcion = 'Act a eliminar';
do $$ declare r jsonb; begin
  r := eliminar_proyecto_plataforma((select id from proyectos where codigo = 'DEL-1'));
  assert (r->>'subproyectos')::int = 1 and (r->>'actividades')::int = 1 and (r->>'restricciones')::int = 1, 'conteo incorrecto: ' || r::text;
  assert not exists (select 1 from proyectos where codigo in ('DEL-1', 'DEL-1.1')), 'quedaron proyectos';
  assert not exists (select 1 from actividades where descripcion = 'Act a eliminar'), 'quedaron actividades';
end $$;
set role authenticated;
select como('admin@x.pe');
select debe_fallar($q$ select eliminar_proyecto_plataforma((select id from proyectos limit 1)) $q$, 'permission denied');
reset role;

-- 030: un usuario en varias empresas
reset role;
do $$ begin perform set_config('request.jwt.claim.sub', '', false); end $$;
insert into areas (nombre) values ('Empresa B');
insert into auth.users (email, raw_user_meta_data) values ('multi@x.pe', '{"nombre":"Multi"}'), ('bsolo@x.pe', '{"nombre":"B Solo"}'), ('badmin@x.pe', '{"nombre":"B Admin"}');
do $$
declare v_a uuid := (select area_id from profiles p join auth.users u on u.id = p.id where u.email = 'admin@x.pe');
        v_b uuid := (select id from areas where nombre = 'Empresa B');
begin
  update profiles set area_id = v_a, rol = 'admin', activo = true where id = (select id from auth.users where email = 'multi@x.pe');
  update profiles set area_id = v_b, rol = 'lider', activo = true where id = (select id from auth.users where email = 'bsolo@x.pe');
  update profiles set area_id = v_b, rol = 'superadmin', activo = true where id = (select id from auth.users where email = 'badmin@x.pe');
  insert into empresa_miembros (usuario_id, area_id, rol) select id, v_b, 'superadmin' from auth.users where email = 'multi@x.pe';
  insert into proyectos (area_id, codigo, nombre_corto, estado) values (v_b, 'B-1', 'Proyecto B', 'activo');
  -- la empresa activa queda como membresía (disparador) y la otra se agregó
  assert (select count(*) from empresa_miembros m join auth.users u on u.id = m.usuario_id where u.email = 'multi@x.pe') = 2, '030: faltan membresías';
  assert pertenece((select id from auth.users where email = 'multi@x.pe'), v_b), '030: pertenece() falla';
  assert not pertenece((select id from auth.users where email = 'lider2@x.pe'), v_b), '030: pertenece() deja pasar a otra empresa';
end $$;
select set_config('prueba.lider2', (select id::text from auth.users where email = 'lider2@x.pe'), false);
set role authenticated;
-- Un miembro de B ve a «multi» (activo en A) y no ve membresías de otras empresas ajenas
select como('bsolo@x.pe');
do $$ begin
  assert exists (select 1 from profiles p where p.nombre = 'Multi'), '030: el equipo de B no ve a su miembro activo en A';
  assert not exists (select 1 from profiles p where p.nombre = 'Lider Dos'), '030: B ve personas de A';
end $$;
select como('lider2@x.pe');
do $$ begin
  assert not exists (select 1 from empresa_miembros m join areas a on a.id = m.area_id where a.nombre = 'Empresa B'), '030: A ve membresías de B';
end $$;
-- Líder de proyecto en B: un miembro sí, una persona de otra empresa no
select como('badmin@x.pe');
insert into proyecto_lideres (proyecto_id, usuario_id)
  select (select id from proyectos where codigo = 'B-1'), (select id from profiles where nombre = 'Multi');
select debe_fallar($q$ insert into proyecto_lideres (proyecto_id, usuario_id)
  select (select id from proyectos where codigo = 'B-1'), current_setting('prueba.lider2')::uuid $q$);
-- Eliminar a «multi» desde B: solo se le retira de B (su cuenta y su empresa A siguen)
do $$ begin
  assert eliminar_usuario((select id from profiles where nombre = 'Multi')) = 'retirado', '030: no se retiró';
end $$;
reset role;
do $$ begin perform set_config('request.jwt.claim.sub', '', false); end $$;
do $$
declare v_a uuid := (select area_id from profiles p join auth.users u on u.id = p.id where u.email = 'admin@x.pe');
        v_b uuid := (select id from areas where nombre = 'Empresa B');
        v_m uuid := (select id from auth.users where email = 'multi@x.pe');
begin
  assert exists (select 1 from profiles where id = v_m and area_id = v_a and not eliminado), '030: se perdió la cuenta o su empresa A';
  assert not exists (select 1 from empresa_miembros where usuario_id = v_m and area_id = v_b), '030: sigue en B';
  assert not exists (select 1 from proyecto_lideres where usuario_id = v_m), '030: sigue de líder en B';
  -- Activo en B y se elimina la empresa B: pasa a A, no se borra
  insert into empresa_miembros (usuario_id, area_id, rol) values (v_m, v_b, 'superadmin');
  perform cambiar_empresa_activa(v_m, v_b);
  assert (select area_id from profiles where id = v_m) = v_b and (select rol from profiles where id = v_m) = 'superadmin', '030: no cambió de empresa activa';
  assert exists (select 1 from empresa_miembros where usuario_id = v_m and area_id = v_a), '030: el cambio de empresa activa quitó la membresía de A';
  perform eliminar_empresa(v_b);
  assert exists (select 1 from profiles where id = v_m and area_id = v_a), '030: al eliminar B se perdió el usuario de varias empresas';
  assert not exists (select 1 from profiles p join auth.users u on u.id = p.id where u.email = 'bsolo@x.pe'), '030: el usuario solo de B debió eliminarse';
  assert not exists (select 1 from empresa_miembros where area_id = v_b), '030: quedaron membresías de B';
  raise notice '030 OK';
end $$;

-- 017: las funciones de disparador no se pueden invocar como API
do $$ begin
  assert not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype
                      and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))),
    'una función de disparador se puede invocar como API';
end $$;

\echo 'Todas las pruebas pasaron'

-- 028: una sola vista automática por persona y grilla
do $$
declare v_area uuid; v_u uuid;
begin
  select area_id, id into v_area, v_u from public.profiles limit 1;
  if v_u is null then raise notice '028: sin perfiles para probar'; return; end if;
  delete from public.vistas where grilla = 'prueba028';
  insert into public.vistas (area_id, usuario_id, grilla, nombre) values (v_area, v_u, 'prueba028', '__auto__');
  begin
    insert into public.vistas (area_id, usuario_id, grilla, nombre) values (v_area, v_u, 'prueba028', '__auto__');
    raise exception '028 FALLA: se permitió una vista automática duplicada';
  exception when unique_violation then null;
  end;
  insert into public.vistas (area_id, usuario_id, grilla, nombre) values (v_area, v_u, 'prueba028', 'Mi vista');   -- las vistas con nombre siguen libres
  delete from public.vistas where grilla = 'prueba028';
  raise notice '028 OK';
end $$;
