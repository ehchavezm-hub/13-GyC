// Utilidades generales: fechas, semanas, formato y escape de HTML.

export const DIAS = ['lu', 'ma', 'mi', 'ju', 'vi', 'sa', 'do'];
export const DIAS_CORTOS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
export const DIAS_NOMBRE = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

/** Fecha local a 'YYYY-MM-DD'. */
export function iso(d) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

/** 'YYYY-MM-DD' a Date local (sin desfase de zona horaria). */
export function fecha(s) {
  if (s instanceof Date) return new Date(s.getFullYear(), s.getMonth(), s.getDate());
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function hoy() { return iso(new Date()); }

export function sumarDias(s, n) {
  const d = fecha(s);
  d.setDate(d.getDate() + n);
  return iso(d);
}

/** Lunes de la semana de una fecha. */
export function lunes(s = new Date()) {
  const d = fecha(s);
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return iso(d);
}

export function sumarSemanas(semana, n) { return sumarDias(lunes(semana), n * 7); }

/** Número de semana ISO 8601. */
export function numeroSemana(s) {
  const d = fecha(s);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dia = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dia);
  const inicio = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return { anio: t.getUTCFullYear(), semana: Math.ceil(((t - inicio) / 86400000 + 1) / 7) };
}

export function etiquetaSemana(semana) {
  const { semana: n } = numeroSemana(semana);
  return `S-${String(n).padStart(2, '0')} · ${fmtCorto(semana)} – ${fmtCorto(sumarDias(semana, 6))}`;
}

export function semanasEntre(a, b) {
  return Math.round((fecha(lunes(b)) - fecha(lunes(a))) / (7 * 86400000));
}

export function fmtFecha(s) {
  if (!s) return '';
  const d = fecha(s);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

export function fmtCorto(s) {
  const d = fecha(s);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function fmtFechaHora(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${fmtFecha(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 'DD/MM/AAAA', 'DD-MM-AAAA', 'AAAA-MM-DD' o número de serie de Excel → 'YYYY-MM-DD'. */
export function parseFecha(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return iso(v);
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return iso(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

export function num(v, dec = 1) {
  if (v == null || v === '' || isNaN(v)) return '';
  return Number(v).toLocaleString('es-PE', { minimumFractionDigits: 0, maximumFractionDigits: dec });
}

export function pct(v) {
  if (v == null || isNaN(v)) return '—';
  return `${Math.round(v * 100)} %`;
}

export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function debounce(fn, ms = 300) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function agrupar(arr, key) {
  const m = new Map();
  for (const x of arr) {
    const k = typeof key === 'function' ? key(x) : x[key];
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

export function sum(arr, f) { return arr.reduce((a, x) => a + (Number(typeof f === 'function' ? f(x) : x[f]) || 0), 0); }

export function normalizar(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Crea un elemento a partir de HTML. */
export function html(str) {
  const t = document.createElement('template');
  t.innerHTML = str.trim();
  return t.content.firstElementChild;
}

export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

// Librerías pesadas que solo se usan en algunas acciones: se descargan la primera vez que se necesitan
// (antes se cargaban en cada ingreso: Excel ~950 KB y gráficos ~200 KB)
const librerias = new Map();
function cargarScript(src, global) {
  if (window[global]) return Promise.resolve(window[global]);
  if (!librerias.has(src)) {
    librerias.set(src, new Promise((ok, mal) => {
      const s = document.createElement('script');
      s.src = src; s.onload = () => ok(window[global]);
      s.onerror = () => { librerias.delete(src); mal(new Error('No se pudo descargar la librería. Revise su conexión e intente nuevamente.')); };
      document.head.append(s);
    }));
  }
  return librerias.get(src);
}
/** Librería de Excel (SheetJS): importar, exportar y respaldos. */
export const libExcel = () => cargarScript('vendor/xlsx.full.min.js', 'XLSX');
/** Librería de gráficos (Chart.js): Tablero. */
export const libGraficos = () => cargarScript('vendor/chart.umd.min.js', 'Chart');
