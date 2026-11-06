-- LPS-GES · 031 · Pedido d3: el «Sub-proyecto» se llama «Grupo LPS» (equipo de personas que aplica Last Planner y puede
-- atender a varios proyectos o gerencias). Solo cambian los mensajes que la base muestra al usuario; la estructura es la
-- misma (un Grupo LPS es un proyecto con padre_id). Se puede ejecutar más de una vez.

create or replace function public.tg_subproyecto() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_padre public.proyectos;
begin
  if new.padre_id is not null then
    if new.padre_id = new.id then raise exception 'Un proyecto no puede ser su propio padre.'; end if;
    select * into v_padre from public.proyectos where id = new.padre_id;
    if v_padre.id is null or v_padre.area_id <> new.area_id then raise exception 'El proyecto padre no pertenece a esta empresa.'; end if;
    if v_padre.padre_id is not null then raise exception 'Un Grupo LPS no puede tener Grupos LPS.'; end if;
    if tg_op = 'UPDATE' and exists (select 1 from public.proyectos h where h.padre_id = new.id) then
      raise exception 'Este proyecto tiene Grupos LPS: no puede ser Grupo LPS de otro.';
    end if;
    -- Hereda la ubicación de su padre
    new.portafolio_id := v_padre.portafolio_id;
    new.programa_id := v_padre.programa_id;
  end if;
  return new;
end $$;
revoke execute on function public.tg_subproyecto() from public, anon, authenticated;
