// Enlace directo a una actividad (desde notificaciones): abre su semana y el detalle de comentarios.
import { api } from '../data/api.js';
import { lunes, hoy } from '../core/util.js';
import { vacio } from '../ui/ui.js';

export async function render(el, { id }) {
  const [a] = await api.list('actividades', { eq: { id } });
  if (!a) { el.innerHTML = vacio('La actividad no existe o no tiene permiso para verla.'); return; }
  const destino = a.semana > lunes(hoy()) && !a.comprometida ? '#/lookahead' : `#/plan?semana=${a.semana}&resp=${a.responsable_id}`;
  location.replace(location.pathname + location.search + destino);
  setTimeout(() => import('./detalle.js').then(m => m.abrirDetalle('actividad', a)), 900);
}
