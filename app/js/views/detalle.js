// Ventanas de detalle reutilizables: comentarios y menciones (M-06), enlaces (M-07), restricciones de una
// actividad y historial de cambios.
import { api, mensajeError } from '../data/api.js';
import { store, nombre, puede, esStaff, esGestor, opciones, opcionesEstado, colorEstado, textoEstado, etiqueta } from '../core/store.js';
import { esc, html, fmtFechaHora, fmtFecha, hoy } from '../core/util.js';
import { modal, error, ok, badge, confirmar, pedirDatos } from '../ui/ui.js';

const NOMBRES = { actividad: 'actividad', restriccion: 'restricción', proyecto: 'proyecto', cartera: 'solicitud' };

function resaltarMenciones(texto) {
  return esc(texto).replace(/@([\wÁÉÍÓÚÑáéíóúñ.]+(?: [\wÁÉÍÓÚÑáéíóúñ.]+)?)/g, '<span class="mencion">@$1</span>');
}

/** Panel de comentarios y enlaces de una entidad. Devuelve el elemento. */
export async function panelColaboracion(entidad, id, { alCambiar } = {}) {
  const el = html(`<div class="colab"><div class="grid-2" style="gap:16px">
    <div><h3>Comentarios</h3><div class="lista-com"></div>
      ${esStaff() ? `<div class="campo" style="margin-top:8px"><textarea rows="2" placeholder="Escriba un comentario. Use @ para mencionar (p. ej. @${esc((store.perfiles[1] || store.usuario).nombre)})"></textarea>
      <div style="display:flex;gap:6px;margin-top:6px"><button class="btn btn-sm btn-primario" data-a="comentar">Comentar</button></div></div>` : ''}</div>
    <div><h3>Enlaces a documentos</h3><div class="lista-enlaces"></div>
      ${esStaff() ? `<div class="form" style="margin-top:8px;grid-template-columns:1fr">
        <input class="inp" data-t placeholder="Título (p. ej. Plano de estructuras rev. B)">
        <input class="inp" data-u placeholder="https://… (SharePoint, OneDrive, Drive…)">
        <button class="btn btn-sm" data-a="enlazar">Agregar enlace</button></div>` : ''}</div>
  </div></div>`);
  async function cargar() {
    const [coms, enls] = await Promise.all([
      api.list('comentarios', { eq: { entidad, entidad_id: id }, order: [['created_at', true]] }),
      api.list('enlaces', { eq: { entidad, entidad_id: id }, order: [['created_at', true]] }),
    ]);
    el.querySelector('.lista-com').innerHTML = coms.length ? coms.map(c => `<div class="comentario"><b>${esc(nombre(c.autor_id) || 'Usuario')}</b>
      <small>${fmtFechaHora(c.created_at)}</small>${c.autor_id === store.usuario.id ? ` <button class="btn-icono" data-borrar-com="${c.id}" title="Eliminar">✕</button>` : ''}
      <div>${resaltarMenciones(c.texto)}</div></div>`).join('') : '<p class="nota">Sin comentarios.</p>';
    el.querySelector('.lista-enlaces').innerHTML = enls.length ? enls.map(l => `<div style="display:flex;gap:6px;align-items:center">
      <a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">🔗 ${esc(l.titulo)}</a>
      ${l.autor_id === store.usuario.id || esGestor() ? `<button class="btn-icono" data-borrar-enl="${l.id}" title="Quitar">✕</button>` : ''}</div>`).join('')
      : '<p class="nota">Sin enlaces.</p>';
    return coms.length + enls.length;
  }
  el.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    try {
      if (a === 'comentar') {
        const ta = el.querySelector('textarea');
        const texto = ta.value.trim();
        if (!texto) return;
        const menciones = store.perfiles.filter(p => p.id !== store.usuario.id && p.activo &&
          (texto.toLowerCase().includes('@' + p.nombre.toLowerCase()) || (p.codigo && new RegExp('@' + p.codigo + '\\b', 'i').test(texto)) ||
           texto.toLowerCase().includes('@' + p.nombre.split(' ')[0].toLowerCase()))).map(p => p.id);
        await api.insert('comentarios', { area_id: store.area.id, entidad, entidad_id: id, texto, menciones, autor_id: store.usuario.id });
        ta.value = '';
        if (menciones.length) ok(`Se notificó a ${menciones.length} persona(s).`);
        alCambiar?.(await cargar());
      }
      if (a === 'enlazar') {
        const titulo = el.querySelector('[data-t]').value.trim();
        const url = el.querySelector('[data-u]').value.trim();
        if (!titulo || !/^https?:\/\//i.test(url)) return error('Indique un título y una dirección que empiece con http:// o https://');
        await api.insert('enlaces', { area_id: store.area.id, entidad, entidad_id: id, titulo, url, autor_id: store.usuario.id });
        el.querySelector('[data-t]').value = ''; el.querySelector('[data-u]').value = '';
        alCambiar?.(await cargar());
      }
      const bc = e.target.closest('[data-borrar-com]');
      if (bc) {
        if (!await confirmar('¿Eliminar este comentario? Esta acción no se puede deshacer.', { titulo: 'Eliminar comentario', texto: 'Eliminar', peligro: true })) return;
        await api.remove('comentarios', bc.dataset.borrarCom); alCambiar?.(await cargar());
      }
      const be = e.target.closest('[data-borrar-enl]');
      if (be) {
        if (!await confirmar('¿Eliminar este enlace? Esta acción no se puede deshacer.', { titulo: 'Eliminar enlace', texto: 'Eliminar', peligro: true })) return;
        await api.remove('enlaces', be.dataset.borrarEnl); alCambiar?.(await cargar());
      }
    } catch (err) { error(mensajeError(err)); }
  });
  await cargar();
  return el;
}

export async function abrirDetalle(entidad, fila, { titulo, alCambiar } = {}) {
  const cuerpo = html(`<div><p class="nota">${esc(titulo || fila.descripcion || fila.nombre_corto || '')}</p><div data-colab></div>
    ${esGestor() ? '<details style="margin-top:14px"><summary><b>Historial de cambios</b></summary><div data-hist class="nota">Cargando…</div></details>' : ''}</div>`);
  modal({ titulo: `Detalle de ${NOMBRES[entidad] || entidad}`, cuerpo, ancho: 880 });
  cuerpo.querySelector('[data-colab]').append(await panelColaboracion(entidad, fila.id, { alCambiar }));
  const hist = cuerpo.querySelector('[data-hist]');
  if (hist) {
    const tabla = { actividad: 'actividades', restriccion: 'restricciones', proyecto: 'proyectos', cartera: 'cartera' }[entidad];
    try {
      const regs = await api.list('auditoria', { eq: { tabla, registro_id: fila.id }, order: [['created_at', false]], limit: 50 });
      hist.innerHTML = regs.length ? `<table class="simple"><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Cambios</th></tr>${regs.map(r => `<tr>
        <td>${fmtFechaHora(r.created_at)}</td><td>${esc(nombre(r.usuario_id) || 'Sistema')}</td><td>${esc(r.accion)}</td>
        <td>${r.accion === 'update' ? Object.entries(r.cambios || {}).map(([k, [a, b]]) => `<div><b>${esc(k)}</b>: ${esc(JSON.stringify(a))} → ${esc(JSON.stringify(b))}</div>`).join('') : ''}</td></tr>`).join('')}</table>`
        : 'Sin registros.';
    } catch (e) { hist.textContent = mensajeError(e); }
  }
}

/** Restricciones de una actividad: lista y alta rápida (RN-07). */
// item: también un ítem del Backlog (tabla cartera): sus restricciones se guardan sin actividad, con extra.cartera_id, y
// pasan a la actividad cuando el ítem se lleva al Look Ahead
export async function abrirRestricciones(act, { alCambiar, item = false } = {}) {
  const cuerpo = html('<div><div data-lista></div></div>');
  const m = modal({
    titulo: item ? 'Restricciones del ítem del Backlog' : 'Restricciones de la actividad', cuerpo, ancho: 860,
    botones: [{ texto: 'Cerrar' }, { texto: '＋ Nueva restricción', clase: 'btn-primario', accion: async () => { await nueva(); return false; } }],
  });
  async function pintar() {
    const rs = item
      ? (await api.list('restricciones', { eq: { area_id: store.area.id }, order: [['created_at', true]] })).filter(r => r.extra?.cartera_id === act.id && !r.actividad_id)
      : await api.list('restricciones', { eq: { actividad_id: act.id }, order: [['created_at', true]] });
    cuerpo.querySelector('[data-lista]').innerHTML = `<p class="nota">${esc(act.descripcion)}</p>` + (rs.length ? `<table class="simple">
      <tr><th>Restricción</th><th>Tipo</th><th>Responsable</th><th>F. requerida</th><th>F. prometida</th><th>Estado</th><th></th></tr>
      ${rs.map(r => `<tr><td>${esc(r.descripcion)}</td><td>${esc(etiqueta(r.tipo_id))}</td><td>${esc(r.responsable || nombre(r.responsable_id))}</td>
        <td>${fmtFecha(r.f_requerida)}</td><td>${fmtFecha(r.f_prometida)}</td>
        <td>${badge(textoEstado('estados_restriccion', r.estado), colorEstado('estados_restriccion', r.estado))}</td>
        <td>${r.estado !== 'levantada' ? `<button class="btn btn-sm" data-levantar="${r.id}">Levantar</button>` : fmtFecha(r.f_levantada)}</td></tr>`).join('')}</table>`
      : '<p class="nota">Sin restricciones registradas.</p>');
    return rs;
  }
  async function nueva() {
    await pedirDatos({
      titulo: 'Nueva restricción', campos: camposRestriccion(),
      valores: { f_identificada: hoy(), estado: 'pendiente' },
      alGuardar: async d => {
        if (item) await api.insert('restricciones', { ...d, area_id: store.area.id, actividad_id: null, proyecto_id: act.proyecto_id, extra: { cartera_id: act.id } });
        else {
          await api.insert('restricciones', { ...d, area_id: store.area.id, actividad_id: act.id, proyecto_id: act.proyecto_id });
          await sincronizarEstadoLA(act.id);
        }
        ok('Restricción registrada.');
      },
    });
    await pintar(); alCambiar?.();
  }
  cuerpo.addEventListener('click', async e => {
    const b = e.target.closest('[data-levantar]');
    if (!b) return;
    try {
      await api.update('restricciones', b.dataset.levantar, { estado: 'levantada', f_levantada: hoy() });
      await pintar();
      if (!item) await sincronizarEstadoLA(act.id);
      alCambiar?.();
    } catch (err) { error(mensajeError(err)); }
  });
  await pintar();
  return m;
}

/**
 * Estado LA de una actividad según sus restricciones (RN-07): con alguna pendiente pasa a "Con restricción";
 * al levantar (o eliminar) la última, a "Lista". No toca las trasladadas al plan ni las canceladas.
 * Se usa desde el Look Ahead, el Plan y la pantalla Restricciones, para que el resultado sea el mismo en todas.
 */
export async function sincronizarEstadoLA(actividadId) {
  if (!actividadId) return;
  try {
    const [act] = await api.list('actividades', { eq: { id: actividadId } });
    if (!act) return;
    const rs = await api.list('restricciones', { eq: { actividad_id: actividadId } });
    const abiertas = rs.some(r => r.estado !== 'levantada');
    const nuevo = abiertas && ['pendiente', 'lista'].includes(act.estado_la) ? 'con_restriccion'
      : !abiertas && act.estado_la === 'con_restriccion' ? 'lista' : null;
    if (nuevo) await api.update('actividades', act.id, { estado_la: nuevo });
  } catch { /* sin permiso sobre la actividad: la base lo sincroniza (migración 016) */ }
}

export function camposRestriccion() {
  return [
    { name: 'descripcion', label: 'Descripción', type: 'textarea', required: true, full: true },
    { name: 'tipo_id', label: 'Tipo', type: 'select', options: opciones('tipos_restriccion') },
    { name: 'responsable', label: 'Responsable de levantarla', placeholder: 'Persona o área (puede ser externa)' },
    { name: 'f_identificada', label: 'F. identificada', type: 'date' },
    { name: 'f_requerida', label: 'F. requerida', type: 'date', help: 'Cuándo se necesita resuelta' },
    { name: 'f_prometida', label: 'F. prometida', type: 'date' },
    { name: 'estado', label: 'Estado', type: 'select', options: opcionesEstado('estados_restriccion') },
    { name: 'comentarios', label: 'Comentarios', type: 'textarea', full: true },
  ];
}

export async function confirmarRestricciones(acts, rests) {
  const con = acts.filter(a => rests.some(r => r.actividad_id === a.id && r.estado !== 'levantada'));
  if (!con.length) return true;
  return confirmar(`${con.length} actividad(es) tienen restricciones pendientes. Según la regla RN-07 se pueden comprometer, pero quedarán marcadas. ¿Continuar?`,
    { titulo: 'Restricciones pendientes', texto: 'Comprometer igual' });
}
