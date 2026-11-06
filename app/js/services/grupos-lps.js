// Grupos LPS en el Look Ahead y el Plan semanal (pedido: cada proyecto puede tener varios Grupos LPS y cada grupo tiene
// sus propias actividades).
//  - Se registra solo dentro de un Grupo LPS: sin un grupo elegido en el menú no se crean filas (si la empresa tiene grupos).
//  - Con un grupo elegido se ven solo sus actividades (la columna «Grupo LPS» va oculta).
//  - En los niveles de arriba (proyecto, programa, portafolio, empresa) se ve todo, separado por grupo: aparece la columna
//    «Grupo LPS» y la grilla se agrupa por ella. Lo que no está en un grupo se rotula «Sin Grupo LPS».
import { store, proyecto, opcionesProyectos } from '../core/store.js';
import { esc } from '../core/util.js';

/** ¿La empresa trabaja con Grupos LPS? (si aún no tiene ninguno, se mantiene el registro por proyecto) */
export const usaGrupos = () => store.proyectos.some(p => p.padre_id);
/** Grupo LPS elegido en el menú, o null. */
export const grupoElegido = () => { const p = proyecto(store.proyectoSel); return p?.padre_id ? p : null; };
/** Vista que reúne varios grupos (no hay un grupo elegido). */
export const vistaConsolidada = () => usaGrupos() && !grupoElegido();
/** ¿La actividad está fuera de un Grupo LPS? (sin grupo, o registrada directamente en un proyecto) */
export const fueraDeGrupo = a => usaGrupos() && !proyecto(a.proyecto_id)?.padre_id;

/** Motivo para no crear filas ahora (o null). */
export function bloqueoCrear() {
  if (!vistaConsolidada()) return null;
  return 'Para registrar, elija primero un Grupo LPS en el menú de la izquierda (GRUPOS LPS). Cada grupo tiene sus propias actividades.';
}

/** Opciones para elegir un Grupo LPS: solo los grupos activos (nunca los proyectos). Si la empresa aún no tiene grupos,
 *  se ofrecen los proyectos como antes. */
export function opcionesGrupos() {
  if (!usaGrupos()) return opcionesProyectos();
  return store.proyectos.filter(p => p.padre_id && ['activo', 'propuesto'].includes(p.estado))
    .map(p => { const padre = proyecto(p.padre_id); return { value: p.id, label: `${p.nombre_corto}${padre ? ` (${padre.codigo} · ${padre.nombre_corto})` : ''}` }; })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Rótulo del grupo de filas en la vista consolidada. */
export function rotuloGrupo(id) {
  const p = proyecto(id);
  if (!p) return '⚠ Sin Grupo LPS';
  if (!p.padre_id) return `⚠ Sin Grupo LPS (registrada en el proyecto ${p.codigo} · ${p.nombre_corto})`;
  const padre = proyecto(p.padre_id);
  return `👥 ${p.nombre_corto}${padre ? ` · proyecto ${padre.codigo} · ${padre.nombre_corto}` : ''}`;
}

/** Ajusta la grilla a la vista: columna «Grupo LPS» solo en la vista consolidada, y al pasar a ella se agrupa por grupo
 *  (al volver a un grupo se recupera la agrupación que tenía). forzar: tras cargar una vista guardada. */
const modoPrevio = new WeakMap(), agrupacionPrevia = new WeakMap();
export function aplicarVistaGrupos(grilla, { forzar = false } = {}) {
  if (!grilla?.mostrarColumna) return;
  const consolidada = vistaConsolidada();
  grilla.mostrarColumna('proyecto_id', consolidada);
  if (!forzar && modoPrevio.get(grilla) === consolidada) return;
  if (consolidada) {
    if (grilla.agrupadoPor() !== 'proyecto_id') agrupacionPrevia.set(grilla, grilla.agrupadoPor());
    grilla.agruparPor('proyecto_id');
  } else if (grilla.agrupadoPor() === 'proyecto_id') grilla.agruparPor(agrupacionPrevia.get(grilla) || '');
  modoPrevio.set(grilla, consolidada);
}

/** Aviso para la cabecera: cuántas actividades (de las cargadas) están fuera de un Grupo LPS. */
export function avisoSinGrupo(acts) {
  if (!usaGrupos()) return '';
  const n = acts.filter(fueraDeGrupo).length;
  if (!n) return '';
  return `<span class="chip-filtro chip-alerta" title="Actividades registradas sin un Grupo LPS elegido. ${grupoElegido() ? 'Se ven en la vista «GT · todos» (primera línea del menú), bajo «Sin Grupo LPS».' : 'Aparecen abajo, bajo «Sin Grupo LPS».'}">⚠ ${n} sin Grupo LPS</span>`;
}

export const nombreGrupo = () => { const g = grupoElegido(); return g ? esc(g.nombre_corto) : ''; };
