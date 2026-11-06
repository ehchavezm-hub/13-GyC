-- LPS-GES · 013 · Cargo de cada persona (lista editable "Cargos")
alter table public.profiles add column if not exists cargo_id uuid references public.lista_valores(id) on delete set null;

do $$
declare a record;
begin
  for a in select id from public.areas loop
    if not exists (select 1 from public.listas where area_id = a.id and clave = 'cargos') then
      perform public.sembrar_lista(a.id, 'cargos', 'Cargos', '[
        {"valor":"Gerente Técnico"},
        {"valor":"Gerente Técnico en Geotecnia y Pavimentos"},
        {"valor":"Líder BIM"},
        {"valor":"Ingeniero BIM"},
        {"valor":"Especialista en Métodos Constructivos - Encofrados y Andamios"},
        {"valor":"Administrador de Información de Proyectos"}]'::jsonb);
    end if;
    update public.listas set grupo = 'Equipo y organización' where area_id = a.id and clave = 'cargos' and grupo is null;
  end loop;
end $$;
