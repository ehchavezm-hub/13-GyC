// Enrutador por hash (#/ruta/parametro?clave=valor). Cada vista exporta render(el, params) y opcionalmente destruir().

import { medir } from './monitoreo.js';

const rutas = [];
let vistaActual = null;
let contenedor = null;
let antesDeNavegar = null;

export function ruta(patron, cargar, opciones = {}) {
  const claves = [];
  const re = new RegExp('^' + patron.replace(/:(\w+)/g, (_, k) => { claves.push(k); return '([^/]+)'; }) + '$');
  rutas.push({ patron, re, claves, cargar, ...opciones });
}

export function iniciarRouter(el, { porDefecto = '/plan', guardia } = {}) {
  contenedor = el;
  antesDeNavegar = guardia;
  window.addEventListener('hashchange', () => resolver(porDefecto));
  resolver(porDefecto);
}

export function ir(hash) {
  if (location.hash === hash) resolver();
  else location.hash = hash;
}

export function rutaActual() {
  const [camino, query] = location.hash.replace(/^#/, '').split('?');
  return { camino: camino || '/', query: new URLSearchParams(query || '') };
}

export function actualizarQuery(cambios) {
  const { camino, query } = rutaActual();
  for (const [k, v] of Object.entries(cambios)) {
    if (v == null || v === '') query.delete(k); else query.set(k, v);
  }
  const q = query.toString();
  history.replaceState(null, '', `#${camino}${q ? '?' + q : ''}`);
}

async function resolver(porDefecto) {
  const { camino, query } = rutaActual();
  if (camino === '/' || !camino) { location.hash = '#' + (porDefecto || '/plan'); return; }
  let encontrada = null, params = {};
  for (const r of rutas) {
    const m = camino.match(r.re);
    if (m) { encontrada = r; r.claves.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); break; }
  }
  if (!encontrada) { contenedor.innerHTML = '<div class="vacio"><p>Página no encontrada.</p></div>'; return; }
  if (antesDeNavegar && !antesDeNavegar(encontrada)) return;
  try { vistaActual?.destruir?.(); } catch (e) { console.warn(e); }
  vistaActual = null;
  contenedor.innerHTML = '<div class="cargando"><span class="spinner"></span> Cargando…</div>';
  document.dispatchEvent(new CustomEvent('ruta', { detail: { camino, ruta: encontrada } }));
  try {
    const mod = await encontrada.cargar();
    vistaActual = mod;
    contenedor.innerHTML = '';
    await medir(`pantalla ${encontrada.patron}`, () => mod.render(contenedor, { ...params, query }));
    contenedor.scrollTop = 0;
  } catch (e) {
    console.error(e);
    contenedor.innerHTML = `<div class="aviso error">No se pudo cargar la página: ${String(e.message || e).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)}</div>`;
  }
}
