// Organigrama del equipo (Configuración → Usuarios y roles), inspirado en la "Estructura de Proyectos" de ECM Project:
// lienzo con tarjetas movibles, líneas de dependencia, agregar/editar/eliminar, organizar, ajustar, pantalla completa e imprimir.
// Nodos: "unidad" (área o especialidad) y "persona" (vinculada a un usuario: muestra nombre, cargo y rol).
import { api, mensajeError } from '../data/api.js';
import { store, puede, nombre, esAdmin } from '../core/store.js';
import { ROLES, PLANIFICADORES, COLOR_ROL } from '../data/catalogos.js';
import { esc, html, debounce } from '../core/util.js';
import { pedirDatos, confirmar, ok, error } from '../ui/ui.js';
import { imprimirPDF, tablaPDF } from '../services/pdf.js';

const ANCHO = 200, ALTO = 92, SEP_X = 40, SEP_Y = 70;
let estado = null;

/** Dibuja el organigrama dentro de "cont". Devuelve una función para desmontarlo. */
export async function montarOrganigrama(cont) {
  desmontarOrganigrama();
  const editable = esAdmin();
  const raiz = html(`<div class="tarjeta org">
    <div class="barra" style="margin-bottom:10px"><h2 style="margin:0">Organigrama del equipo</h2><span class="flex"></span>
      ${editable ? `<button class="btn btn-sm btn-primario" data-o="unidad">＋ Unidad</button>
        <button class="btn btn-sm" data-o="persona">＋ Persona</button>
        <button class="btn btn-sm" data-o="generar" title="Agrega a las personas del equipo que aún no están">⚡ Generar desde usuarios</button>
        <span class="org-sep"></span>
        <button class="btn btn-sm" data-o="organizar" title="Ordena las tarjetas automáticamente">⟲ Organizar</button>` : ''}
      <button class="btn btn-sm" data-o="ajustar" title="Ajustar todo el organigrama a la ventana">⊞ Ajustar</button>
      <button class="btn btn-sm" data-o="completa" title="Pantalla completa">⛶</button>
      <button class="btn btn-sm" data-o="imprimir">🖨 Imprimir</button></div>
    <div class="org-vista"><div class="org-lienzo"><svg class="org-lineas"></svg></div></div>
    ${editable ? '<p class="nota" style="margin-top:6px">Arrastre las tarjetas para acomodarlas. ✎ edita, ＋ agrega una persona o unidad debajo, 🗑 la quita (sus dependientes pasan a su jefe).</p>' : ''}
  </div>`);
  cont.append(raiz);
  estado = { raiz, editable, nodos: [], escala: 1,
    vista: raiz.querySelector('.org-vista'), lienzo: raiz.querySelector('.org-lienzo'), svg: raiz.querySelector('.org-lineas') };
  raiz.addEventListener('click', e => {
    const o = e.target.closest('[data-o]')?.dataset.o;
    if (o === 'unidad') formulario({ tipo: 'unidad' });
    if (o === 'persona') formulario({ tipo: 'persona' });
    if (o === 'generar') generarDesdeUsuarios();
    if (o === 'organizar') organizar(true);
    if (o === 'ajustar') ajustar();
    if (o === 'completa') { raiz.classList.toggle('org-completa'); setTimeout(ajustar, 50); }
    if (o === 'imprimir') imprimir();
    const t = e.target.closest('[data-t]');
    if (t) {
      const n = estado.nodos.find(x => x.id === t.closest('.org-nodo').dataset.id);
      if (t.dataset.t === 'editar') formulario(n);
      if (t.dataset.t === 'hijo') formulario({ tipo: 'persona', padre_id: n.id });
      if (t.dataset.t === 'borrar') borrar(n);
    }
  });
  const recargar = debounce(() => cargar(), 500);
  estado.desuscribir = api.subscribe(['organigrama_nodos', 'profiles'], () => { if (!estado?.arrastrando) recargar(); });
  await cargar();
  return desmontarOrganigrama;
}

export function desmontarOrganigrama() {
  estado?.desuscribir?.();
  estado = null;
}

async function cargar() {
  if (!estado) return;
  estado.nodos = await api.list('organigrama_nodos', { eq: { area_id: store.area.id }, order: [['orden', true], ['created_at', true]] });
  if (estado.nodos.some(n => n.x == null || n.y == null)) await organizar(estado.editable);   // nodos nuevos sin posición
  pintar();
}

const perfil = id => store.perfiles.find(p => p.id === id);
function textoNodo(n) {
  if (n.tipo === 'unidad') return { titulo: n.titulo || 'Unidad', sub: `${hijos(n.id).length} dependiente(s)`, rol: '' };
  const p = perfil(n.usuario_id);
  return { titulo: p?.nombre || n.titulo || 'Vacante', sub: (p?.cargo_id && store.valores.get(p.cargo_id)?.valor) || n.titulo || '',
    rol: p ? ROLES[p.rol] || p.rol : '' };
}
const hijos = id => estado.nodos.filter(n => n.padre_id === id);
const padreValido = n => n.padre_id && estado.nodos.some(x => x.id === n.padre_id);

function pintar() {
  if (!estado) return;
  const { lienzo, svg, editable } = estado;
  lienzo.querySelectorAll('.org-nodo').forEach(x => x.remove());
  if (!estado.nodos.length) {
    lienzo.style.width = '100%'; lienzo.style.height = '120px';
    svg.innerHTML = '';
    lienzo.insertAdjacentHTML('beforeend', `<div class="org-nodo org-vacio">Aún no hay organigrama.${editable ? ' Use "⚡ Generar desde usuarios" o "＋ Unidad".' : ''}</div>`);
    return;
  }
  for (const n of estado.nodos) {
    const t = textoNodo(n);
    const el = html(`<div class="org-nodo org-${n.tipo}" data-id="${n.id}" style="left:${n.x}px;top:${n.y}px;width:${ANCHO}px;height:${ALTO}px">
      ${editable ? `<div class="org-acciones"><button data-t="editar" title="Editar">✎</button><button data-t="hijo" title="Agregar debajo">＋</button><button data-t="borrar" title="Quitar">🗑</button></div>` : ''}
      <div class="org-ico">${n.tipo === 'unidad' ? '🏢' : '👤'}</div>
      <div class="org-tit">${esc(t.titulo)}</div><div class="org-sub">${esc(t.sub)}</div>${t.rol ? `<div class="org-rol">${esc(t.rol)}</div>` : ''}</div>`);
    if (editable) arrastrarNodo(el, n);
    lienzo.append(el);
  }
  dimensionar();
  lineas();
}

function limites() {
  const xs = estado.nodos.map(n => Number(n.x)), ys = estado.nodos.map(n => Number(n.y));
  return { w: Math.max(...xs) + ANCHO + 40, h: Math.max(...ys) + ALTO + 40 };
}
function dimensionar() {
  const { w, h } = limites();
  Object.assign(estado.lienzo.style, { width: w + 'px', height: h + 'px', transform: `scale(${estado.escala})` });
  estado.svg.setAttribute('width', w); estado.svg.setAttribute('height', h);
}

function lineas() {
  const porId = new Map(estado.nodos.map(n => [n.id, n]));
  estado.svg.innerHTML = estado.nodos.filter(padreValido).map(n => {
    const p = porId.get(n.padre_id);
    const x1 = Number(p.x) + ANCHO / 2, y1 = Number(p.y) + ALTO, x2 = Number(n.x) + ANCHO / 2, y2 = Number(n.y);
    const my = (y1 + y2) / 2;
    return `<path d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}" />`;
  }).join('');
}

function arrastrarNodo(el, n) {
  el.addEventListener('mousedown', e => {
    if (e.button !== 0 || e.target.closest('button')) return;
    const x0 = e.clientX, y0 = e.clientY, nx = Number(n.x), ny = Number(n.y);
    let movido = false;
    estado.arrastrando = true;
    el.classList.add('moviendo');
    const mover = ev => {
      const dx = (ev.clientX - x0) / estado.escala, dy = (ev.clientY - y0) / estado.escala;
      if (Math.abs(dx) + Math.abs(dy) > 3) movido = true;
      n.x = Math.max(0, Math.round(nx + dx)); n.y = Math.max(0, Math.round(ny + dy));
      el.style.left = n.x + 'px'; el.style.top = n.y + 'px';
      lineas();
    };
    const soltar = async () => {
      document.removeEventListener('mousemove', mover); document.removeEventListener('mouseup', soltar);
      el.classList.remove('moviendo');
      estado.arrastrando = false;
      if (!movido) return;
      dimensionar();
      try { await api.update('organigrama_nodos', n.id, { x: n.x, y: n.y }); } catch (err) { error(mensajeError(err)); }
    };
    document.addEventListener('mousemove', mover); document.addEventListener('mouseup', soltar);
    e.preventDefault();
  });
}

/** Ordena el árbol: cada nodo queda centrado sobre sus dependientes. guardar=true graba las posiciones. */
async function organizar(guardar) {
  const nodos = estado.nodos;
  const raices = nodos.filter(n => !padreValido(n));
  const ancho = new Map();
  const medir = n => { const h = hijos(n.id); const w = h.length ? h.reduce((s, x) => s + medir(x), 0) : 1; ancho.set(n.id, w); return w; };
  raices.forEach(medir);
  let cursor = 0;
  const ubicar = (n, inicio, nivel) => {
    const w = ancho.get(n.id);
    n.x = Math.round(20 + (inicio + w / 2) * (ANCHO + SEP_X) - (ANCHO + SEP_X) / 2);
    n.y = 20 + nivel * (ALTO + SEP_Y);
    let ini = inicio;
    for (const h of hijos(n.id)) { ubicar(h, ini, nivel + 1); ini += ancho.get(h.id); }
  };
  for (const r of raices) { ubicar(r, cursor, 0); cursor += ancho.get(r.id); }
  if (guardar && estado.editable) {
    try { for (const n of nodos) await api.update('organigrama_nodos', n.id, { x: n.x, y: n.y }); } catch (e) { error(mensajeError(e)); }
  }
  pintar();
}

function ajustar() {
  if (!estado?.nodos.length) return;
  const { w, h } = limites();
  const vw = estado.vista.clientWidth - 10, vh = Math.max(300, estado.vista.clientHeight - 10);
  estado.escala = Math.min(1, vw / w, vh / h);
  dimensionar();
}

function opcionesPadre(excluir) {
  // No se puede colgar un nodo de sí mismo ni de sus dependientes
  const prohibidos = new Set();
  const marcar = id => { prohibidos.add(id); hijos(id).forEach(h => marcar(h.id)); };
  if (excluir) marcar(excluir);
  return [{ value: '', label: '— Ninguno (nivel superior) —' },
    ...estado.nodos.filter(n => !prohibidos.has(n.id)).map(n => ({ value: n.id, label: `${n.tipo === 'unidad' ? '🏢' : '👤'} ${textoNodo(n).titulo}` }))];
}

async function formulario(n) {
  const nuevo = !n.id;
  const usados = new Set(estado.nodos.filter(x => x.usuario_id && x.id !== n.id).map(x => x.usuario_id));
  const personas = store.perfiles.filter(p => p.activo && !p.eliminado && !['consulta', 'pendiente'].includes(p.rol) && !usados.has(p.id))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
  const campos = n.tipo === 'unidad'
    ? [{ name: 'titulo', label: 'Nombre de la unidad', required: true, full: true, placeholder: 'Ej.: Gerencia Técnica, BIM, Geotecnia' }]
    : [{ name: 'usuario_id', label: 'Persona', type: 'select', full: true, options: [{ value: '', label: '— Sin usuario (vacante) —' }, ...personas.map(p => ({ value: p.id, label: p.nombre }))] },
      { name: 'titulo', label: 'Texto (si no hay usuario o para precisar el puesto)', full: true, placeholder: 'Ej.: Vacante — Ingeniero BIM' }];
  campos.push({ name: 'padre_id', label: 'Depende de', type: 'select', full: true, options: opcionesPadre(n.id) });
  await pedirDatos({
    titulo: `${nuevo ? 'Agregar' : 'Editar'} ${n.tipo === 'unidad' ? 'unidad' : 'persona'}`, texto: nuevo ? 'Agregar' : 'Guardar',
    valores: { titulo: n.titulo || '', usuario_id: n.usuario_id || '', padre_id: n.padre_id || '' }, campos,
    alGuardar: async d => {
      const datos = { tipo: n.tipo, titulo: d.titulo || null, usuario_id: d.usuario_id || null, padre_id: d.padre_id || null };
      if (n.tipo === 'persona' && !datos.usuario_id && !datos.titulo) throw new Error('Elija una persona o escriba un texto (p. ej. "Vacante").');
      if (nuevo) {
        const p = estado.nodos.find(x => x.id === datos.padre_id);
        const her = estado.nodos.filter(x => x.padre_id === datos.padre_id);
        await api.insert('organigrama_nodos', { ...datos, area_id: store.area.id, orden: her.length,
          x: p ? Number(p.x) + her.length * (ANCHO + SEP_X) : 20 + estado.nodos.length * 30, y: p ? Number(p.y) + ALTO + SEP_Y : 20 });
      } else await api.update('organigrama_nodos', n.id, datos);
      ok(nuevo ? 'Agregado al organigrama.' : 'Organigrama actualizado.');
      await cargar();
    },
  });
}

async function borrar(n) {
  if (!await confirmar(`¿Quitar "${textoNodo(n).titulo}" del organigrama? Sus dependientes pasarán a depender de su jefe. El usuario no se elimina.`,
    { titulo: 'Quitar del organigrama', texto: 'Quitar', peligro: true })) return;
  try {
    for (const h of hijos(n.id)) await api.update('organigrama_nodos', h.id, { padre_id: n.padre_id || null });
    await api.remove('organigrama_nodos', n.id);
    await cargar();
  } catch (e) { error(mensajeError(e)); }
}

/** Crea la unidad del área (si no hay) y agrega a cada persona del equipo que aún no está. */
async function generarDesdeUsuarios() {
  const enOrg = new Set(estado.nodos.map(n => n.usuario_id).filter(Boolean));
  const faltan = store.perfiles.filter(p => p.activo && !p.eliminado && !['consulta', 'pendiente'].includes(p.rol) && !enOrg.has(p.id));
  if (!faltan.length) return ok('Todas las personas del equipo ya están en el organigrama.');
  if (!await confirmar(`Se agregarán ${faltan.length} persona(s) al organigrama: los administradores bajo la unidad del área y el resto bajo el administrador principal. Luego puede moverlas o cambiar de quién dependen.`,
    { titulo: 'Generar desde usuarios', texto: 'Generar' })) return;
  try {
    let raiz = estado.nodos.find(n => n.tipo === 'unidad' && !padreValido(n));
    if (!raiz) [raiz] = await api.insert('organigrama_nodos', { area_id: store.area.id, tipo: 'unidad', titulo: store.area.nombre || 'Gerencia Técnica', x: 20, y: 20 });
    const jerarquia = p => (p.es_admin_principal ? 0 : p.rol === 'superadmin' ? 1 : p.rol === 'admin' ? 2 : p.rol === 'delegado' ? 3 : 4 + PLANIFICADORES.indexOf(p.rol));
    const orden = faltan.sort((a, b) => jerarquia(a) - jerarquia(b) || a.nombre.localeCompare(b.nombre));
    let jefe = estado.nodos.find(n => perfil(n.usuario_id)?.es_admin_principal);
    for (const p of orden) {
      const esAdmin = ['superadmin', 'admin'].includes(p.rol);
      const [nodo] = await api.insert('organigrama_nodos', { area_id: store.area.id, tipo: 'persona', usuario_id: p.id,
        padre_id: esAdmin || !jefe ? raiz.id : jefe.id });
      if (p.es_admin_principal && !jefe) jefe = nodo;
    }
    estado.nodos = await api.list('organigrama_nodos', { eq: { area_id: store.area.id }, order: [['orden', true], ['created_at', true]] });
    await organizar(true);
    ok(`${faltan.length} persona(s) agregadas al organigrama.`);
  } catch (e) { error(mensajeError(e)); }
}

function imprimir() {
  if (!estado?.nodos.length) return;
  imprimirPDF('Organigrama del equipo', organigramaSVG(estado.nodos),
    { proyectoTexto: store.area.nombre || 'Todos los proyectos', orientacion: 'landscape' });
}

// ---------- Versión para PDF y reportes ----------
// El organigrama se dibuja como una imagen vectorial (SVG) con las mismas posiciones, tarjetas y líneas que en
// pantalla: se ve igual en la vista previa y en el PDF, y se escala para ocupar el ancho de la hoja.
function partir(texto, max) {
  const palabras = String(texto || '').split(/\s+/).filter(Boolean), lineas = [];
  let l = '';
  for (const p of palabras) {
    if ((l + ' ' + p).trim().length > max && l) { lineas.push(l); l = p; } else l = (l + ' ' + p).trim();
  }
  if (l) lineas.push(l);
  return lineas.length > 3 ? [...lineas.slice(0, 2), lineas.slice(2).join(' ').slice(0, max - 1) + '…'] : lineas;
}

export function organigramaSVG(nodos) {
  const validos = nodos.filter(n => n.x != null && n.y != null);
  if (!validos.length) return '<p class="nota">Aún no hay organigrama.</p>';
  const porId = new Map(validos.map(n => [n.id, n]));
  const nHijos = id => validos.filter(n => n.padre_id === id).length;
  const minX = Math.min(...validos.map(n => Number(n.x))), minY = Math.min(...validos.map(n => Number(n.y)));
  const w = Math.max(...validos.map(n => Number(n.x))) - minX + ANCHO + 20, h = Math.max(...validos.map(n => Number(n.y))) - minY + ALTO + 20;
  const X = n => Number(n.x) - minX + 10, Y = n => Number(n.y) - minY + 10;
  const lineasSVG = validos.filter(n => n.padre_id && porId.has(n.padre_id)).map(n => {
    const p = porId.get(n.padre_id);
    const x1 = X(p) + ANCHO / 2, y1 = Y(p) + ALTO, x2 = X(n) + ANCHO / 2, y2 = Y(n), my = (y1 + y2) / 2;
    return `<path d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}" fill="none" stroke="#A0AEC0" stroke-width="1.5"/>`;
  }).join('');
  const tarjetas = validos.map(n => {
    const p = n.tipo === 'persona' ? store.perfiles.find(x => x.id === n.usuario_id) : null;
    const titulo = n.tipo === 'unidad' ? (n.titulo || 'Unidad') : (p?.nombre || n.titulo || 'Vacante');
    const sub = n.tipo === 'unidad' ? `${nHijos(n.id)} dependiente(s)` : ((p?.cargo_id && store.valores.get(p.cargo_id)?.valor) || n.titulo || '');
    const rol = p ? ROLES[p.rol] || p.rol : '';
    const [borde, fondo, color] = n.tipo === 'unidad' ? ['#2B6CB0', '#EBF4FF', '#2B6CB0'] : ['#2F855A', '#F0FFF4', '#22543D'];
    const lt = partir(titulo, 26), ls = partir(sub, 34);
    let y = Y(n) + 22;
    const txt = (t, size, peso, col) => { const e = `<text x="${X(n) + ANCHO / 2}" y="${y}" text-anchor="middle" font-size="${size}" font-weight="${peso}" fill="${col}">${esc(t)}</text>`; y += size + 2; return e; };
    return `<rect x="${X(n)}" y="${Y(n)}" width="${ANCHO}" height="${ALTO}" rx="10" fill="${fondo}" stroke="${borde}" stroke-width="2"/>
      ${txt(n.tipo === 'unidad' ? '🏢' : '👤', 12, 400, color)}${lt.map(t => txt(t, 11, 700, color)).join('')}${ls.map(t => txt(t, 9, 400, '#4A5568')).join('')}${rol ? txt(rol, 8.5, 400, '#718096') : ''}`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="max-height:170mm;font-family:Manrope,Arial,sans-serif" preserveAspectRatio="xMidYMin meet">${lineasSVG}${tarjetas}</svg>`;
}

/** Usuarios y roles: misma tabla que la pantalla (columnas y anchos) y el organigrama. */
export function informeEquipo(nodos) {
  const personas = store.perfiles.filter(p => !p.eliminado).sort((a, b) => a.nombre.localeCompare(b.nombre));
  return tablaPDF([
    { titulo: 'Nombre', ancho: 140, html: true, valor: p => `<b>${esc(p.nombre)}</b>${p.es_admin_principal ? ' <span class="badge" style="--c:#E8762B">Principal</span>' : ''}` },
    { titulo: 'Código', ancho: 70, valor: p => p.codigo || '' },
    { titulo: 'Cargo', ancho: 220, valor: p => (p.cargo_id ? store.valores.get(p.cargo_id)?.valor || '' : '') },
    { titulo: 'Correo', ancho: 165, valor: p => p.email || '' },
    { titulo: 'Rol', ancho: 150, html: true, valor: p => `<span class="badge" style="--c:${COLOR_ROL[p.rol] || '#4E79A7'}">${esc(ROLES[p.rol] || p.rol)}</span>` },
    { titulo: 'Gerencias (consulta)', ancho: 230, valor: p => (p.gerencia_ids || []).map(g => store.valores.get(g)?.codigo || '').join(', ') },
    { titulo: 'H/día', ancho: 50, num: true, valor: p => p.horas_dia ?? '—' },
    { titulo: 'Estado', ancho: 60, valor: p => (p.activo ? 'Activo' : 'Inactivo') },
  ], personas) + '<h2>Organigrama del equipo</h2>' + organigramaSVG(nodos);
}

