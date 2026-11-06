// Cálculos de indicadores (sección 10 del alcance) y reglas RN-02, RN-06, M-02, M-03, M-08, M-09.
import { param, horasDia, store, idPorCodigo } from '../core/store.js';
import { semanasEntre, sumarDias, hoy, agrupar, sum } from '../core/util.js';

/** Resumen de cumplimiento de un conjunto de actividades de una o varias semanas. */
export function resumenPAC(acts) {
  const comp = acts.filter(a => a.comprometida);
  const prog = comp.filter(a => a.tipo === 'programada');
  const completadas = prog.filter(a => a.estado === 'completado');
  const noCompletadas = prog.filter(a => a.estado === 'no_completado');
  const canceladas = prog.filter(a => a.estado === 'cancelado');
  const pendientes = prog.filter(a => a.estado === 'programado');
  const noProg = comp.filter(a => a.tipo === 'no_programada');
  const c = completadas.length, n = noCompletadas.length;
  const hhC = sum(completadas, 'hh_total'), hhN = sum(noCompletadas, 'hh_total');
  const hhPlan = sum(comp, 'hh_total');
  const conReal = comp.filter(a => a.hh_real != null);
  return {
    comprometidas: prog.length,
    completadas: c,
    noCompletadas: n,
    canceladas: canceladas.length,
    pendientes: pendientes.length,
    noProgramadas: noProg.length,
    total: comp.length,
    pac: c + n > 0 ? c / (c + n) : null,
    pacPonderado: hhC + hhN > 0 ? hhC / (hhC + hhN) : null,
    hhPlan,
    hhReal: conReal.length ? sum(conReal, 'hh_real') : null,
    hhPlanConReal: sum(conReal, 'hh_total'),
    precision: conReal.length && sum(conReal, 'hh_total') > 0 ? sum(conReal, 'hh_real') / sum(conReal, 'hh_total') : null,
    pctNoProgramadas: comp.length ? noProg.length / comp.length : null,
  };
}

/** Combina un resumen calculado con los registros migrados del histórico. */
export function resumenHistorico(regs) {
  const c = sum(regs, 'completadas'), n = sum(regs, 'no_completadas');
  return { completadas: c, noCompletadas: n, canceladas: sum(regs, 'canceladas'), pac: c + n ? c / (c + n) : null,
    hhPlan: sum(regs, 'hh_plan'), pacPonderado: null, historico: true };
}

export function colorPAC(v) {
  if (v == null) return '#BAB0AC';
  if (v >= Number(param('meta_pac'))) return '#59A14F';
  if (v >= Number(param('umbral_ambar'))) return '#EDC948';
  return '#E15759';
}

/** Semanas que un compromiso lleva pendiente (RN-06). */
export function semanasPendiente(a) {
  if (['completado', 'cancelado'].includes(a.estado)) return 0;
  const origen = a.semana_original || a.semana;
  return Math.max(0, semanasEntre(origen, a.semana));
}

/** Capacidad semanal en HH de una persona (M-02): días laborables × horas/día − ausencias. */
export function capacidadSemana(usuarioId, semana, ubicaciones = []) {
  const dias = (param('dias_laborables') || [1, 2, 3, 4, 5]).map(Number);
  const h = horasDia(usuarioId);
  let total = 0;
  for (let d = 1; d <= 7; d++) {
    const f = sumarDias(semana, d - 1);
    const u = ubicaciones.find(x => x.usuario_id === usuarioId && x.fecha === f);
    const v = u && store.valores.get(u.ubicacion_id);
    if (dias.includes(d)) {
      if (v && v.extra?.cuenta_capacidad === false) continue;   // vacaciones, feriado…
      total += h;
    } else if (param('trabajo_fin_semana') && v && v.extra?.cuenta_capacidad !== false) {
      total += h;   // día no laborable con lugar de trabajo registrado (p. ej. sábado en obra)
    }
  }
  return total;
}

export function colorCarga(ratio) {
  if (ratio == null) return '#BAB0AC';
  if (ratio > 1.05) return '#E15759';
  if (ratio > 0.9) return '#EDC948';
  return '#59A14F';
}

/** Restricciones (M-08): pendientes, vencidas y % levantadas a tiempo. */
export function resumenRestricciones(rests) {
  const h = hoy();
  const abiertas = rests.filter(r => r.estado !== 'levantada');
  const vencidas = abiertas.filter(r => r.f_requerida && r.f_requerida < h);
  const levantadas = rests.filter(r => r.estado === 'levantada' && r.f_levantada);
  const aTiempo = levantadas.filter(r => !r.f_requerida || r.f_levantada <= r.f_requerida);
  const atrasos = levantadas.filter(r => r.f_requerida && r.f_levantada > r.f_requerida)
    .map(r => semanasEntre(r.f_requerida, r.f_levantada) * 7 || Math.max(1, (new Date(r.f_levantada) - new Date(r.f_requerida)) / 86400000));
  return {
    abiertas: abiertas.length, vencidas: vencidas.length, levantadas: levantadas.length,
    pctATiempo: levantadas.length ? aTiempo.length / levantadas.length : null,
    diasAtraso: atrasos.length ? atrasos.reduce((a, b) => a + b, 0) / atrasos.length : null,
  };
}

/** Pareto de CNC: [{ cnc_id, cantidad, pct, acumulado }]. */
export function paretoCNC(acts) {
  const nc = acts.filter(a => a.comprometida && a.tipo === 'programada' && a.estado === 'no_completado');
  const g = agrupar(nc, a => a.cnc_id || '');
  const total = nc.length;
  let acum = 0;
  return [...g.entries()].map(([id, arr]) => ({ cnc_id: id || null, cantidad: arr.length }))
    .sort((a, b) => b.cantidad - a.cantidad)
    .map(x => { acum += x.cantidad; return { ...x, pct: total ? x.cantidad / total : 0, acumulado: total ? acum / total : 0 }; });
}

/** Actividad con restricciones pendientes (RN-07). */
export function restriccionesActivas(actividadId, rests) {
  return rests.filter(r => r.actividad_id === actividadId && r.estado !== 'levantada');
}

export function idCncNoReportado() { return idPorCodigo('cnc', 'no_reportado'); }
