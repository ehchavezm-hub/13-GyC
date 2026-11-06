// Arranque del aplicativo: sesión, catálogo, estructura y rutas.
import { api, mensajeError } from './data/api.js';
import { store, cargarPerfil, cargarCatalogo, esStaff, esAdmin } from './core/store.js';
import { ruta, iniciarRouter } from './core/router.js';
import { montarLayout } from './ui/layout.js';
import { mostrarLogin, mostrarPendiente, mostrarNuevaClave } from './views/login.js';
import { error, toast } from './ui/ui.js';
import { iniciarMonitoreo, usuarioMonitoreo, medir } from './core/monitoreo.js';

const raiz = document.getElementById('raiz');

// Copia sin conexión de los datos (service worker): se borra al salir o si ingresa otra persona en el mismo navegador
async function borrarDatosLocales() {
  try { await caches.delete('gyc-datos'); } catch { /* sin Cache API */ }
}
// Datos del perfil que definen qué catálogo se carga (empresa, rol y gerencias de consulta)
const CLAVES_PERFIL = ['id', 'area_id', 'rol', 'gerencia_ids', 'activo'];
function perfilLocal(id) {
  try { const p = JSON.parse(localStorage.getItem('gyc-perfil') || 'null'); return p?.id === id ? p : null; } catch { return null; }
}
function guardarPerfilLocal(u) {
  try { localStorage.setItem('gyc-perfil', JSON.stringify(Object.fromEntries(CLAVES_PERFIL.map(k => [k, u[k]])))); } catch { /* opcional */ }
}
async function verificarUsuarioLocal(id) {
  let anterior = null;
  try { anterior = localStorage.getItem('gyc-usuario-local'); localStorage.setItem('gyc-usuario-local', id); } catch { /* sin almacenamiento */ }
  if (anterior && anterior !== id) await borrarDatosLocales();
}

ruta('/informacion-proyecto', () => import('./views/informacion-proyecto.js'), { staff: true });
ruta('/programa-arranque', () => import('./views/programa-arranque.js'), { staff: true });
ruta('/plan', () => import('./views/plan.js'), { staff: true });
ruta('/lookahead', () => import('./views/lookahead.js'), { staff: true });
ruta('/backlog', () => import('./views/backlog.js'), { staff: true });
ruta('/restricciones', () => import('./views/restricciones.js'), { staff: true });
ruta('/cartera', () => import('./views/cartera.js'));
ruta('/cartera/:id', () => import('./views/cartera.js'));
ruta('/tablero', () => import('./views/tablero.js'));
ruta('/reunion', () => import('./views/reunion.js'), { staff: true });
ruta('/proyectos', () => import('./views/proyectos.js'));
ruta('/proyectos/:id', () => import('./views/proyectos.js'));
ruta('/proyecto/:id', () => import('./views/proyectos.js'));
ruta('/actividad/:id', () => import('./views/actividad.js'));
ruta('/restriccion/:id', () => import('./views/restricciones.js'));
ruta('/reportes', () => import('./views/reportes.js'));
ruta('/config/:seccion', () => import('./views/config.js'), { gestor: true });
ruta('/admin', () => import('./views/admin-console.js').then(m => ({
  render(el) { el.innerHTML = ''; m.showAdminConsole(undefined, el); },
})), { admin: true });

async function arrancar() {
  iniciarMonitoreo();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    // Versión nueva publicada: el service worker la descarga en segundo plano y toma el control. Si la página se
    // acaba de abrir se recarga sola; si la persona ya está trabajando, se le avisa para no interrumpirla.
    const habia = !!navigator.serviceWorker.controller, inicio = Date.now();
    let avisado = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!habia || avisado) return;
      avisado = true;
      if (Date.now() - inicio < 20000) location.reload();
      else toast('Hay una versión nueva del aplicativo. Pulse «Actualizar» (arriba a la derecha) o recargue la página para usarla.', 'info', 30000);
    });
  }
  api.auth.alCambiar((evento) => {
    if (evento === 'SIGNED_OUT') borrarDatosLocales().finally(() => location.reload());
  });

  let usuario = null;
  try { usuario = await api.auth.usuario(); } catch (e) { console.warn(e); }
  if (!usuario) return mostrarLogin(raiz, arrancar);
  await verificarUsuarioLocal(usuario.id);

  // El catálogo se pide en paralelo con el perfil usando la empresa y el rol de la sesión anterior; si cambiaron,
  // se vuelve a pedir (antes: perfil y luego catálogo, una espera de red más en cada ingreso)
  const previo = perfilLocal(usuario.id);
  let catalogoAnticipado = null;
  if (previo) {
    store.usuario = previo;
    catalogoAnticipado = cargarCatalogo().then(() => true, () => false);
  }
  try {
    await cargarPerfil(usuario.id);
  } catch (e) {
    raiz.innerHTML = `<div class="login"><div class="login-caja"><div class="aviso error">${mensajeError(e)}</div>
      <button class="btn" onclick="location.reload()">Reintentar</button></div></div>`;
    return;
  }
  if (!store.usuario) return mostrarPendiente(raiz, 'Su perfil aún no está creado. Intente nuevamente en unos segundos.');
  if (store.usuario.rol === 'pendiente' || !store.usuario.activo) {
    return mostrarPendiente(raiz, store.usuario.activo
      ? 'Su cuenta fue registrada. El administrador debe asignarle un rol para que pueda ingresar.'
      : 'Su cuenta está desactivada. Comuníquese con el administrador.');
  }
  if (store.usuario.debe_cambiar_clave) {
    return mostrarNuevaClave(raiz, 'El administrador le asignó una contraseña temporal. Defina su propia contraseña para continuar.');
  }
  usuarioMonitoreo(store.usuario, store.usuario.area_id);
  const vigente = previo && CLAVES_PERFIL.every(k => JSON.stringify(previo[k]) === JSON.stringify(store.usuario[k]));
  const anticipadoOk = await catalogoAnticipado;   // siempre se espera: así no pisa al catálogo nuevo si hay que repetirlo
  if (!(vigente && anticipadoOk)) {
    try { await medir('catalogo.cargar', cargarCatalogo); } catch (e) { error(mensajeError(e)); }
  }
  guardarPerfilLocal(store.usuario);
  // Empresa desactivada por el administrador de la plataforma (pedido 113): sus usuarios no ingresan
  if (store.area && store.area.activa === false && !store.usuario.es_plataforma) {
    return mostrarPendiente(raiz, `La empresa "${store.area.nombre}" está desactivada. Comuníquese con el administrador de la plataforma.`);
  }

  const contenido = montarLayout(raiz, {
    alSalir: async () => { await borrarDatosLocales(); await api.auth.salir(); location.hash = ''; location.reload(); },
  });
  iniciarRouter(contenido, {
    porDefecto: esStaff() ? '/plan' : '/tablero',
    guardia: r => {
      if (r.staff && !esStaff()) { location.hash = '#/tablero'; return false; }
      if (r.gestor && !['superadmin', 'admin', 'delegado'].includes(store.usuario.rol)) { location.hash = '#/plan'; return false; }
      if (r.admin && !esAdmin()) { location.hash = '#/tablero'; return false; }
      return true;
    },
  });
}

// Espera el script de Clerk (lo agrega config.js) y lo inicia. Un fallo queda en window.__clerkError
// para que la pantalla de ingreso lo muestre en lugar de quedar en blanco.
async function inicializarClerk() {
  const key = window.GYC_CONFIG?.clerkPublishableKey;
  if (!key) { window.__clerkError = 'Falta clerkPublishableKey en config.js.'; return; }
  for (let i = 0; i < 40 && typeof window.Clerk === 'undefined' && !window.__clerkError; i++) {
    await new Promise(r => setTimeout(r, 250));
  }
  if (typeof window.Clerk === 'undefined') {
    window.__clerkError ||= 'El script de Clerk no cargó (revise la conexión o un bloqueador de contenido).';
    return;
  }
  try {
    if (typeof window.Clerk === 'function') window.Clerk = new window.Clerk(key);
    if (!window.Clerk.loaded) await window.Clerk.load();
  } catch (e) {
    console.error('Clerk.load error:', e);
    window.__clerkError = `Clerk no pudo iniciar: ${e?.errors?.[0]?.longMessage || e?.message || e}`;
  }
}

inicializarClerk().then(arrancar);
