// Reportes: árbol de reportes a la izquierda y presentación preliminar a la derecha (papel, orientación,
// "Todo en 1 hoja", nombre del archivo y Guardar PDF). Desde q50 solo quedan los de Configuración
// (los de Planificación y Seguimiento y control se retiraron).
import { api, mensajeError } from '../data/api.js';
import { store, on, proyecto, etiqueta, textoEstado, esStaff } from '../core/store.js';
import { esc, html, fmtFecha, agrupar } from '../core/util.js';
import { error } from '../ui/ui.js';
import { tablaPDF, documentoReporte, nombreArchivo, limpiarNombre, guardarPDF, PAPELES } from '../services/pdf.js';

// ---------- Catálogo de reportes ----------
const REPORTES = [
  { grupo: 'Configuración', id: 'proyectos', staff: true, titulo: 'Catálogo de proyectos / procesos', orientacion: 'landscape',
    async generar() {
      const orden = ['activo', 'en_pausa', 'cerrado', 'propuesto'];
      // Cada Grupo LPS va justo debajo de su proyecto y muestra a cuál pertenece (auditoría 2)
      const padreDe = p => p.padre_id && proyecto(p.padre_id);
      const clave = p => `${padreDe(p)?.codigo ?? p.codigo}|${p.padre_id ? '1' : '0'}|${p.codigo}`;
      const grupos = agrupar([...store.proyectos].sort((a, b) => clave(a).localeCompare(clave(b))), p => p.estado);
      const cols = [
        { titulo: 'Código', ancho: 90, valor: p => p.codigo }, { titulo: 'Nombre corto', ancho: 200, valor: p => p.padre_id ? `   ▫ ${p.nombre_corto}` : p.nombre_corto },
        { titulo: 'Grupo LPS de', ancho: 160, valor: p => padreDe(p) ? `${padreDe(p).codigo} · ${padreDe(p).nombre_corto}` : '' },
        { titulo: 'Nombre completo', ancho: 280, valor: p => p.nombre_completo || '' }, { titulo: 'Gerencia', ancho: 150, valor: p => etiqueta(p.gerencia_id) },
        { titulo: 'Fase', ancho: 110, valor: p => etiqueta(p.fase_id) }, { titulo: 'País', ancho: 80, valor: p => etiqueta(p.pais_id) },
        { titulo: 'Inicio', ancho: 75, valor: p => fmtFecha(p.fecha_inicio) }, { titulo: 'Fin', ancho: 75, valor: p => fmtFecha(p.fecha_fin) },
      ];
      return [...grupos.keys()].sort((a, b) => orden.indexOf(a) - orden.indexOf(b)).map(e =>
        `<h2>${esc(textoEstado('estados_proyecto', e) || e)} · ${grupos.get(e).length}</h2>` + tablaPDF(cols, grupos.get(e))).join('');
    } },
  { grupo: 'Configuración', id: 'equipo', staff: true, titulo: 'Usuarios y roles (con organigrama)', orientacion: 'landscape',
    async generar() {
      // Mismo contenido que Configuración → Usuarios y roles: tabla con sus columnas y el organigrama
      const nodos = await api.list('organigrama_nodos', { eq: { area_id: store.area.id }, order: [['orden', true]] });
      return (await import('./organigrama.js')).informeEquipo(nodos);
    } },
];

// ---------- Pantalla ----------
let estado, desuscribir = [], tituloApp = null;

export async function render(el) {
  let opciones = { papel: 'A4', unaHoja: false };
  try { opciones = { ...opciones, ...JSON.parse(localStorage.getItem('gyc-reportes') || '{}') }; } catch { /* sin almacenamiento */ }
  disponibles = REPORTES.filter(r => !r.staff || esStaff());
  if (!disponibles.length) {
    el.append(html('<div class="tarjeta"><p class="nota">No hay reportes disponibles para su rol.</p></div>'));
    return;
  }
  estado = { id: disponibles.some(r => r.id === opciones.ultimo) ? opciones.ultimo : disponibles[0].id, opciones, orientacion: null };
  const grupos = [...new Set(disponibles.map(r => r.grupo))];
  const pag = html(`<div class="reportes">
    <div class="reportes-arbol">${grupos.map(g => `<details open><summary>${esc(g)}</summary>
      ${disponibles.filter(r => r.grupo === g).map(r => `<button data-r="${r.id}">${esc(r.titulo)}</button>`).join('')}</details>`).join('')}</div>
    <div class="reportes-vista">
      <div class="reportes-barra">
        <label>Papel <select data-o="papel">${Object.keys(PAPELES).map(p => `<option>${p}</option>`).join('')}</select></label>
        <span class="seg"><button data-ori="landscape">▭ Horizontal</button><button data-ori="portrait">▯ Vertical</button></span>
        <label><input type="checkbox" data-o="unaHoja"> Todo en 1 hoja</label>
        <label class="archivo">📁 <input data-o="archivo"></label>
        <span class="flex"></span>
        <button class="btn btn-sm" data-a="imprimir" title="Abrir el diálogo de impresión (papel)">🖨 Imprimir</button>
        <button class="btn btn-primario btn-sm" data-a="pdf" title="Descargar el PDF con el nombre indicado">⬇ Guardar PDF</button>
      </div>
      <div class="reportes-hojas"><iframe data-prev title="Presentación preliminar"></iframe><div class="cargando oculto" data-carg><span class="spinner"></span> Generando…</div></div>
    </div></div>`);
  el.append(pag);
  pag.querySelector('[data-o="papel"]').value = PAPELES[estado.opciones.papel] ? estado.opciones.papel : 'A4';   // un papel ya no ofrecido vuelve a A4
  pag.querySelector('[data-o="unaHoja"]').checked = !!estado.opciones.unaHoja;

  pag.querySelector('.reportes-arbol').addEventListener('click', e => {
    const id = e.target.closest('[data-r]')?.dataset.r;
    if (id) { estado.id = id; estado.orientacion = null; generar(); }
  });
  pag.querySelectorAll('[data-ori]').forEach(b => b.addEventListener('click', () => { estado.orientacion = b.dataset.ori; generar(false); }));
  pag.querySelectorAll('[data-o="papel"], [data-o="unaHoja"]').forEach(i => i.addEventListener('change', () => generar(false)));
  // Chrome propone como nombre del PDF el título de la pestaña: se mantiene igual al nombre del archivo mientras se
  // está en Reportes (no solo al imprimir, cuando a veces todavía no lo ha tomado) y se restituye al salir.
  tituloApp ??= document.title;
  pag.querySelector('[data-o="archivo"]').addEventListener('input', fijarTitulo);
  pag.querySelector('[data-prev]').addEventListener('load', fijarTitulo);
  pag.querySelector('[data-a="imprimir"]').addEventListener('click', () => {
    const f = pag.querySelector('[data-prev]');
    fijarTitulo();
    f.contentWindow.focus(); f.contentWindow.print();
  });
  // q69: el PDF se genera y se descarga con el nombre exacto del campo (no depende del diálogo de impresión)
  pag.querySelector('[data-a="pdf"]').addEventListener('click', async e => {
    const rep = disponibles.find(r => r.id === estado.id) || disponibles[0];
    try {
      await guardarPDF(e.currentTarget, rep.titulo, ultimoHTML, { papel: pag.querySelector('[data-o="papel"]').value,
        orientacion: estado.orientacion || rep.orientacion, unaHoja: pag.querySelector('[data-o="unaHoja"]').checked, archivo: nombrePDF() });
    } catch (err) { error(mensajeError(err)); }
  });
  desuscribir.forEach(f => f()); desuscribir = [];
  desuscribir.push(on('proyecto', () => generar()));
  await generar();
}

function nombrePDF() {
  const v = document.querySelector('#contenido .reportes [data-o="archivo"]')?.value || nombreArchivo('Reporte');
  return limpiarNombre(v.replace(/\.pdf$/i, '')) || nombreArchivo('Reporte');
}
function fijarTitulo() {
  const n = nombrePDF();
  document.title = n;
  try { const d = document.querySelector('#contenido .reportes [data-prev]')?.contentDocument; if (d) d.title = n; } catch { /* aún cargando */ }
}

let ultimoHTML = '', disponibles = REPORTES;
async function generar(releer = true) {
  const pag = document.querySelector('#contenido .reportes');
  if (!pag) return;
  const rep = disponibles.find(r => r.id === estado.id) || disponibles[0];
  pag.querySelectorAll('[data-r]').forEach(b => b.classList.toggle('activo', b.dataset.r === rep.id));
  const orientacion = estado.orientacion || rep.orientacion;
  pag.querySelectorAll('[data-ori]').forEach(b => b.classList.toggle('activo', b.dataset.ori === orientacion));
  const papel = pag.querySelector('[data-o="papel"]').value;
  const unaHoja = pag.querySelector('[data-o="unaHoja"]').checked;
  const archivo = nombreArchivo(rep.titulo, new Date());
  pag.querySelector('[data-o="archivo"]').value = archivo + '.pdf';
  fijarTitulo();
  try { localStorage.setItem('gyc-reportes', JSON.stringify({ papel, unaHoja, ultimo: rep.id })); } catch { /* sin almacenamiento */ }
  const carg = pag.querySelector('[data-carg]');
  try {
    if (releer || !ultimoHTML) {
      carg.classList.remove('oculto');
      ultimoHTML = await rep.generar();
    }
    pag.querySelector('[data-prev]').srcdoc = documentoReporte(rep.titulo, ultimoHTML, { papel, orientacion, unaHoja, archivo });
  } catch (e) {
    error(mensajeError(e));
  } finally { carg.classList.add('oculto'); }
}

export function destruir() {
  desuscribir.forEach(f => f()); desuscribir = []; estado = null; ultimoHTML = '';
  if (tituloApp != null) { document.title = tituloApp; tituloApp = null; }
}
