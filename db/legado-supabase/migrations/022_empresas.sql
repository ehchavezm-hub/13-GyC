-- LPS-GT · 022_empresas.sql
-- Varias empresas en la misma aplicación web (pedido 113). Cada empresa es un "área": sus usuarios, proyectos,
-- listas, parámetros y permisos están aislados por las políticas existentes (area_id = mi_area()).
--   · profiles.es_plataforma: administrador de la plataforma (ve y crea empresas desde Configuración → Empresas).
--     Se asigna solo desde la base de datos.
--   · inicializar_empresa(): listas, parámetros y permisos iniciales de una empresa nueva. Los envía la Edge
--     Function "admin-usuarios" (los mismos catálogos que usa el aplicativo), sin datos de otras empresas.
--   · registro_abierto(): el formulario público "Crear cuenta" solo se ofrece mientras haya una sola empresa
--     (con varias, los usuarios los crea el administrador de cada empresa).
-- Se puede ejecutar más de una vez.

set client_min_messages = warning;

alter table public.profiles add column if not exists es_plataforma boolean not null default false;
comment on column public.profiles.es_plataforma is 'Administrador de la plataforma: crea y administra empresas. Solo se asigna desde la base de datos.';

create or replace function public.es_plataforma() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select es_plataforma and activo from public.profiles where id = auth.uid()), false)
$$;
revoke execute on function public.es_plataforma() from public, anon;
grant execute on function public.es_plataforma() to authenticated;

-- El administrador de la plataforma ve todas las empresas (solo la tabla de empresas, no sus datos)
drop policy if exists areas_sel_plataforma on public.areas;
create policy areas_sel_plataforma on public.areas for select to authenticated using ((select public.es_plataforma()));

-- Nadie se asigna es_plataforma desde la aplicación
create or replace function public.tg_proteger_plataforma() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Solo bloquea a las sesiones del aplicativo (roles anon / authenticated); el SQL Editor y el servidor pueden
  if coalesce(current_setting('role', true), '') in ('anon', 'authenticated') and new.es_plataforma is distinct from (case when tg_op = 'UPDATE' then old.es_plataforma else false end) then
    raise exception 'El administrador de la plataforma solo se asigna desde la base de datos.';
  end if;
  return new;
end $$;
revoke execute on function public.tg_proteger_plataforma() from public, anon, authenticated;
drop trigger if exists trg_profiles_plataforma on public.profiles;
create trigger trg_profiles_plataforma before insert or update of es_plataforma on public.profiles
  for each row execute function public.tg_proteger_plataforma();

-- Listas, parámetros y permisos iniciales de una empresa nueva.
-- p_semilla: {"listas":[{"clave","nombre","grupo","valores":[{"codigo","valor","color","protegido","extra"}]}],
--             "parametros":{"clave":valor,...}, "permisos":[{"rol","accion","permitido"}]}
create or replace function public.inicializar_empresa(p_area uuid, p_semilla jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  l jsonb;
  v jsonb;
  v_lista uuid;
  i int;
begin
  if exists (select 1 from public.listas where area_id = p_area) then
    raise exception 'La empresa ya tiene sus listas iniciales.';
  end if;
  for l in select * from jsonb_array_elements(coalesce(p_semilla->'listas', '[]')) loop
    insert into public.listas (area_id, clave, nombre, sistema, grupo)
    values (p_area, l->>'clave', l->>'nombre', true, nullif(l->>'grupo', ''))
    returning id into v_lista;
    i := 0;
    for v in select * from jsonb_array_elements(coalesce(l->'valores', '[]')) loop
      i := i + 1;
      insert into public.lista_valores (lista_id, codigo, valor, orden, color, protegido, extra)
      values (v_lista, nullif(v->>'codigo', ''), v->>'valor', i * 10, nullif(v->>'color', ''),
              coalesce((v->>'protegido')::boolean, false), coalesce(v->'extra', '{}'::jsonb));
    end loop;
  end loop;
  insert into public.parametros (area_id, clave, valor)
  select p_area, k, val from jsonb_each(coalesce(p_semilla->'parametros', '{}')) as e(k, val)
  on conflict (area_id, clave) do update set valor = excluded.valor;
  insert into public.permisos (area_id, rol, accion, permitido)
  select p_area, x->>'rol', x->>'accion', coalesce((x->>'permitido')::boolean, false)
    from jsonb_array_elements(coalesce(p_semilla->'permisos', '[]')) x
  on conflict (area_id, rol, accion) do update set permitido = excluded.permitido;
end $$;
-- Solo la Edge Function (service_role) la ejecuta
revoke execute on function public.inicializar_empresa(uuid, jsonb) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.inicializar_empresa(uuid, jsonb) to service_role;
  end if;
end $$;

-- ¿Se ofrece "Crear cuenta" en la pantalla de ingreso?
create or replace function public.registro_abierto() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select (select count(*) from public.areas where activa) <= 1
$$;
revoke execute on function public.registro_abierto() from public;
grant execute on function public.registro_abierto() to anon, authenticated;
