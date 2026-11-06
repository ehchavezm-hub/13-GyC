// Administración · Nivel 3 (proyecto): miembros del proyecto y sus administradores.
// Lo usan los administradores del proyecto y también los niveles 1 (plataforma) y 2 (empresa).
import { api, mensajeError } from '../data/api.js';
import { store, cargarCatalogo, proyecto, esAdminProyecto, proyectosQueAdministro, seleccionarProyecto } from '../core/store.js';
import { ROLES } from '../data/catalogos.js';
import { esc } from '../core/util.js';
import { ok, error, confirmar, pedirDatos } from '../ui/ui.js';

const ROLES_PROYECTO = { administrador: 'Administrador del proyecto', miembro: 'Miembro' };

/** Proyecto que se administra: el elegido en la barra; si no administra ese, el primero que sí. */
export function proyectoAdministrado() {
  if (store.proyectoSel && esAdminProyecto(store.proyectoSel)) return proyecto(store.proyectoSel);
  return proyectosQueAdministro()[0] || null;
}

export async function panelMiembrosProyecto(el, ctx) {
  const p = proyectoAdministrado();
  if (!p) {
    el.innerHTML = '<p class="nota" style="padding:20px">Elija en la barra superior un proyecto que usted administre.</p>';
    return;
  }
  if (store.proyectoSel !== p.id) { seleccionarProyecto(p.id); ctx?.repintarCabecera?.(); }
  const miembros = store.proyectoLideres.filter(l => l.proyecto_id === p.id)
    .map(l => ({ ...l, perfil: store.perfiles.find(x => x.id === l.usuario_id) }))
    .filter(m => m.perfil)
    .sort((a, b) => (a.rol === 'administrador' ? 0 : 1) - (b.rol === 'administrador' ? 0 : 1) || a.perfil.nombre.localeCompare(b.perfil.nombre));
  const admins = miembros.filter(m => m.rol === 'administrador').length;

  el.innerHTML = `<div class="admin-panel">
    <div class="admin-panel-cab"><div><h2>Miembros del proyecto</h2>
      <p class="admin-sub" style="margin:4px 0 0">${esc(p.codigo)} · ${esc(p.nombre_corto)} — ${miembros.length} persona(s), ${admins} administrador(es).
      Los miembros aparecen como responsables en el Programa de Arranque; los administradores gestionan este proyecto (nivel 3).</p></div>
      <span class="flex"></span><button class="btn btn-primario" data-a="agregar">＋ Agregar miembros</button></div>
    <div class="tarjeta admin-tabla-wrap"><table class="simple"><thead><tr><th>Nombre</th><th>Correo</th><th>Rol en la empresa</th><th>Rol en el proyecto</th><th></th></tr></thead>
      <tbody>${miembros.map(m => `<tr data-u="${esc(m.usuario_id)}">
        <td><b>${esc(m.perfil.nombre)}</b></td><td>${esc(m.perfil.email || '')}</td><td>${esc(ROLES[m.perfil.rol] || m.perfil.rol)}</td>
        <td><select data-rol>${Object.entries(ROLES_PROYECTO).map(([k, v]) => `<option value="${k}"${(m.rol || 'miembro') === k ? ' selected' : ''}>${v}</option>`).join('')}</select></td>
        <td><button class="btn btn-sm btn-peligro" data-quitar>Quitar</button></td></tr>`).join('')
        || '<tr><td colspan="5" class="nota">El proyecto aún no tiene miembros.</td></tr>'}</tbody></table></div>
  </div>`;

  const recargar = async () => { await cargarCatalogo(); await panelMiembrosProyecto(el, ctx); };
  el.querySelector('[data-a="agregar"]').onclick = async () => {
    const actuales = new Set(miembros.map(m => m.usuario_id));
    const opciones = store.perfiles.filter(x => x.activo && !x.eliminado && x.rol !== 'pendiente' && !actuales.has(x.id))
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
      .map(x => ({ value: x.id, label: x.nombre, nota: ROLES[x.rol] || x.rol }));
    if (!opciones.length) return ok('Todos los usuarios de la empresa ya son miembros del proyecto.');
    await pedirDatos({
      titulo: `Agregar miembros a ${p.nombre_corto}`,
      campos: [
        { name: 'usuarios', label: 'Usuarios de la empresa', type: 'multiselect', unaColumna: true, options: opciones },
        { name: 'rol', label: 'Rol en el proyecto', type: 'select', options: Object.entries(ROLES_PROYECTO).map(([value, label]) => ({ value, label })), value: 'miembro' },
      ],
      alGuardar: async d => {
        if (!d.usuarios.length) throw new Error('Elija al menos un usuario.');
        await api.insert('proyecto_lideres', d.usuarios.map(u => ({ proyecto_id: p.id, usuario_id: u, rol: d.rol || 'miembro' })));
        ok(`${d.usuarios.length} miembro(s) agregado(s).`);
      },
    });
    await recargar();
  };
  el.querySelector('tbody').addEventListener('change', async e => {
    const sel = e.target.closest('[data-rol]');
    if (!sel) return;
    const u = sel.closest('[data-u]').dataset.u;
    if (u === store.usuario.id && sel.value !== 'administrador' && !confirm('Dejará de administrar este proyecto. ¿Continuar?')) { sel.value = 'administrador'; return; }
    try {
      await api.updateWhere('proyecto_lideres', { eq: { proyecto_id: p.id, usuario_id: u } }, { rol: sel.value });
      ok('Rol actualizado.');
    } catch (err) { error(mensajeError(err)); }
    await recargar();
  });
  el.querySelector('tbody').addEventListener('click', async e => {
    const b = e.target.closest('[data-quitar]');
    if (!b) return;
    const u = b.closest('[data-u]').dataset.u;
    const nom = store.perfiles.find(x => x.id === u)?.nombre || '';
    if (!await confirmar(`¿Quitar a ${nom} del proyecto ${p.nombre_corto}? Su usuario sigue en la empresa.`, { titulo: 'Quitar miembro', texto: 'Quitar', peligro: true })) return;
    try {
      await api.removeWhere('proyecto_lideres', { eq: { proyecto_id: p.id, usuario_id: u } });
      ok(`${nom} ya no es miembro del proyecto.`);
    } catch (err) { error(mensajeError(err)); }
    await recargar();
  });
}
