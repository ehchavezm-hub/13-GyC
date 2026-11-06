-- LPS-GES · 024_subproyectos.sql
-- Pedido a7: la estructura llega hasta el sub-proyecto: Empresa → Portafolio → Programa → Proyecto → Sub-proyecto.
-- Un sub-proyecto es un proyecto con "padre_id": así el LPS (Look Ahead, Plan semanal, restricciones, cartera, PAC)
-- funciona en los sub-proyectos sin tablas nuevas. Reglas:
--   · el padre es de la misma empresa y es un proyecto (no otro sub-proyecto): solo dos niveles;
--   · el sub-proyecto hereda el portafolio y el programa de su padre (y los sigue si el padre cambia);
--   · un proyecto con sub-proyectos no se puede convertir en sub-proyecto.
-- Pedido a8: los usuarios se registran solo en la empresa; los niveles de abajo los heredan (el aplicativo trata a los
-- líderes de un proyecto como líderes de sus sub-proyectos).
-- Se puede ejecutar más de una vez.

set client_min_messages = warning;

alter table public.proyectos add column if not exists padre_id uuid references public.proyectos(id) on delete restrict;
create index if not exists proyectos_padre_idx on public.proyectos (padre_id);

create or replace function public.tg_subproyecto() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_padre public.proyectos;
begin
  if new.padre_id is not null then
    if new.padre_id = new.id then raise exception 'Un proyecto no puede ser su propio padre.'; end if;
    select * into v_padre from public.proyectos where id = new.padre_id;
    if v_padre.id is null or v_padre.area_id <> new.area_id then raise exception 'El proyecto padre no pertenece a esta empresa.'; end if;
    if v_padre.padre_id is not null then raise exception 'Un sub-proyecto no puede tener sub-proyectos.'; end if;
    if tg_op = 'UPDATE' and exists (select 1 from public.proyectos h where h.padre_id = new.id) then
      raise exception 'Este proyecto tiene sub-proyectos: no puede ser sub-proyecto de otro.';
    end if;
    -- Hereda la ubicación de su padre
    new.portafolio_id := v_padre.portafolio_id;
    new.programa_id := v_padre.programa_id;
  end if;
  return new;
end $$;
revoke execute on function public.tg_subproyecto() from public, anon, authenticated;
create or replace trigger trg_proyectos_subproyecto before insert or update of padre_id, portafolio_id, programa_id, area_id on public.proyectos
  for each row execute function public.tg_subproyecto();

-- Si el padre cambia de portafolio o programa, sus sub-proyectos lo siguen
create or replace function public.tg_subproyectos_siguen() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (new.portafolio_id, new.programa_id) is distinct from (old.portafolio_id, old.programa_id) then
    update public.proyectos set portafolio_id = new.portafolio_id, programa_id = new.programa_id where padre_id = new.id;
  end if;
  return null;
end $$;
revoke execute on function public.tg_subproyectos_siguen() from public, anon, authenticated;
create or replace trigger trg_proyectos_subproyectos_siguen after update of portafolio_id, programa_id on public.proyectos
  for each row execute function public.tg_subproyectos_siguen();
