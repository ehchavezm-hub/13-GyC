// Migración desde los Excel actuales (6.16): libros "OT_LA" (Plan_semanal / Look_ahead / BL) y "LPS_OT"
// (Cumplimiento_Plan_semanal / Look_ahead / LISTAS). Los datos se leen en el navegador y van directo a la base
// de datos: nunca pasan por el repositorio.
import { api } from '../data/api.js';
import { store, valoresLista, lideres, idPorCodigo, destinoActividad } from '../core/store.js';
import { normalizar, parseFecha, lunes, hoy, DIAS, libExcel } from '../core/util.js';

const SIN = {
  semana: ['semana', 'fecha'],
  resp1: ['resp. 1', 'resp.1', 'resp 1', 'resp1', 'responsable'],
  resp2: ['resp. 2', 'resp.2', 'resp 2', 'resp.22', 'resp2'],
  programa: ['programa', 'gerencia'],
  proyecto: ['proyecto / proceso', 'proy./proc.', 'proyecto/proceso', 'proyecto', 'proy. / proc.'],
  cet: ['cet'],
  servicio: ['servicio / entregable', 'servicio', 'entregable'],
  actividad: ['actividad', 'descripcion'],
  hh: ['hh', 'hh1'],
  tipo: ['tipo', 'prog.', 'prog'],
  estado: ['estado', 'c.', 'c'],
  cnc: ['cnc', 'causa'],
  restriccion: ['restriccion', 'restricción'],
  comentario: ['comentario', 'estado / comentario', 'estado/comentario'],
  estado_la: ['estado la'],
  f_solicitud: ['f_solicitud', 'f. solicitud'],
  f_prog: ['f_prog.', 'f_prog', 'f. programada'],
  criticidad: ['criticidad'],
};
const DIAS_EXCEL = [['l', 'd1', 'lu'], ['m', 'd2', 'ma'], ['x', 'd3', 'mi'], ['j', 'd4', 'ju'], ['v', 'd5', 'vi'], ['s', 'd6', 'sa'], ['d', 'd7', 'do']];

function similitud(a, b) {
  const x = normalizar(a).replace(/[^a-z0-9]/g, ''), y = normalizar(b).replace(/[^a-z0-9]/g, '');
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.85;
  return 0;
}

/** Lee el archivo y devuelve las hojas con filas como objetos {encabezado normalizado → valor}. */
export async function leerLibro(archivo) {
  await libExcel();
  const buf = await archivo.arrayBuffer();
  const wb = window.XLSX.read(buf, { type: 'array', cellDates: true });
  const hojas = [];
  for (const nombre of wb.SheetNames) {
    const filas = window.XLSX.utils.sheet_to_json(wb.Sheets[nombre], { header: 1, raw: true, defval: null });
    let iCab = -1;
    for (let i = 0; i < Math.min(15, filas.length); i++) {
      if ((filas[i] || []).some(c => normalizar(c) === 'actividad')) { iCab = i; break; }
    }
    if (iCab < 0) continue;
    const cab = filas[iCab].map(c => normalizar(c));
    const datos = filas.slice(iCab + 1).filter(f => f && f.some(v => v != null && v !== ''));
    hojas.push({ nombre, cab, datos, tipo: clasificar(nombre, cab) });
  }
  return hojas;
}

function clasificar(nombre, cab) {
  const n = normalizar(nombre);
  if (n.includes('look') || cab.includes('estado la') || cab.includes('a1')) return 'lookahead';
  if (n.startsWith('bl') || cab.includes('f_solicitud')) return 'cartera';
  if (n.includes('plan') || n.includes('cumplimiento')) return 'plan';
  return 'otro';
}

function columna(cab, clave) {
  const ops = SIN[clave];
  let i = cab.findIndex(c => ops.includes(c));
  if (i < 0) i = cab.findIndex(c => ops.some(o => c.startsWith(o)));
  return i;
}

/** Analiza las hojas de plan semanal y devuelve filas normalizadas + valores a mapear. */
export function analizar(hojas) {
  const filas = [];
  for (const h of hojas.filter(x => x.tipo === 'plan')) {
    const idx = Object.fromEntries(Object.keys(SIN).map(k => [k, columna(h.cab, k)]));
    // En OT_LA "ESTADO / COMENTARIO" es comentario y el cumplimiento está en "C."
    if (h.cab.includes('c.')) { idx.estado = h.cab.indexOf('c.'); idx.comentario = h.cab.findIndex(c => c.startsWith('estado')); }
    const dias = DIAS_EXCEL.map(ops => h.cab.findIndex(c => ops.includes(c)));
    for (const f of h.datos) {
      const actividad = f[idx.actividad];
      if (!actividad || !String(actividad).trim()) continue;
      const fecha = parseFecha(f[idx.semana]);
      if (!fecha) continue;
      const hh = {};
      dias.forEach((ci, i) => { hh[`hh_${DIAS[i]}`] = ci >= 0 ? Number(f[ci]) || 0 : 0; });
      if (dias.every(ci => ci < 0) && idx.hh >= 0) hh.hh_lu = Number(f[idx.hh]) || 0;
      filas.push({
        hoja: h.nombre, semana: lunes(fecha), resp1: txt(f[idx.resp1]), resp2: txt(f[idx.resp2]), programa: txt(f[idx.programa]),
        proyecto: txt(f[idx.proyecto]), cet: txt(f[idx.cet]), servicio: txt(f[idx.servicio]), actividad: txt(actividad),
        tipo: txt(f[idx.tipo]), estado: txt(f[idx.estado]), cnc: txt(f[idx.cnc]), restriccion: txt(f[idx.restriccion]),
        comentario: txt(f[idx.comentario]), ...hh,
      });
    }
  }
  const unicos = k => [...new Set(filas.map(f => f[k]).filter(Boolean))].sort();
  return { filas, responsables: unicos('resp1'), proyectos: unicos('proyecto'), programas: unicos('programa'), cncs: unicos('cnc'), servicios: [...new Set(filas.map(f => f.servicio || f.cet).filter(Boolean))].sort() };
}
const txt = v => v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim();

export function sugerirUsuario(codigo) {
  let mejor = null, p = 0;
  for (const l of lideres({ inactivos: true })) {
    const s = Math.max(similitud(codigo, l.codigo || ''), similitud(codigo, l.nombre), similitud(codigo.replace(/[._]/g, ' '), l.nombre),
      similitud(codigo.split(/[._ ]/).pop(), l.nombre.split(' ').slice(-1)[0]));
    if (s > p) { p = s; mejor = l; }
  }
  return p >= 0.85 ? mejor?.id : null;
}
export function sugerirProyecto(texto) {
  const cod = (texto.match(/\(([^)]+)\)/) || [])[1];
  for (const p of store.proyectos) {
    if (cod && (p.codigo === cod || cod.split('-').includes(p.codigo))) return p.id;
    if (similitud(texto, p.nombre_corto) === 1 || similitud(texto, p.codigo) === 1) return p.id;
  }
  for (const p of store.proyectos) if (similitud(texto, p.nombre_corto) >= 0.85) return p.id;
  return null;
}
function buscarValor(clave, texto) {
  if (!texto) return null;
  const vs = valoresLista(clave, { inactivos: true });
  return (vs.find(v => similitud(texto, v.valor) === 1 || (v.codigo && similitud(texto, v.codigo) === 1)) ||
    vs.find(v => similitud(texto, v.valor) >= 0.85))?.id || null;
}

function estadoDe(texto, semana) {
  const t = normalizar(texto);
  if (['si', 'sí', 'completado', 'completada', 'hecho'].includes(t)) return 'completado';
  if (['no', 'no completado', 'no completada', 'n'].includes(t)) return 'no_completado';
  if (['na', 'n/a', 'cancelado', 'cancelada'].includes(t)) return 'cancelado';
  return semana < lunes() ? 'cancelado' : 'programado';   // sin estado en semanas pasadas: no cuenta en el PAC (igual que en Excel)
}
function tipoDe(texto) {
  const t = normalizar(texto);
  return ['no programada', 'no programado', 'np', 'no'].includes(t) ? 'no_programada' : 'programada';
}

/**
 * Ejecuta la migración.
 * mapa: { usuarios: {codigo → id|''}, proyectos: {texto → id|'nuevo'|''}, crearListas: bool }
 */
export async function importar(analisis, mapa, progreso = () => {}) {
  const area = store.area.id;
  const res = { actividades: 0, historico: 0, proyectos: 0, cierres: 0, omitidas: 0, valores: 0 };

  // Valores de listas faltantes (CNC, servicios, gerencias)
  // CET de cada servicio del Excel (columna CET de la misma fila): el valor nuevo de "CET / Servicio" se crea con su código
  const cetDe = new Map();
  for (const f of analisis.filas) if (f.servicio && f.cet && !cetDe.has(f.servicio)) cetDe.set(f.servicio, f.cet);
  const codigoLibre = (clave, c) => c && !valoresLista(clave, { inactivos: true }).some(v => normalizar(v.codigo || '') === normalizar(c));
  const asegurar = async (clave, textos) => {
    const lista = store.listas[clave]?.lista;
    if (!lista || !mapa.crearListas) return;
    for (const t of textos) {
      if (buscarValor(clave, t) || (clave === 'servicios' && buscarValor(clave, cetDe.get(t)))) continue;
      const codigo = clave === 'gerencias' ? t : clave === 'servicios' && codigoLibre(clave, cetDe.get(t)) ? cetDe.get(t) : null;
      const [v] = await api.insert('lista_valores', { lista_id: lista.id, valor: t, codigo, orden: 900 });
      store.valores.set(v.id, v); store.listas[clave].valores.push(v); res.valores++;
    }
  };
  progreso('Revisando listas…');
  await asegurar('cnc', analisis.cncs);
  await asegurar('servicios', analisis.servicios);
  await asegurar('gerencias', analisis.programas);

  // Proyectos nuevos
  const proyId = {};
  for (const t of analisis.proyectos) {
    const m = mapa.proyectos[t];
    if (m === 'nuevo') {
      const cod = (t.match(/\(([^)]+)\)/) || [])[1] || t.slice(0, 20);
      const [p] = await api.insert('proyectos', { area_id: area, codigo: cod, nombre_corto: t.replace(/\s*\([^)]*\)\s*$/, '').slice(0, 80), estado: 'activo',
        tipo_id: idPorCodigo('tipos_proyecto', null) || valoresLista('tipos_proyecto')[0]?.id || null });
      proyId[t] = p.id; store.proyectos.push(p); res.proyectos++;
    } else proyId[t] = m || null;
  }

  // Evitar duplicados de una importación anterior
  const existentes = await api.list('actividades', { eq: { area_id: area, origen: 'importacion' } });
  const clave = a => `${a.semana}|${a.responsable_id}|${normalizar(a.descripcion)}`;
  const ya = new Set(existentes.map(clave));

  const conUsuario = [], sinUsuario = [];
  for (const f of analisis.filas) {
    const uid = mapa.usuarios[f.resp1];
    const estado = estadoDe(f.estado, f.semana);
    const cncId = estado === 'no_completado' ? (buscarValor('cnc', f.cnc) || buscarValor('cnc', 'Otra causa')) : null;
    const comentario = [f.comentario, f.restriccion ? `Restricción: ${f.restriccion}` : '', f.cnc && !buscarValor('cnc', f.cnc) ? `CNC original: ${f.cnc}` : '',
      !f.estado && f.semana < lunes() ? 'Sin estado en el Excel' : ''].filter(Boolean).join(' · ') || null;
    if (!uid) { sinUsuario.push({ ...f, estado }); continue; }
    const pid = proyId[f.proyecto] || null;
    const reg = {
      area_id: area, semana: f.semana, responsable_id: uid, resp2: f.resp2 || null, ...destinoActividad(pid),   // grupo elegido + proyecto atendido
      gerencia_id: buscarValor('gerencias', f.programa) || store.proyectos.find(p => p.id === pid)?.gerencia_id || null,
      cet_id: null, servicio_id: buscarValor('servicios', f.servicio) || buscarValor('servicios', f.cet), descripcion: f.actividad,   // por nombre o por su CET
      hh_lu: f.hh_lu, hh_ma: f.hh_ma, hh_mi: f.hh_mi, hh_ju: f.hh_ju, hh_vi: f.hh_vi, hh_sa: f.hh_sa, hh_do: f.hh_do,
      tipo: tipoDe(f.tipo), comprometida: true, estado_la: 'trasladada', estado, cnc_id: cncId, comentario, origen: 'importacion',
    };
    if (ya.has(clave(reg))) { res.omitidas++; continue; }
    ya.add(clave(reg));
    conUsuario.push(reg);
  }
  for (let i = 0; i < conUsuario.length; i += 200) {
    progreso(`Importando actividades ${i + 1}–${Math.min(i + 200, conUsuario.length)} de ${conUsuario.length}…`);
    await api.insert('actividades', conUsuario.slice(i, i + 200));
  }
  res.actividades = conUsuario.length;

  // Cierre de las semanas pasadas importadas (quedan como fotografía del histórico)
  const semanasCerrar = new Set(conUsuario.filter(a => a.semana < lunes()).map(a => `${a.responsable_id}|${a.semana}`));
  const cierres = await api.list('cierres', { eq: { area_id: area } });
  const yaCerradas = new Set(cierres.map(c => `${c.responsable_id}|${c.semana}`));
  for (const k of semanasCerrar) {
    if (yaCerradas.has(k)) continue;
    const [responsable_id, semana] = k.split('|');
    try { await api.insert('cierres', { area_id: area, responsable_id, semana }); res.cierres++; } catch { /* semana con datos incompletos */ }
  }

  // Responsables sin usuario: solo resumen de PAC
  const grupos = new Map();
  for (const f of sinUsuario) {
    if (tipoDe(f.tipo) !== 'programada') continue;
    const k = `${f.semana}|${f.resp1}`;
    const g = grupos.get(k) || { area_id: area, semana: f.semana, responsable_codigo: f.resp1 || 'Sin responsable', completadas: 0, no_completadas: 0, canceladas: 0, hh_plan: 0, hh_completadas: 0, fuente: 'Importación Excel' };
    const hh = DIAS.reduce((s, d) => s + (Number(f[`hh_${d}`]) || 0), 0);
    if (f.estado === 'completado') { g.completadas++; g.hh_completadas += hh; }
    else if (f.estado === 'no_completado') g.no_completadas++;
    else g.canceladas++;
    g.hh_plan += hh;
    grupos.set(k, g);
  }
  if (grupos.size) { await api.insert('pac_historico', [...grupos.values()]); res.historico = grupos.size; }
  return res;
}

/** Importación de proyectos desde una hoja con columnas Código / Proyecto / Nombre completo / Gerencia. */
export async function leerProyectos(archivo) {
  await libExcel();
  const buf = await archivo.arrayBuffer();
  const wb = window.XLSX.read(buf, { type: 'array' });
  const out = [];
  for (const n of wb.SheetNames) {
    const filas = window.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: null });
    for (let i = 0; i < Math.min(20, filas.length); i++) {
      const cab = (filas[i] || []).map(c => normalizar(c));
      const iCod = cab.findIndex(c => ['codigo', 'cod.', 'cod', 'cr'].includes(c));
      const iNom = cab.findIndex(c => ['proyecto', 'nombre corto', 'nombre', 'proyecto / proceso'].includes(c));
      if (iCod < 0 || iNom < 0) continue;
      const iCom = cab.findIndex(c => c.includes('completo'));
      const iGer = cab.findIndex(c => ['gerencia', 'programa'].includes(c));
      for (const f of filas.slice(i + 1)) {
        if (!f || !f[iCod] || !f[iNom] || String(f[iNom]).startsWith('=')) continue;
        out.push({ codigo: String(f[iCod]).trim(), nombre_corto: String(f[iNom]).trim(), nombre_completo: iCom >= 0 && f[iCom] ? String(f[iCom]).trim() : null,
          gerencia: iGer >= 0 && f[iGer] ? String(f[iGer]).trim() : null, hoja: n });
      }
      break;
    }
  }
  return out;
}

export function gerenciaDe(texto) { return buscarValor('gerencias', texto); }
export const _interno = { estadoDe, tipoDe, similitud, hoy };
