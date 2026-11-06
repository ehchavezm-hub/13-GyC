-- LPS-GES · 016_restricciones_estado_la.sql
-- Matriz de compatibilidad (solicitud 98): el Estado LA de una actividad sigue a sus restricciones (RN-07)
-- sin importar desde qué pantalla se registren, levanten o eliminen:
--   · con alguna restricción pendiente → "Con restricción" (si estaba Pendiente o Lista);
--   · al levantar o eliminar la última → "Lista" (si estaba Con restricción).
-- No cambia las actividades trasladadas al plan ni las canceladas.
-- Es SECURITY DEFINER porque cualquier persona del equipo puede levantar una restricción (rest_upd), pero solo
-- el responsable de la actividad (o quien tiene "editar_actividades_otros") puede modificar la actividad.

set client_min_messages = warning;

create or replace function public.tg_restriccion_estado_la() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_act uuid;
  v_abiertas boolean;
begin
  foreach v_act in array array_remove(array[
      case when tg_op <> 'INSERT' then old.actividad_id end,
      case when tg_op <> 'DELETE' then new.actividad_id end], null) loop
    select exists (select 1 from restricciones r where r.actividad_id = v_act and r.estado <> 'levantada') into v_abiertas;
    begin
      update actividades a
         set estado_la = case when v_abiertas then 'con_restriccion' else 'lista' end
       where a.id = v_act
         and ((v_abiertas and a.estado_la in ('pendiente', 'lista'))
              or (not v_abiertas and a.estado_la = 'con_restriccion'));
    exception when others then
      null;   -- p. ej. semana cerrada: la restricción se guarda igual
    end;
  end loop;
  return null;
end $$;

revoke execute on function public.tg_restriccion_estado_la() from public, anon;

drop trigger if exists restriccion_estado_la on public.restricciones;
create trigger restriccion_estado_la
  after insert or delete or update of estado, actividad_id on public.restricciones
  for each row execute function public.tg_restriccion_estado_la();
