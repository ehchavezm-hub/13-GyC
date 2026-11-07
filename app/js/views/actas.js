// Acta de reunión (w1): «Nueva acta» y «Log de reuniones» del proyecto seleccionado, y el editor de cada acta:
//   · Datos generales (proyecto, tipo, asunto, código, N° de reunión, fecha, hora, duración, lugar)
//   · Asistentes: se registran desde su teléfono con el QR del acta (DNI, nombres, apellidos, cargo, empresa y firma)
//   · Acuerdos: ítem, acuerdo, responsable, fin programado y estado (Abierto / Cerrado / Informativo)
//   · PDF «Acta de acuerdos» con el mismo formato que las actas anteriores
// Editan el acta el administrador del proyecto y las personas que él designe (redactores); los demás la consultan.
import { api, mensajeError } from '../data/api.js';
import { store, on, haySeleccion, proyecto, esAdminProyecto, lideresHeredados, nombreSeleccion } from '../core/store.js';
import { esc, html, fmtFecha, hoy, libQR, libExcel, normalizar } from '../core/util.js';
import { ok, error as mostrarError, pedirDatos, confirmar, crearFormulario, modal } from '../ui/ui.js';

const ESTADOS_ACUERDO = ['Abierto', 'Cerrado', 'Informativo'];
const REFRESCO_MS = 5000;   // con la asistencia abierta, la lista de asistentes se actualiza sola
let vista = null;

export function destruir() {
  if (vista) { clearInterval(vista.reloj); vista.desuscribir?.(); }
  vista = null;
}

export async function render(el, params = {}) {
  destruir();
  vista = { el, reloj: null, desuscribir: on('proyecto', () => { if (!params.id) render(el, params); }) };
  el.innerHTML = '<div class="cargando"><span class="spinner"></span> Cargando…</div>';
  try {
    if (params.id) await editor(el, params.id);
    else await principal(el, params.query || {});
  } catch (e) {
    el.innerHTML = `<div class="aviso-vacio"><p>${esc(mensajeError(e))}</p></div>`;
  }
}

// Miembros del proyecto con su nombre (para responsables y redactores)
function miembros(proyId) {
  const ids = new Set(lideresHeredados(proyId));
  return store.perfiles.filter(u => ids.has(u.id) && u.activo !== false && !u.eliminado).sort((a, b) => a.nombre.localeCompare(b.nombre));
}
const corto = n => { const [a, ...r] = String(n || '').trim().split(/\s+/); return r.length ? `${a[0]}. ${r[0]}` : (a || ''); };

// ── Pantalla principal: Nueva acta · Log de reuniones ─────────────────────────

async function principal(el, query) {
  const p = store.proyectoSel && proyecto(store.proyectoSel);
  if (!haySeleccion() || !p) {
    el.innerHTML = '<div class="aviso-vacio"><p>Selecciona un proyecto en el menú para ver sus actas de reunión.</p></div>';
    return;
  }
  const actas = await api.list('actas', { eq: { proyecto_id: p.id }, order: [['numero', false]] });
  const ids = actas.map(a => a.id);
  const [asis, acu] = ids.length ? await Promise.all([
    api.list('acta_asistentes', { in: { acta_id: ids }, select: 'acta_id' }),
    api.list('acta_acuerdos', { in: { acta_id: ids }, select: 'acta_id,estado' }),
  ]) : [[], []];
  const admin = esAdminProyecto(p.id);
  const pedida = typeof query.get === 'function' ? query.get('p') : query.p;   // el enrutador entrega URLSearchParams
  let pestana = pedida || (() => { try { return localStorage.getItem('gyc-actas-pestana'); } catch { return null; } })() || (actas.length ? 'log' : 'nueva');
  if (pestana === 'nueva' && !admin) pestana = 'log';

  el.innerHTML = '';
  const wrap = html(`<div class="actas">
    <div class="pagina-cab"><h1>Acta de reunión</h1><span class="proy-badge">${esc(p.codigo)} · ${esc(p.nombre_corto)}</span>
      <span class="flex"></span>
      ${admin ? '<button class="btn" data-a="importar" title="Cargar actas, asistentes y acuerdos desde Excel (formato de «Exportar Excel»)">⬆ Importar Excel</button>' : ''}
      <button class="btn" data-a="exportar">⬇ Exportar Excel</button>
      <button class="btn" data-a="pdf">⬇ PDF</button></div>
    <div class="pestanas pestanas-la" role="tablist">
      <button role="tab" data-p="nueva" class="${pestana === 'nueva' ? 'activo' : ''}">＋ Nueva acta</button>
      <button role="tab" data-p="log" class="${pestana === 'log' ? 'activo' : ''}">Log de reuniones (${actas.length})</button>
    </div>
    <div data-cuerpo></div></div>`);
  el.append(wrap);
  const cuerpo = wrap.querySelector('[data-cuerpo]');
  const pintar = () => {
    wrap.querySelectorAll('[data-p]').forEach(b => b.classList.toggle('activo', b.dataset.p === pestana));
    cuerpo.innerHTML = '';
    if (pestana === 'nueva') nuevaActa(cuerpo, p, actas, admin);
    else logActas(cuerpo, actas, asis, acu);
  };
  // Las tres opciones sirven en las dos pestañas: en «Log» trabajan con todas las actas; en «Nueva acta», con el formato en blanco
  const recargar = () => render(vista?.el || cuerpo.closest('#contenido') || cuerpo, { query: new URLSearchParams({ p: pestana }) });
  // En «Log» primero se eligen las actas (todas o algunas)
  const conSeleccion = async (titulo, fn) => { const sel = await elegirActas(actas, titulo); if (sel) await fn(p, sel); };
  wrap.querySelector('[data-a="exportar"]').onclick = () => (pestana === 'nueva' ? exportarFormato(p, actas) : conSeleccion('Exportar a Excel', exportarActas)).catch(er => mostrarError(mensajeError(er)));
  wrap.querySelector('[data-a="pdf"]').onclick = () => (pestana === 'nueva' ? pdfEnBlanco(p, actas) : conSeleccion('PDF del log de reuniones', pdfLog)).catch(er => mostrarError(mensajeError(er)));
  wrap.querySelector('[data-a="importar"]')?.addEventListener('click', () => importarActas(p, actas).then(hecho => { if (hecho) recargar(); }).catch(er => mostrarError(mensajeError(er))));
  wrap.querySelector('[role="tablist"]').addEventListener('click', e => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    pestana = b.dataset.p;
    try { localStorage.setItem('gyc-actas-pestana', pestana); } catch { /* opcional */ }
    pintar();
  });
  pintar();
}

function camposDatos(p, actas, { conRedactores }) {
  const tipos = [...new Set(actas.map(a => a.tipo).filter(Boolean))];
  return [
    { name: 'numero', label: 'N° de reunión', type: 'number', min: 1, step: 1, required: true },
    { name: 'tipo', label: 'Tipo', placeholder: 'p. ej. Coordinación, Kick off, Innovación', list: 'actas-tipos', _tipos: tipos },
    { name: 'asunto', label: 'Asunto', required: true, full: true },
    { name: 'codigo', label: 'Código', placeholder: 'p. ej. OT-HAZ-01' },
    { name: 'lugar', label: 'Lugar', placeholder: 'Sala, obra o reunión virtual' },
    { name: 'fecha', label: 'Fecha', type: 'date', required: true },
    { name: 'hora', label: 'Hora', type: 'time' },
    { name: 'duracion', label: 'Duración', placeholder: '1:00' },
    ...(conRedactores ? [{ name: 'redactores', label: 'Designados para registrar el acta (además del administrador)', type: 'multiselect', unaColumna: true,
      options: miembros(p.id).filter(u => !esAdminDe(u.id, p)).map(u => ({ value: u.id, label: u.nombre, nota: u.email || '' })) }] : []),
  ];
}
// ¿El usuario u administra el proyecto p? (para no ofrecerlo como redactor: ya edita)
function esAdminDe(uid, p) {
  const ids = [p.id, p.padre_id].filter(Boolean);
  return store.proyectoLideres.some(l => ids.includes(l.proyecto_id) && l.usuario_id === uid && l.rol === 'administrador');
}
const datalistTipos = campos => { const c = campos.find(x => x._tipos); return c ? `<datalist id="actas-tipos">${c._tipos.map(t => `<option value="${esc(t)}">`).join('')}</datalist>` : ''; };

function nuevaActa(cuerpo, p, actas, admin) {
  if (!admin) {
    cuerpo.append(html('<div class="tarjeta"><p class="nota">Solo el administrador del proyecto crea actas. Las que le designen aparecen en el Log de reuniones.</p></div>'));
    return;
  }
  const campos = camposDatos(p, actas, { conRedactores: true });
  const siguiente = Math.max(0, ...actas.map(a => a.numero)) + 1;
  const form = crearFormulario(campos, { numero: siguiente, fecha: hoy(), redactores: [] });
  const tarjeta = html(`<div class="tarjeta"><h2 style="margin:0 0 4px">Datos generales</h2>
    <p class="nota" style="margin:0 0 10px">Después de crear el acta podrá mostrar el QR para que los asistentes registren su asistencia y registrar los acuerdos.</p>
    ${datalistTipos(campos)}</div>`);
  tarjeta.append(form);
  const pie = html('<div class="acta-pie"><button class="btn btn-primario" data-crear>Crear acta</button></div>');
  tarjeta.append(pie);
  cuerpo.append(tarjeta);
  pie.querySelector('[data-crear]').onclick = async e => {
    const err = form.validar();
    if (err) return mostrarError(err);
    const d = form.leer();
    if (actas.some(a => a.numero === Number(d.numero))) return mostrarError(`Ya existe la reunión N° ${d.numero} en este proyecto.`);
    e.currentTarget.disabled = true;
    try {
      const [nueva] = await api.insert('actas', { proyecto_id: p.id, numero: Number(d.numero), tipo: d.tipo, asunto: d.asunto, codigo: d.codigo,
        lugar: d.lugar, fecha: d.fecha, hora: d.hora, duracion: d.duracion, redactores: d.redactores || [] });
      ok(`Acta N° ${nueva.numero} creada.`);
      location.hash = `#/actas/${nueva.id}`;
    } catch (er) { mostrarError(mensajeError(er)); e.currentTarget.disabled = false; }
  };
}

function logActas(cuerpo, actas, asis, acu) {
  if (!actas.length) { cuerpo.append(html('<div class="tarjeta"><p class="nota">Aún no hay actas de reunión en este proyecto.</p></div>')); return; }
  const n = (lista, id, f = () => true) => lista.filter(x => x.acta_id === id && f(x)).length;
  const t = html(`<div class="tarjeta admin-tabla-wrap"><table class="simple acta-log"><thead><tr>
      <th>N°</th><th>Fecha</th><th>Tipo</th><th>Asunto</th><th>Código</th><th class="num">Asistentes</th><th class="num">Acuerdos abiertos</th><th>Estado</th><th></th></tr></thead>
    <tbody>${actas.map(a => `<tr data-id="${a.id}">
      <td><b>${a.numero}</b></td><td>${fmtFecha(a.fecha)}${a.hora ? ` <span class="nota">${esc(String(a.hora).slice(0, 5))}</span>` : ''}</td>
      <td>${esc(a.tipo || '')}</td><td>${esc(a.asunto)}</td><td>${esc(a.codigo || '')}</td>
      <td class="num">${n(asis, a.id)}</td><td class="num">${n(acu, a.id, x => x.estado === 'Abierto')} / ${n(acu, a.id)}</td>
      <td>${a.estado === 'cerrada' ? '<span class="badge" style="--c:var(--verde)">Cerrada</span>' : a.asistencia_abierta
        ? '<span class="badge" style="--c:var(--naranja)">Asistencia abierta</span>' : '<span class="badge" style="--c:var(--azul)">En registro</span>'}</td>
      <td class="acta-acc"><a class="btn btn-sm" href="#/actas/${a.id}">Abrir</a></td></tr>`).join('')}</tbody></table></div>`);
  cuerpo.append(t);
  t.querySelector('tbody').addEventListener('dblclick', e => { const id = e.target.closest('[data-id]')?.dataset.id; if (id) location.hash = `#/actas/${id}`; });
}

// ── Editor del acta ───────────────────────────────────────────────────────────

async function editor(el, id) {
  const [acta] = await api.list('actas', { eq: { id } });
  if (!acta) throw new Error('El acta no existe o no tiene acceso a ella.');
  const p = proyecto(acta.proyecto_id) || { id: acta.proyecto_id, codigo: '', nombre_corto: '' };
  const [asistentes, acuerdos] = await Promise.all([
    api.list('acta_asistentes', { eq: { acta_id: id }, order: [['registrado_en', true]] }),
    api.list('acta_acuerdos', { eq: { acta_id: id }, order: [['item', true]] }),
  ]);
  const admin = esAdminProyecto(p.id);
  const redactor = (acta.redactores || []).includes(store.usuario.id);
  const cerrada = acta.estado === 'cerrada';
  const editable = (admin || redactor) && !cerrada;
  const gente = miembros(p.id);
  const e = { acta, p, asistentes, acuerdos, admin, editable, gente };

  el.innerHTML = '';
  const wrap = html(`<div class="actas">
    <div class="pagina-cab"><h1>Acta de reunión N° ${acta.numero}</h1><span class="proy-badge">${esc(p.codigo)} · ${esc(p.nombre_corto)}</span>
      ${cerrada ? '<span class="badge" style="--c:var(--verde)">Cerrada</span>' : ''}
      <span class="flex"></span>
      <a class="btn" href="#/actas?p=log">← Log de reuniones</a>
      <button class="btn" data-a="pdf">⬇ PDF</button>
      ${admin ? `<button class="btn ${cerrada ? '' : 'btn-primario'}" data-a="estado">${cerrada ? 'Reabrir acta' : 'Cerrar acta'}</button>` : ''}
    </div>
    <div class="tarjeta" data-datos></div>
    <div class="tarjeta" data-asistentes></div>
    <div class="tarjeta" data-acuerdos></div></div>`);
  el.append(wrap);
  pintarDatos(wrap.querySelector('[data-datos]'), e);
  pintarAsistentes(wrap.querySelector('[data-asistentes]'), e);
  pintarAcuerdos(wrap.querySelector('[data-acuerdos]'), e);
  wrap.querySelector('[data-a="pdf"]').onclick = () => pdfActa(e).catch(er => mostrarError(mensajeError(er)));
  wrap.querySelector('[data-a="estado"]')?.addEventListener('click', async () => {
    const cerrar = !cerrada;
    if (cerrar && !await confirmar('Al cerrar el acta se cierra también el registro de asistencia y ya no se pueden cambiar asistentes ni acuerdos (el administrador puede reabrirla).', { titulo: 'Cerrar acta', texto: 'Cerrar acta' })) return;
    try {
      await api.update('actas', acta.id, cerrar ? { estado: 'cerrada', asistencia_abierta: false } : { estado: 'borrador' });
      ok(cerrar ? 'Acta cerrada.' : 'Acta reabierta.');
      render(el, { id });
    } catch (er) { mostrarError(mensajeError(er)); }
  });
}

function pintarDatos(caja, e) {
  const { acta, p } = e;
  const red = (acta.redactores || []).map(uid => store.perfiles.find(u => u.id === uid)?.nombre).filter(Boolean);
  const filas = [['Proyecto', `${p.codigo} · ${p.nombre_completo || p.nombre_corto}`], ['Tipo', acta.tipo], ['Asunto', acta.asunto], ['Código', acta.codigo],
    ['N° de reunión', acta.numero], ['Fecha', fmtFecha(acta.fecha)], ['Hora', acta.hora ? String(acta.hora).slice(0, 5) : ''], ['Duración', acta.duracion],
    ['Lugar', acta.lugar], ['Registran el acta', ['Administrador del proyecto', ...red].join(', ')]];
  caja.innerHTML = `<div class="acta-sec-cab"><h2>Datos generales</h2><span class="flex"></span>${e.editable ? '<button class="btn btn-sm" data-editar>✎ Editar</button>' : ''}</div>
    <table class="simple acta-datos"><tbody>${filas.map(([k, v], i) => `<tr><td class="num" style="width:32px">${i + 1}</td><th>${esc(k)}</th><td>${esc(v ?? '') || '—'}</td></tr>`).join('')}</tbody></table>`;
  caja.querySelector('[data-editar]')?.addEventListener('click', async () => {
    const actas = await api.list('actas', { eq: { proyecto_id: p.id }, select: 'id,numero,tipo' });
    const campos = camposDatos(p, actas, { conRedactores: e.admin });
    const d = await pedirDatos({
      titulo: `Acta N° ${acta.numero} · datos generales`, campos, ancho: 680,
      antes: datalistTipos(campos) || undefined,
      valores: { ...acta, hora: acta.hora ? String(acta.hora).slice(0, 5) : '' },
      alGuardar: async v => {
        if (actas.some(a => a.id !== acta.id && a.numero === Number(v.numero))) throw new Error(`Ya existe la reunión N° ${v.numero} en este proyecto.`);
        const cambios = { numero: Number(v.numero), tipo: v.tipo, asunto: v.asunto, codigo: v.codigo, lugar: v.lugar, fecha: v.fecha, hora: v.hora, duracion: v.duracion };
        if (e.admin) cambios.redactores = v.redactores || [];
        try { Object.assign(acta, await api.update('actas', acta.id, cambios)); } catch (er) { throw new Error(mensajeError(er)); }
      },
    });
    if (d) { ok('Datos generales guardados.'); pintarDatos(caja, e); document.querySelector('.actas h1').textContent = `Acta de reunión N° ${acta.numero}`; }
  });
}

// ── Asistentes y QR ───────────────────────────────────────────────────────────

const enlaceAsistencia = acta => `${location.origin}${location.pathname.replace(/[^/]*$/, '')}asistencia.html?t=${acta.token_asistencia}`;

async function svgQR(texto, celda = 5) {
  const qrcode = await libQR();
  const qr = qrcode(0, 'M');
  qr.addData(texto);
  qr.make();
  return qr.createSvgTag({ cellSize: celda, margin: 2, scalable: true });
}

function pintarAsistentes(caja, e) {
  const { acta } = e;
  const abierta = acta.asistencia_abierta && acta.estado !== 'cerrada';
  caja.innerHTML = `<div class="acta-sec-cab"><h2>Asistentes <span class="nota">(${e.asistentes.length})</span></h2><span class="flex"></span>
      ${e.editable ? `<button class="btn btn-sm" data-manual>＋ Agregar sin QR</button>
        <button class="btn btn-sm ${abierta ? '' : 'btn-primario'}" data-qr>${abierta ? 'Cerrar registro de asistencia' : 'Abrir registro por QR'}</button>` : ''}
      <button class="btn btn-sm" data-refrescar title="Actualizar la lista">↻</button></div>
    ${abierta ? `<div class="acta-qr"><div class="acta-qr-img" data-qrimg></div>
      <div><p style="margin:0 0 6px"><b>Registro de asistencia abierto.</b> Los asistentes escanean el QR con la cámara de su teléfono,
        completan sus datos y firman. La lista se actualiza sola.</p>
        <p class="nota" style="word-break:break-all;margin:0 0 8px">${esc(enlaceAsistencia(acta))}</p>
        <button class="btn btn-sm" data-copiar>Copiar enlace</button> <button class="btn btn-sm" data-grande>Mostrar QR en pantalla completa</button></div></div>` : ''}
    ${e.asistentes.length ? `<div class="admin-tabla-wrap"><table class="simple"><thead><tr><th>IT</th><th>DNI</th><th>Nombres</th><th>Apellidos</th><th>Cargo</th><th>Empresa</th><th>Firma</th>${e.editable ? '<th></th>' : ''}</tr></thead>
      <tbody>${e.asistentes.map((a, i) => `<tr><td>${i + 1}</td><td>${esc(a.dni)}</td><td>${esc(a.nombres)}</td><td>${esc(a.apellidos)}</td><td>${esc(a.cargo || '')}</td><td>${esc(a.empresa || '')}</td>
        <td class="acta-firma">${a.firma && /^data:image\/png;base64,/.test(a.firma) ? `<img src="${a.firma}" alt="Firma de ${esc(a.nombres)}">` : '<span class="nota">sin firma</span>'}</td>
        ${e.editable ? `<td><button class="btn-icono" data-quitar="${a.id}" title="Quitar">✕</button></td>` : ''}</tr>`).join('')}</tbody></table></div>`
      : `<p class="nota">${abierta ? 'Esperando registros…' : 'Aún no hay asistentes registrados.'}</p>`}`;
  if (abierta) {
    svgQR(enlaceAsistencia(acta)).then(svg => { const c = caja.querySelector('[data-qrimg]'); if (c) c.innerHTML = svg; });
    caja.querySelector('[data-copiar]').onclick = async () => { try { await navigator.clipboard.writeText(enlaceAsistencia(acta)); ok('Enlace copiado.'); } catch { mostrarError('No se pudo copiar: selecciónelo y cópielo.'); } };
    caja.querySelector('[data-grande]').onclick = async () => modal({ titulo: `Asistencia · ${acta.asunto}`, ancho: 720,
      cuerpo: `<div class="acta-qr-grande">${await svgQR(enlaceAsistencia(acta), 10)}<p class="nota">Escanee con la cámara del teléfono para registrar su asistencia.</p></div>` });
  }
  // Actualización automática mientras el registro está abierto
  clearInterval(vista?.reloj);
  if (abierta && vista) vista.reloj = setInterval(() => { if (!document.hidden) refrescarAsistentes(caja, e, true); }, REFRESCO_MS);
  caja.querySelector('[data-refrescar]').onclick = () => refrescarAsistentes(caja, e);
  caja.querySelector('[data-qr]')?.addEventListener('click', async ev => {
    ev.currentTarget.disabled = true;
    try {
      Object.assign(acta, await api.update('actas', acta.id, { asistencia_abierta: !abierta }));
      ok(abierta ? 'Registro de asistencia cerrado.' : 'Registro de asistencia abierto: muestre el QR a los asistentes.');
      pintarAsistentes(caja, e);
    } catch (er) { mostrarError(mensajeError(er)); ev.currentTarget.disabled = false; }
  });
  caja.querySelector('[data-manual]')?.addEventListener('click', async () => {
    const d = await pedirDatos({
      titulo: 'Agregar asistente (sin QR)', ancho: 560,
      antes: 'Para quien no pudo registrarse con su teléfono. Queda sin firma digital.',
      campos: [{ name: 'dni', label: 'DNI o documento', required: true }, { name: 'nombres', label: 'Nombres', required: true },
        { name: 'apellidos', label: 'Apellidos', required: true }, { name: 'cargo', label: 'Cargo' }, { name: 'empresa', label: 'Empresa' }],
      alGuardar: async v => {
        if (!/^[A-Za-z0-9-]{4,20}$/.test(String(v.dni || '').trim())) throw new Error('DNI o documento inválido (4 a 20 caracteres, sin espacios).');
        if (e.asistentes.some(a => a.dni === String(v.dni).trim())) throw new Error('Ese DNI ya está registrado en el acta.');
        try { await api.insert('acta_asistentes', { acta_id: acta.id, ...v, dni: String(v.dni).trim() }); } catch (er) { throw new Error(mensajeError(er)); }
      },
    });
    if (d) { ok('Asistente agregado.'); refrescarAsistentes(caja, e); }
  });
  caja.querySelector('tbody')?.addEventListener('click', async ev => {
    const idA = ev.target.closest('[data-quitar]')?.dataset.quitar;
    if (!idA) return;
    const a = e.asistentes.find(x => x.id === idA);
    if (!await confirmar(`¿Quitar a ${a.nombres} ${a.apellidos} del acta?`, { titulo: 'Quitar asistente', texto: 'Quitar', peligro: true })) return;
    try { await api.remove('acta_asistentes', idA); ok('Asistente quitado.'); refrescarAsistentes(caja, e); } catch (er) { mostrarError(mensajeError(er)); }
  });
}

async function refrescarAsistentes(caja, e, silencioso = false) {
  try {
    const lista = await api.list('acta_asistentes', { eq: { acta_id: e.acta.id }, order: [['registrado_en', true]] });
    const cambio = lista.length !== e.asistentes.length || lista.some((a, i) => a.id !== e.asistentes[i]?.id || a.registrado_en !== e.asistentes[i]?.registrado_en);
    e.asistentes = lista;
    if (cambio || !silencioso) {
      // No se repinta el QR si no hace falta (evita parpadeo): solo cuando cambió la lista
      pintarAsistentes(caja, e);
    }
  } catch (er) { if (!silencioso) mostrarError(mensajeError(er)); }
}

// ── Acuerdos ──────────────────────────────────────────────────────────────────

function pintarAcuerdos(caja, e) {
  const nombres = e.gente.map(u => u.nombre);
  caja.innerHTML = `<div class="acta-sec-cab"><h2>Acuerdos <span class="nota">(${e.acuerdos.length})</span></h2><span class="flex"></span>
      ${e.editable ? '<button class="btn btn-sm btn-primario" data-nuevo>＋ Agregar acuerdo</button>' : ''}</div>
    <datalist id="acta-resp">${nombres.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
    ${e.acuerdos.length ? `<div class="admin-tabla-wrap"><table class="simple acta-acuerdos"><thead><tr><th style="width:36px">IT</th><th>Acuerdo</th><th style="width:170px">Resp.</th>
      <th style="width:140px">Fin prog.</th><th style="width:130px">Estado</th>${e.editable ? '<th style="width:36px"></th>' : ''}</tr></thead>
      <tbody>${e.acuerdos.map(a => e.editable ? `<tr data-id="${a.id}"><td>${a.item}</td>
        <td><textarea data-c="acuerdo" rows="2">${esc(a.acuerdo)}</textarea></td>
        <td><input data-c="responsable" list="acta-resp" value="${esc(a.responsable || '')}" placeholder="Nombre"></td>
        <td><input data-c="fin_programado" type="date" value="${esc(a.fin_programado || '')}"></td>
        <td><select data-c="estado">${ESTADOS_ACUERDO.map(s => `<option${s === a.estado ? ' selected' : ''}>${s}</option>`).join('')}</select></td>
        <td><button class="btn-icono" data-quitar="${a.id}" title="Quitar">✕</button></td></tr>`
      : `<tr><td>${a.item}</td><td>${esc(a.acuerdo)}</td><td>${esc(a.responsable || '')}</td><td>${fmtFecha(a.fin_programado)}</td><td>${esc(a.estado)}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="nota">Aún no hay acuerdos registrados.</p>'}`;
  if (!e.editable) return;
  // La caja del acuerdo crece con el texto (sin barra de desplazamiento interna)
  const crecer = ta => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight + 2}px`; };
  caja.querySelectorAll('textarea[data-c="acuerdo"]').forEach(crecer);
  caja.querySelector('tbody')?.addEventListener('input', ev => { if (ev.target.matches('textarea')) crecer(ev.target); });
  caja.querySelector('[data-nuevo]').onclick = async () => {
    try {
      const item = Math.max(0, ...e.acuerdos.map(a => a.item)) + 1;
      const [nuevo] = await api.insert('acta_acuerdos', { acta_id: e.acta.id, item, acuerdo: 'Nuevo acuerdo', estado: 'Abierto', fin_programado: e.acta.fecha });
      e.acuerdos.push(nuevo);
      pintarAcuerdos(caja, e);
      const ta = caja.querySelector(`[data-id="${nuevo.id}"] textarea`); ta?.focus(); ta?.select();
    } catch (er) { mostrarError(mensajeError(er)); }
  };
  // Cada cambio se guarda al salir del campo
  caja.querySelector('tbody')?.addEventListener('change', async ev => {
    const campo = ev.target.dataset.c, fila = ev.target.closest('[data-id]');
    if (!campo || !fila) return;
    const a = e.acuerdos.find(x => x.id === fila.dataset.id);
    let valor = ev.target.value.trim();
    if (campo === 'acuerdo' && !valor) { mostrarError('El acuerdo no puede quedar vacío.'); ev.target.value = a.acuerdo; return; }
    const cambios = { [campo]: valor || null };
    if (campo === 'responsable') cambios.responsable_id = e.gente.find(u => u.nombre === valor)?.id || null;
    try { Object.assign(a, await api.update('acta_acuerdos', a.id, cambios)); fila.classList.add('guardado'); setTimeout(() => fila.classList.remove('guardado'), 900); }
    catch (er) { mostrarError(mensajeError(er)); ev.target.value = a[campo] ?? ''; }
  });
  caja.querySelector('tbody')?.addEventListener('click', async ev => {
    const idA = ev.target.closest('[data-quitar]')?.dataset.quitar;
    if (!idA || !await confirmar('¿Quitar este acuerdo?', { titulo: 'Quitar acuerdo', texto: 'Quitar', peligro: true })) return;
    try {
      await api.remove('acta_acuerdos', idA);
      e.acuerdos = e.acuerdos.filter(a => a.id !== idA);
      // Se renumeran los ítems para que no queden huecos
      for (const [i, a] of e.acuerdos.entries()) if (a.item !== i + 1) Object.assign(a, await api.update('acta_acuerdos', a.id, { item: i + 1 }));
      pintarAcuerdos(caja, e);
    } catch (er) { mostrarError(mensajeError(er)); }
  });
}

// ── PDF «Acta de acuerdos» (mismo formato que las actas anteriores) ──────────

async function pdfActa(e) {
  const { imprimirPDF } = await import('../services/pdf.js');
  const { acta, p } = e;
  // Lo último registrado (alguien pudo firmar recién)
  const [asistentes, acuerdos] = await Promise.all([
    api.list('acta_asistentes', { eq: { acta_id: acta.id }, order: [['registrado_en', true]] }),
    api.list('acta_acuerdos', { eq: { acta_id: acta.id }, order: [['item', true]] }),
  ]);
  const datos = [['Proyecto', `${p.codigo} · ${p.nombre_completo || p.nombre_corto}`], ['Tipo', acta.tipo], ['Asunto', acta.asunto], ['Código', acta.codigo],
    ['N° Reunión', acta.numero], ['Fecha', fmtFecha(acta.fecha)], ['Hora', acta.hora ? String(acta.hora).slice(0, 5) : ''], ['Duración', acta.duracion],
    ...(acta.lugar ? [['Lugar', acta.lugar]] : [])];
  const cuerpo = `<style>
      .acta-pdf h2 { font-size: 10pt; color: #1F77B4; border-bottom: 1.2pt solid #003366; padding-bottom: 1.5mm; margin: 6mm 0 3mm; text-transform: uppercase; }
      .acta-pdf table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      .acta-pdf th, .acta-pdf td { font-size: 8pt; padding: 1.6mm 2mm; border: .5pt solid #E0E0E0; vertical-align: middle; overflow-wrap: normal; word-break: normal; }
      .acta-pdf th { text-align: center; }
      .acta-pdf .datos td:nth-child(2) { font-weight: 700; }
      .acta-pdf .firma img { max-height: 12mm; max-width: 100%; display: block; margin: 0 auto; }
      .acta-pdf .asis td { height: 15mm; }
      .acta-pdf tr { break-inside: avoid; page-break-inside: avoid; }
    </style>
    <div class="acta-pdf">
      <h2>Datos generales</h2>
      <table class="datos"><colgroup><col style="width:10%"><col style="width:30%"><col></colgroup><tbody>
        ${datos.map(([k, v], i) => `<tr><td>${i + 1}</td><td>${esc(k)}</td><td>${esc(v ?? '')}</td></tr>`).join('')}</tbody></table>
      <h2>Asistentes</h2>
      <table class="asis"><colgroup><col style="width:6%"><col style="width:12%"><col style="width:16%"><col style="width:17%"><col style="width:17%"><col style="width:14%"><col style="width:18%"></colgroup>
        <thead><tr><th>IT</th><th>DNI</th><th>Nombres</th><th>Apellidos</th><th>Cargo</th><th>Empresa</th><th>Firma</th></tr></thead>
        <tbody>${asistentes.length ? asistentes.map((a, i) => `<tr><td>${i + 1}</td><td>${esc(a.dni)}</td><td>${esc(a.nombres)}</td><td>${esc(a.apellidos)}</td>
          <td>${esc(a.cargo || '')}</td><td>${esc(a.empresa || '')}</td>
          <td class="firma">${a.firma && /^data:image\/png;base64,/.test(a.firma) ? `<img src="${a.firma}" alt="">` : ''}</td></tr>`).join('')
          : '<tr><td colspan="7" style="text-align:center;color:#555555">Sin asistentes registrados</td></tr>'}</tbody></table>
      <h2>Acuerdos</h2>
      <table class="acu"><colgroup><col style="width:6%"><col><col style="width:14%"><col style="width:13%"><col style="width:12%"></colgroup>
        <thead><tr><th>IT</th><th>Acuerdo</th><th>Resp.</th><th>Fin prog.</th><th>Estado</th></tr></thead>
        <tbody>${acuerdos.length ? acuerdos.map(a => `<tr><td>${a.item}</td><td>${esc(a.acuerdo)}</td><td>${esc(corto(a.responsable))}</td>
          <td>${fmtFecha(a.fin_programado)}</td><td>${esc(a.estado)}</td></tr>`).join('')
          : '<tr><td colspan="5" style="text-align:center;color:#555555">Sin acuerdos registrados</td></tr>'}</tbody></table>
      <h2>Fin de acuerdos</h2>
    </div>`;
  const proy = [p.codigo, p.nombre_corto].filter(Boolean).join(' ') || nombreSeleccion();
  const archivo = `${proy}_Acta de reunión N${acta.numero}_${fmtFecha(acta.fecha).replaceAll('/', '-')}`;
  imprimirPDF('Acta de acuerdos', cuerpo, { orientacion: 'portrait', proyectoTexto: `${p.codigo} · ${p.nombre_corto}`, archivo });
}


// ── Excel y PDF de la pantalla principal (Nueva acta · Log de reuniones) ──────────────────────────
// Formato: hoja «Actas» (una fila por acta), «Asistentes» y «Acuerdos» (ambas con el N° de acta). Lo que exporta
// «Exportar Excel» se vuelve a importar tal cual; desde «Nueva acta» se descarga el mismo formato en blanco.
const CAB_ACTAS = ['N° reunión', 'Tipo', 'Asunto', 'Código', 'Lugar', 'Fecha', 'Hora', 'Duración', 'Estado'];
const CAB_ASIS = ['N° reunión', 'DNI', 'Nombres', 'Apellidos', 'Cargo', 'Empresa', 'Firma'];
const CAB_ACU = ['N° reunión', 'IT', 'Acuerdo', 'Responsable', 'Fin prog.', 'Estado'];
const fechaExcel = v => (v ? new Date(`${String(v).slice(0, 10)}T00:00:00`) : null);
const hoyArchivo = () => fmtFecha(hoy()).replaceAll('/', '-');
const nombreProy = p => [p.codigo, p.nombre_corto].filter(Boolean).join(' ') || nombreSeleccion();

async function libroActas(XLSX, filasActas, filasAsis, filasAcu) {
  const libro = XLSX.utils.book_new();
  const hoja = (cab, filas, anchos) => {
    const h = XLSX.utils.aoa_to_sheet([cab, ...filas], { cellDates: true });
    h['!cols'] = anchos.map(wch => ({ wch }));
    for (const [ref, c] of Object.entries(h)) if (!ref.startsWith('!') && c.t === 'd') c.z = 'dd/mm/yyyy';
    return h;
  };
  XLSX.utils.book_append_sheet(libro, hoja(CAB_ACTAS, filasActas, [11, 18, 44, 14, 20, 12, 8, 10, 11]), 'Actas');
  XLSX.utils.book_append_sheet(libro, hoja(CAB_ASIS, filasAsis, [11, 12, 22, 22, 24, 18, 8]), 'Asistentes');
  XLSX.utils.book_append_sheet(libro, hoja(CAB_ACU, filasAcu, [11, 5, 60, 20, 12, 12]), 'Acuerdos');
  return libro;
}

/** Elige qué actas exportar (todas o algunas). Devuelve las elegidas o null si se cancela. */
async function elegirActas(actas, titulo) {
  if (!actas.length) throw new Error('Aún no hay actas en este proyecto.');
  const orden = [...actas].sort((a, b) => b.numero - a.numero);
  const d = await pedirDatos({
    titulo, texto: 'Continuar', ancho: 680,
    antes: 'Elija las actas que se incluirán.',
    campos: [{ name: 'ids', label: 'Actas', type: 'multiselect', unaColumna: true, todos: true,
      options: orden.map(a => ({ value: a.id, label: `N° ${a.numero} · ${fmtFecha(a.fecha)} · ${a.asunto}`, nota: a.estado === 'cerrada' ? 'Cerrada' : 'En registro' })) }],
    valores: { ids: orden.map(a => a.id) },
    alGuardar: async v => { if (!v.ids?.length) throw new Error('Elija al menos un acta.'); },
  });
  return d ? actas.filter(a => d.ids.includes(a.id)) : null;
}

async function exportarActas(p, actas) {
  if (!actas.length) throw new Error('Aún no hay actas para exportar.');
  const XLSX = await libExcel();
  const ids = actas.map(a => a.id), numero = Object.fromEntries(actas.map(a => [a.id, a.numero]));
  const [asis, acu] = await Promise.all([
    api.list('acta_asistentes', { in: { acta_id: ids }, select: 'acta_id,dni,nombres,apellidos,cargo,empresa,firma,registrado_en', order: [['registrado_en', true]] }),
    api.list('acta_acuerdos', { in: { acta_id: ids }, order: [['item', true]] }),
  ]);
  const orden = [...actas].sort((a, b) => a.numero - b.numero);
  const libro = await libroActas(XLSX,
    orden.map(a => [a.numero, a.tipo, a.asunto, a.codigo, a.lugar, fechaExcel(a.fecha), a.hora ? String(a.hora).slice(0, 5) : null, a.duracion, a.estado === 'cerrada' ? 'Cerrada' : 'En registro']),
    asis.sort((x, y) => numero[x.acta_id] - numero[y.acta_id]).map(a => [numero[a.acta_id], a.dni, a.nombres, a.apellidos, a.cargo, a.empresa, a.firma ? 'Sí' : 'No']),
    acu.sort((x, y) => numero[x.acta_id] - numero[y.acta_id] || x.item - y.item).map(a => [numero[a.acta_id], a.item, a.acuerdo, a.responsable, fechaExcel(a.fin_programado), a.estado]));
  XLSX.writeFile(libro, `${nombreProy(p)}_Actas de reunión_${hoyArchivo()}.xlsx`, { cellDates: true });
  ok(`Exportadas ${actas.length} acta(s) con ${asis.length} asistente(s) y ${acu.length} acuerdo(s). Las firmas quedan en el PDF de cada acta.`);
}

async function exportarFormato(p, actas) {
  const XLSX = await libExcel();
  const n = Math.max(0, ...actas.map(a => a.numero)) + 1;
  const libro = await libroActas(XLSX, [[n, null, null, null, null, fechaExcel(hoy()), null, null, null]],
    [[n, null, null, null, null, null, null]], [[n, 1, null, null, null, 'Abierto']]);
  XLSX.writeFile(libro, `${nombreProy(p)}_Formato de acta de reunión N${n}.xlsx`, { cellDates: true });
  ok('Formato descargado: complételo y cárguelo con «Importar Excel».');
}

// Lectura del Excel
const k = t => normalizar(String(t ?? '')).replace(/[^a-z0-9]/g, '');
function fechaIso(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const m = String(v).trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null;
}
function horaIso(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return `${String(v.getHours()).padStart(2, '0')}:${String(v.getMinutes()).padStart(2, '0')}`;
  if (typeof v === 'number') { const min = Math.round((v % 1) * 1440); return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`; }
  const m = String(v).trim().match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}
function leerHoja(XLSX, libro, nombre, cab) {
  const hoja = libro.SheetNames.find(n => k(n) === k(nombre));
  if (!hoja) return [];
  const filas = XLSX.utils.sheet_to_json(libro.Sheets[hoja], { header: 1, raw: true, defval: null });
  const i0 = filas.findIndex(f => (f || []).some(v => k(v) === k(cab[0])));
  if (i0 < 0) return [];
  const col = Object.fromEntries(filas[i0].map((v, i) => [k(v), i]));
  return filas.slice(i0 + 1).filter(f => (f || []).some(v => v != null && String(v).trim() !== ''))
    .map(f => Object.fromEntries(cab.map(c => [k(c), col[k(c)] != null ? f[col[k(c)]] : null])));
}
const txt = v => (v == null || String(v).trim() === '' ? null : String(v).trim());

async function importarActas(p, actas) {
  const archivo = await new Promise(res => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.xlsx,.xlsm,.xls'; i.onchange = () => res(i.files[0]); i.click(); });
  if (!archivo) return false;
  const XLSX = await libExcel();
  const libro = XLSX.read(await archivo.arrayBuffer(), { type: 'array', cellDates: true });
  const filasActas = leerHoja(XLSX, libro, 'Actas', CAB_ACTAS), filasAsis = leerHoja(XLSX, libro, 'Asistentes', CAB_ASIS), filasAcu = leerHoja(XLSX, libro, 'Acuerdos', CAB_ACU);
  if (!filasActas.length) throw new Error('El archivo no tiene la hoja «Actas» con el formato de «Exportar Excel».');
  const nuevas = [], cambios = [], omitidas = [], errores = [];
  for (const [i, f] of filasActas.entries()) {
    const numero = Number(f.nreunion);
    const datos = { tipo: txt(f.tipo), asunto: txt(f.asunto), codigo: txt(f.codigo), lugar: txt(f.lugar), fecha: fechaIso(f.fecha), hora: horaIso(f.hora), duracion: txt(f.duracion) };
    if (!Number.isInteger(numero) || numero < 1) { errores.push(`Actas, fila ${i + 2}: N° de reunión inválido`); continue; }
    if (!datos.asunto || !datos.fecha) { errores.push(`Actas, N° ${numero}: falta asunto o fecha`); continue; }
    const existe = actas.find(a => a.numero === numero);
    if (existe?.estado === 'cerrada') omitidas.push(numero);
    else (existe ? cambios : nuevas).push({ numero, datos, existe });
  }
  const validas = new Set([...nuevas, ...cambios].map(x => x.numero));
  const ESTADOS = Object.fromEntries(ESTADOS_ACUERDO.map(e => [k(e), e]));
  const acuerdos = filasAcu.filter(f => validas.has(Number(f.nreunion)) && txt(f.acuerdo)).map(f => ({ numero: Number(f.nreunion), item: Number(f.it) || null,
    acuerdo: txt(f.acuerdo), responsable: txt(f.responsable), fin_programado: fechaIso(f.finprog), estado: ESTADOS[k(f.estado)] || 'Abierto' }));
  const asistentes = filasAsis.filter(f => validas.has(Number(f.nreunion)) && txt(f.dni) && txt(f.nombres) && txt(f.apellidos)).map(f => ({ numero: Number(f.nreunion),
    dni: String(f.dni).replace(/\s/g, ''), nombres: txt(f.nombres), apellidos: txt(f.apellidos), cargo: txt(f.cargo), empresa: txt(f.empresa) }));
  const malDni = asistentes.filter(a => !/^[A-Za-z0-9-]{4,20}$/.test(a.dni));
  if (malDni.length) errores.push(`Asistentes con DNI inválido (se omiten): ${malDni.map(a => a.dni).join(', ')}`);
  if (!nuevas.length && !cambios.length) throw new Error(`No hay actas que importar.${omitidas.length ? ` Las actas cerradas no se modifican (N° ${omitidas.join(', ')}).` : ''}${errores.length ? ' ' + errores.join(' · ') : ''}`);
  const si = await confirmar(`Se cargará "${archivo.name}" en ${p.codigo} · ${p.nombre_corto}:
    · ${nuevas.length} acta(s) nueva(s)${nuevas.length ? ` (N° ${nuevas.map(x => x.numero).join(', ')})` : ''}
    · ${cambios.length} acta(s) existente(s) que se actualizan${cambios.length ? ` (N° ${cambios.map(x => x.numero).join(', ')})` : ''}
    · ${acuerdos.length} acuerdo(s): reemplazan a los de cada acta que tenga acuerdos en el archivo
    · ${asistentes.length - malDni.length} asistente(s): se agregan los que no estén (por DNI), sin firma
    ${omitidas.length ? `· Actas cerradas que no se modifican: N° ${omitidas.join(', ')}` : ''}
    ${errores.length ? `· Observaciones: ${errores.join(' · ')}` : ''}
    ¿Continuar?`, { titulo: 'Importar actas de reunión', texto: 'Importar' });
  if (!si) return false;
  const idDe = {};
  for (const x of cambios) { await api.update('actas', x.existe.id, x.datos); idDe[x.numero] = x.existe.id; }
  for (const x of nuevas) { const [a] = await api.insert('actas', { proyecto_id: p.id, numero: x.numero, ...x.datos }); idDe[x.numero] = a.id; }
  for (const n of new Set(acuerdos.map(a => a.numero))) {
    await api.removeWhere('acta_acuerdos', { eq: { acta_id: idDe[n] } });
    await api.insert('acta_acuerdos', acuerdos.filter(a => a.numero === n).map((a, i) => ({ acta_id: idDe[n], item: a.item || i + 1, acuerdo: a.acuerdo,
      responsable: a.responsable, fin_programado: a.fin_programado, estado: a.estado })));
  }
  let agregados = 0;
  for (const n of new Set(asistentes.map(a => a.numero))) {
    const ya = new Set((await api.list('acta_asistentes', { eq: { acta_id: idDe[n] }, select: 'dni' })).map(a => a.dni));
    const filas = asistentes.filter(a => a.numero === n && !ya.has(a.dni) && !malDni.includes(a)).map(({ numero: _n, ...a }) => ({ ...a, acta_id: idDe[n] }));
    if (filas.length) { await api.insert('acta_asistentes', filas); agregados += filas.length; }
  }
  ok(`Importado: ${nuevas.length} acta(s) nueva(s), ${cambios.length} actualizada(s), ${acuerdos.length} acuerdo(s) y ${agregados} asistente(s).`);
  return true;
}

// PDF del log: todas las actas con sus acuerdos
async function pdfLog(p, actas) {
  if (!actas.length) throw new Error('Aún no hay actas para el reporte.');
  const { imprimirPDF } = await import('../services/pdf.js');
  const ids = actas.map(a => a.id);
  const [asis, acu] = await Promise.all([
    api.list('acta_asistentes', { in: { acta_id: ids }, select: 'acta_id' }),
    api.list('acta_acuerdos', { in: { acta_id: ids }, order: [['item', true]] }),
  ]);
  const orden = [...actas].sort((a, b) => a.numero - b.numero);
  const cuenta = (lista, id, f = () => true) => lista.filter(x => x.acta_id === id && f(x)).length;
  const cuerpo = `<style>
      .log-pdf h2 { font-size: 10pt; color: #1F77B4; border-bottom: 1.2pt solid #003366; padding-bottom: 1.5mm; margin: 6mm 0 3mm; }
      .log-pdf h3 { font-size: 9pt; color: #003366; margin: 5mm 0 2mm; }
      .log-pdf table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      .log-pdf th, .log-pdf td { font-size: 7.5pt; padding: 1.4mm 1.8mm; border: .5pt solid #E0E0E0; vertical-align: top; overflow-wrap: normal; }
      .log-pdf th { text-align: left; } .log-pdf .num { text-align: right; } .log-pdf tr { break-inside: avoid; }
    </style><div class="log-pdf">
    <h2>Log de reuniones · ${actas.length} acta${actas.length === 1 ? '' : 's'}</h2>
    <table><colgroup><col style="width:7%"><col style="width:11%"><col style="width:14%"><col><col style="width:11%"><col style="width:10%"><col style="width:12%"><col style="width:10%"></colgroup>
      <tr><th>N°</th><th>Fecha</th><th>Tipo</th><th>Asunto</th><th>Código</th><th class="num">Asistentes</th><th class="num">Acuerdos abiertos</th><th>Estado</th></tr>
      ${orden.map(a => `<tr><td>${a.numero}</td><td>${fmtFecha(a.fecha)}${a.hora ? ` ${esc(String(a.hora).slice(0, 5))}` : ''}</td><td>${esc(a.tipo || '')}</td><td>${esc(a.asunto)}</td>
        <td>${esc(a.codigo || '')}</td><td class="num">${cuenta(asis, a.id)}</td><td class="num">${cuenta(acu, a.id, x => x.estado === 'Abierto')} / ${cuenta(acu, a.id)}</td>
        <td>${a.estado === 'cerrada' ? 'Cerrada' : 'En registro'}</td></tr>`).join('')}</table>
    <h2>Acuerdos por reunión</h2>
    ${orden.map(a => { const lista = acu.filter(x => x.acta_id === a.id); return `<div class="pdf-bloque"><h3>Reunión N° ${a.numero} · ${fmtFecha(a.fecha)} · ${esc(a.asunto)}</h3>
      ${lista.length ? `<table><colgroup><col style="width:6%"><col><col style="width:16%"><col style="width:12%"><col style="width:12%"></colgroup>
        <tr><th>IT</th><th>Acuerdo</th><th>Resp.</th><th>Fin prog.</th><th>Estado</th></tr>
        ${lista.map(x => `<tr><td>${x.item}</td><td>${esc(x.acuerdo)}</td><td>${esc(corto(x.responsable))}</td><td>${fmtFecha(x.fin_programado)}</td><td>${esc(x.estado)}</td></tr>`).join('')}</table>`
        : '<p style="font-size:8pt;color:#555555">Sin acuerdos registrados.</p>'}</div>`; }).join('')}
    </div>`;
  imprimirPDF('Log de reuniones', cuerpo, { orientacion: 'landscape', proyectoTexto: `${p.codigo} · ${p.nombre_corto}`, archivo: `${nombreProy(p)}_Log de reuniones_${hoyArchivo()}` });
}

// PDF en blanco: el acta para llenar y firmar en papel (mismo formato que «Acta de acuerdos»)
async function pdfEnBlanco(p, actas) {
  const { imprimirPDF } = await import('../services/pdf.js');
  const n = Math.max(0, ...actas.map(a => a.numero)) + 1;
  const vacias = (cols, filas, alto) => Array.from({ length: filas }, (_, i) => `<tr>${cols.map((c, j) => `<td style="height:${alto}">${j === 0 ? i + 1 : ''}</td>`).join('')}</tr>`).join('');
  const cuerpo = `<style>
      .acta-pdf h2 { font-size: 10pt; color: #1F77B4; border-bottom: 1.2pt solid #003366; padding-bottom: 1.5mm; margin: 6mm 0 3mm; text-transform: uppercase; }
      .acta-pdf table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      .acta-pdf th, .acta-pdf td { font-size: 8pt; padding: 1.6mm 2mm; border: .5pt solid #AAAAAA; vertical-align: middle; }
      .acta-pdf th { text-align: center; } .acta-pdf .datos td:nth-child(2) { font-weight: 700; }
      .acta-pdf tr { break-inside: avoid; }
    </style><div class="acta-pdf">
    <h2>Datos generales</h2>
    <table class="datos"><colgroup><col style="width:10%"><col style="width:30%"><col></colgroup>
      ${[['Proyecto', `${p.codigo} · ${p.nombre_completo || p.nombre_corto}`], ['Tipo', ''], ['Asunto', ''], ['Código', ''], ['N° Reunión', String(n)], ['Fecha', ''], ['Hora', ''], ['Duración', ''], ['Lugar', '']]
        .map(([c, v], i) => `<tr><td>${i + 1}</td><td>${c}</td><td style="height:7mm">${esc(v)}</td></tr>`).join('')}</table>
    <h2>Asistentes</h2>
    <table><colgroup><col style="width:6%"><col style="width:12%"><col style="width:16%"><col style="width:17%"><col style="width:17%"><col style="width:14%"><col style="width:18%"></colgroup>
      <tr><th>IT</th><th>DNI</th><th>Nombres</th><th>Apellidos</th><th>Cargo</th><th>Empresa</th><th>Firma</th></tr>${vacias([1, 2, 3, 4, 5, 6, 7], 15, '11mm')}</table>
    <h2>Acuerdos</h2>
    <table><colgroup><col style="width:6%"><col><col style="width:14%"><col style="width:13%"><col style="width:12%"></colgroup>
      <tr><th>IT</th><th>Acuerdo</th><th>Resp.</th><th>Fin prog.</th><th>Estado</th></tr>${vacias([1, 2, 3, 4, 5], 10, '10mm')}</table>
    <h2>Fin de acuerdos</h2></div>`;
  imprimirPDF('Acta de acuerdos', cuerpo, { orientacion: 'portrait', proyectoTexto: `${p.codigo} · ${p.nombre_corto}`, archivo: `${nombreProy(p)}_Acta de reunión N${n} (formato en blanco)` });
}
