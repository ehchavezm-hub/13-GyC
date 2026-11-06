// Información del proyecto (CR-PG-SGP-01-F1, pestaña "0.Datos"): CR, nombre, plazo contractual e inicios
// de movilización y de construcción. La usa el Programa de Arranque como cabecera.
import { api, mensajeError } from '../data/api.js';
import { store, esGestor, haySeleccion, proyecto, misProyectos, emit } from '../core/store.js';
import { esc, html, fmtFecha } from '../core/util.js';
import { ok, pedirDatos } from '../ui/ui.js';

/** Campos de la pestaña 0 (en el mismo orden que el formato). */
export const CAMPOS_INFO = [
  { name: 'cr', label: 'CR', placeholder: 'C202000' },
  { name: 'nombre_completo', label: 'Proyecto', full: true },
  { name: 'inicio_contractual', label: 'Inicio contractual', type: 'date' },
  { name: 'fin_contractual', label: 'Fin contractual', type: 'date' },
  { name: 'fecha_movilizacion', label: 'Fecha inicio de movilización', type: 'date' },
  { name: 'fecha_construccion', label: 'Fecha inicio de construcción', type: 'date' },
];

/** ¿Puede la persona editar los documentos de este proyecto? (gestores y miembros del proyecto) */
export function puedeEditarProyecto(id) {
  return esGestor() || misProyectos().some(p => p.id === id);
}

const valor = (p, c) => {
  const v = c.name === 'nombre_completo' ? (p.nombre_completo || p.nombre_corto) : p[c.name];
  if (!v) return '—';
  return c.type === 'date' ? fmtFecha(v) : v;
};

export async function render(el) {
  el.innerHTML = '';
  const p = store.proyectoSel && proyecto(store.proyectoSel);
  if (!haySeleccion() || !p) {
    el.innerHTML = '<div class="aviso-vacio"><p>Selecciona un proyecto en el menú para ver su información.</p></div>';
    return;
  }
  const editable = puedeEditarProyecto(p.id);
  const plazo = p.inicio_contractual && p.fin_contractual
    ? Math.round((new Date(p.fin_contractual) - new Date(p.inicio_contractual)) / 86400000) : null;
  const jerarquia = [store.portafolios.find(f => f.id === p.portafolio_id)?.nombre, store.programas.find(g => g.id === p.programa_id)?.nombre]
    .filter(Boolean).join(' › ');

  const wrap = html(`<div>
    <div class="pagina-cab"><h1>Información del proyecto</h1><span class="proy-badge">${esc(p.codigo)} · ${esc(p.nombre_corto)}</span>
      <span class="flex"></span>${editable ? '<button class="btn btn-primario" data-a="editar">✎ Editar</button>' : ''}</div>
    <div class="tarjeta info-proy">
      <table class="info-proy-tabla"><tbody>
        ${CAMPOS_INFO.map(c => `<tr><th>${esc(c.label)}</th><td>${esc(valor(p, c))}</td></tr>`).join('')}
        ${plazo !== null ? `<tr><th>Plazo contractual</th><td>${plazo} días</td></tr>` : ''}
        ${jerarquia ? `<tr><th>Portafolio › Programa</th><td>${esc(jerarquia)}</td></tr>` : ''}
      </tbody></table>
      <p class="nota">Formato CR-PG-SGP-01-F1 · Estos datos encabezan el <a href="#/programa-arranque">Programa de arranque</a>.</p>
    </div></div>`);
  el.append(wrap);

  wrap.querySelector('[data-a="editar"]')?.addEventListener('click', () => pedirDatos({
    titulo: 'Información del proyecto',
    campos: CAMPOS_INFO.map(c => ({ ...c, required: c.name === 'nombre_completo' })),
    valores: { ...p, nombre_completo: p.nombre_completo || p.nombre_corto },
    alGuardar: async d => {
      if (d.inicio_contractual && d.fin_contractual && d.fin_contractual < d.inicio_contractual) {
        throw new Error('El fin contractual no puede ser anterior al inicio.');
      }
      let actualizado;
      try { actualizado = await api.update('proyectos', p.id, d); } catch (e) { throw new Error(mensajeError(e)); }
      Object.assign(p, actualizado);
      emit('catalogo');
      ok('Información del proyecto guardada.');
      render(el);
    },
  }));
}
