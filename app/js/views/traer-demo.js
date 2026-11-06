// Ventana "Traer datos del modo demostración" (Configuración → Respaldo).
import { api, mensajeError } from '../data/api.js';
import { store, cargarCatalogo } from '../core/store.js';
import { esc } from '../core/util.js';
import { modal, ok, error } from '../ui/ui.js';
import { ROLES } from '../data/catalogos.js';
import { leerDemo, opciones, ejecutar, ORDEN, NOMBRES } from '../services/traer-demo.js';

// Contraseña temporal legible (sin caracteres que se confunden)
function generarClave() {
  const c = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(crypto.getRandomValues(new Uint32Array(10)), x => c[x % c.length]).join('');
}

async function datosReales() {
  const area = store.area.id;
  const [listas, valores, perfiles] = await Promise.all([
    api.list('listas', {}), api.list('lista_valores', {}), api.list('profiles', { eq: { area_id: area } })]);
  const existentes = {};
  await Promise.all(ORDEN.map(async t => {
    if (t === 'proyecto_lideres' || t === 'proyecto_favoritos') {
      const filas = await api.list(t, { select: 'proyecto_id,usuario_id' });
      existentes[t] = new Set(filas.map(f => `${f.proyecto_id}|${f.usuario_id}`));
    } else {
      const filas = await api.list(t, t === 'plantilla_items' ? { select: 'id' } : { select: 'id', eq: { area_id: area } });
      existentes[t] = new Set(filas.map(f => f.id));
    }
  }));
  return { areaId: area, yo: store.usuario.id, listas: listas.filter(l => !l.area_id || l.area_id === area), valores, perfiles, existentes };
}

export async function abrirTraerDemo() {
  const db = leerDemo();
  if (!db) return error('No hay datos del modo demostración en este navegador.');
  let reales;
  try { reales = await datosReales(); } catch (e) { return error(mensajeError(e)); }
  const op = opciones(db, reales);
  const cuenta = t => (db[t] || []).length;
  const fila = (tipo, x, texto, nota = '', deshabilitado = false) => `<label class="traer-fila${deshabilitado ? ' nota' : ''}">
    <input type="checkbox" data-${tipo}="${x.id}" ${x.marcado ? 'checked' : ''} ${deshabilitado ? 'disabled' : ''}> ${texto}${nota ? ` <small class="nota">${nota}</small>` : ''}</label>`;

  const v = modal({
    titulo: 'Traer datos del modo demostración', ancho: 780,
    cuerpo: `<p>Los datos que cargaste en el modo demostración están guardados <b>solo en este navegador</b>. Aquí los pasas a la base de datos real
      para que todo el equipo los vea. No se borra nada del modo demostración y se puede repetir: lo ya traído se omite.</p>
      <p class="nota">En este navegador hay: ${ORDEN.filter(t => cuenta(t)).map(t => `${NOMBRES[t]} ${cuenta(t)}`).join(' · ')}.</p>
      <div class="grid-2">
        <div><h3>Personas</h3>
          <p class="nota">Tú (${esc(op.principal?.nombre || 'administrador principal')} en el modo demostración) quedas como
            <b>${esc(store.usuario.nombre)}</b>. A cada persona nueva se le crea su cuenta con una contraseña temporal.</p>
          <div class="traer-lista">${op.personas.map(p => fila('persona', p, `${esc(p.nombre)} <small>· ${esc(ROLES[p.rol] || p.rol)}</small>`,
            p.existente ? 'ya tiene cuenta' : p.valido ? esc(p.email) : 'sin correo válido: no se puede crear su cuenta', !p.valido)).join('') || '<p class="nota">Sin otras personas.</p>'}</div></div>
        <div><h3>Proyectos / Procesos</h3>
          <div class="traer-lista">${op.proyectos.map(p => fila('proyecto', p, `<b>${esc(p.codigo || '')}</b> ${esc(p.nombre || '')}`)).join('') || '<p class="nota">Sin proyectos.</p>'}</div></div>
      </div>
      <label class="traer-fila" style="margin-top:10px"><input type="checkbox" data-ejemplos> Incluir también los datos de ejemplo del modo demostración
        (actividades, restricciones y demás registros ficticios que venían de fábrica y no modificaste)</label>
      <p class="nota">Las actividades, cierres y ubicaciones de una persona que no elijas no se traen. Los comentarios quedan a tu nombre.</p>
      <div data-progreso class="aviso oculto"></div>`,
    botones: [{ texto: 'Cancelar' }, { texto: 'Traer datos', clase: 'btn-primario', accion: async () => {
      const marcados = tipo => new Set([...v.cuerpo.querySelectorAll(`[data-${tipo}]:checked`)].map(i => i.dataset[tipo]));
      const eleccion = { personas: marcados('persona'), proyectos: marcados('proyecto'), ejemplos: v.cuerpo.querySelector('[data-ejemplos]').checked };
      const prog = v.cuerpo.querySelector('[data-progreso]');
      prog.classList.remove('oculto');
      const progreso = t => { prog.textContent = t; };
      try {
        const informe = await ejecutar({
          api, db, eleccion, reales, progreso,
          crearCuenta: async p => {
            const clave = generarClave();
            const { id } = await api.adminUsuarios('crear_cuenta', { email: p.email.trim(), nombre: p.nombre, clave });
            return { id, clave, sesion: false };
          },
          actualizarPerfil: (id, p, traducir) => api.update('profiles', id, {
            nombre: p.nombre, codigo: p.codigo || null, rol: p.rol === 'superadmin' ? 'admin' : p.rol,
            gerencia_ids: (p.gerencia_ids || []).map(traducir), horas_dia: p.horas_dia ?? null,
            cargo_id: p.cargo_id ? traducir(p.cargo_id) : null, debe_cambiar_clave: true,
          }),
        });
        await cargarCatalogo();
        mostrarInforme(informe);
      } catch (e) { error(mensajeError(e)); return false; }
    } }],
  });
  // Al marcar "datos de ejemplo" se marcan también las personas y proyectos de ejemplo
  v.cuerpo.querySelector('[data-ejemplos]').addEventListener('change', e => {
    if (!e.target.checked) return;
    v.cuerpo.querySelectorAll('[data-proyecto]').forEach(i => { i.checked = true; });
  });
}

function mostrarInforme(inf) {
  const creados = Object.entries(inf.creados).map(([t, n]) => `<li>${NOMBRES[t] || t}: <b>${n}</b></li>`).join('') || '<li>Nada nuevo: todo ya estaba en la base.</li>';
  const texto = inf.credenciales.map(c => `${c.nombre}\nUsuario: ${c.email}\nContraseña temporal: ${c.clave}`).join('\n\n');
  modal({
    titulo: 'Datos traídos', ancho: 640,
    cuerpo: `<ul>${creados}</ul>
      ${inf.credenciales.length ? `<h3>Cuentas creadas (${inf.credenciales.length})</h3>
        <p>Entrega a cada persona sus datos por un medio privado. Al ingresar se le pedirá definir su propia contraseña.
        Enlace: ${esc(location.origin + location.pathname)}</p><pre class="credenciales">${esc(texto)}</pre>` : ''}
      ${inf.sinConfirmar.length ? `<div class="aviso">El correo de ${inf.sinConfirmar.length} persona(s) requiere confirmación antes de que puedan ingresar.</div>` : ''}
      ${inf.errores.length ? `<div class="aviso error"><b>No se pudo traer:</b><ul>${inf.errores.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        Puedes corregir y volver a pulsar "Traer datos": lo ya traído se omite.</div>` : ''}`,
    botones: [{ texto: 'Cerrar' }, ...(texto ? [{ texto: 'Copiar contraseñas', clase: 'btn-primario', accion: async () => {
      await navigator.clipboard?.writeText(texto).catch(() => {}); ok('Datos copiados.'); return false; } }] : [])],
  });
  if (!inf.errores.length) ok('Datos traídos a la base de datos.');
}

