// Resumen semanal en texto, listo para pegar en Teams o enviar por correo (reemplaza la macro ExportarResumen).
import { api } from '../data/api.js';
import { store, lideres, nombre, etiqueta, param, nombreProyecto, enProyectoSel, nombreSeleccion } from '../core/store.js';
import { etiquetaSemana, hoy, pct, esc, html, num } from '../core/util.js';
import { resumenPAC, paretoCNC, resumenRestricciones, semanasPendiente } from './indicadores.js';
import { modal, ok } from '../ui/ui.js';

export async function generarResumen(semana) {
  const area = store.area.id;
  const [acts, rests] = await Promise.all([
    api.list('actividades', { eq: { area_id: area, semana } }),
    api.list('restricciones', { eq: { area_id: area } }),
  ]);
  const filtradas = acts.filter(a => enProyectoSel(a.proyecto_id));
  const r = resumenPAC(filtradas);
  const meta = Number(param('meta_pac'));
  const lineas = [];
  lineas.push(`📊 RESUMEN SEMANAL LPS-GES — ${etiquetaSemana(semana)}`);
  if (store.proyectoSel) lineas.push(`Proyecto: ${nombreProyecto(store.proyectoSel)}`);
  else if (store.nivelSel) lineas.push(nombreSeleccion());
  lineas.push('');
  lineas.push(`PAC del equipo: ${pct(r.pac)} (meta ${pct(meta)}) ${r.pac == null ? '' : r.pac >= meta ? '✅' : '⚠️'}`);
  lineas.push(`Compromisos: ${r.comprometidas} · Completados: ${r.completadas} · No completados: ${r.noCompletadas} · Cancelados: ${r.canceladas}${r.pendientes ? ` · Sin estado: ${r.pendientes}` : ''}`);
  lineas.push(`No programadas: ${r.noProgramadas} · HH planificadas: ${num(r.hhPlan)}${r.hhReal != null ? ` · HH reales: ${num(r.hhReal)}` : ''}`);
  lineas.push('');
  lineas.push('PAC por líder:');
  for (const l of lideres()) {
    const rl = resumenPAC(filtradas.filter(a => a.responsable_id === l.id));
    if (!rl.total) continue;
    lineas.push(`• ${l.nombre}: ${pct(rl.pac)} (${rl.completadas}/${rl.completadas + rl.noCompletadas})${rl.pac != null && rl.pac < meta ? ' ⚠️' : ''}`);
  }
  const pareto = paretoCNC(filtradas).slice(0, 3);
  if (pareto.length) {
    lineas.push('');
    lineas.push('Principales causas de no cumplimiento:');
    pareto.forEach((p, i) => lineas.push(`${i + 1}. ${etiqueta(p.cnc_id) || 'Sin causa'} — ${p.cantidad} (${pct(p.pct)})`));
  }
  const rr = resumenRestricciones(rests);
  lineas.push('');
  lineas.push(`Restricciones abiertas: ${rr.abiertas} · Vencidas: ${rr.vencidas}`);
  const vencidas = rests.filter(x => x.estado !== 'levantada' && x.f_requerida && x.f_requerida < hoy()).slice(0, 5);
  for (const v of vencidas) lineas.push(`  - ${v.descripcion} (resp.: ${v.responsable || nombre(v.responsable_id) || '—'})`);
  const arrastres = filtradas.filter(a => semanasPendiente(a) >= Number(param('arrastre_alerta') || 2));
  if (arrastres.length) {
    lineas.push('');
    lineas.push(`Compromisos arrastrados ${param('arrastre_alerta') || 2}+ semanas: ${arrastres.length}`);
    for (const a of arrastres.slice(0, 5)) lineas.push(`  - ${a.descripcion} (${nombre(a.responsable_id)})`);
  }
  return lineas.join('\n');
}

export async function mostrarResumen(semana) {
  const texto = await generarResumen(semana);
  const cuerpo = html(`<div><textarea class="pegar-area" rows="18" readonly>${esc(texto)}</textarea></div>`);
  modal({
    titulo: 'Resumen semanal', cuerpo, ancho: 720,
    botones: [
      { texto: 'Cerrar' },
      { texto: '✉ Enviar por correo', accion: () => {
        location.href = `mailto:?subject=${encodeURIComponent('Resumen semanal LPS-GES — ' + etiquetaSemana(semana))}&body=${encodeURIComponent(texto)}`;
        return false;
      } },
      { texto: '📋 Copiar para Teams', clase: 'btn-primario', accion: async () => {
        try { await navigator.clipboard.writeText(texto); } catch { cuerpo.querySelector('textarea').select(); document.execCommand('copy'); }
        ok('Resumen copiado. Péguelo en Teams o en un correo.');
        return false;
      } },
    ],
  });
}
