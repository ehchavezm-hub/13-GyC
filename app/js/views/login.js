// Pantalla de ingreso. Con Clerk activo, monta el componente oficial de Clerk.
// En modo demostración, muestra selector de usuarios ficticios.
import { api, modoDemo, clerkConfigurado, usarModo, mensajeError } from '../data/api.js';
import { ROLES } from '../data/catalogos.js';
import { esc, html } from '../core/util.js';
import { error } from '../ui/ui.js';

export function mostrarLogin(raiz, continuar) {
  if (modoDemo) return loginDemo(raiz, continuar);
  raiz.innerHTML = '';

  const caja = html(`<div class="login"><div class="login-caja">
    <div class="logo"><span>Gy<b style="color:var(--naranja)">C</b></span></div>
    <div class="lema">Gestión y Construcción</div>
    <div id="clerk-signin"></div>
    <p class="nota" style="text-align:center;margin-top:14px">
      <a href="#" data-a="demo">Probar el modo demostración</a></p>
  </div></div>`);
  raiz.append(caja);

  caja.addEventListener('click', e => {
    if (e.target.closest('[data-a="demo"]')) { e.preventDefault(); usarModo('demo'); }
  });

  _montarClerk(caja.querySelector('#clerk-signin'), continuar);
}

function _montarClerk(el, continuar) {
  if (!window.Clerk) {
    // Clerk aún no cargó — reintenta hasta 20 veces (10 s)
    let intentos = 0;
    const id = setInterval(() => {
      intentos++;
      if (window.Clerk) { clearInterval(id); _montarClerk(el, continuar); }
      else if (intentos >= 20) {
        clearInterval(id);
        el.innerHTML = `<div class="aviso error">No se pudo cargar Clerk. Recargue la página o verifique la clave publicable en config.js.</div>`;
      }
    }, 500);
    return;
  }

  window.Clerk.mountSignIn(el, {
    fallbackRedirectUrl: location.pathname + location.search,
    appearance: { variables: { colorPrimary: '#e67e22', borderRadius: '8px' } },
  });

  // Detecta ingreso exitoso
  const unsub = window.Clerk.addListener(({ user }) => {
    if (user) { unsub?.(); continuar(); }
  });
}

function loginDemo(raiz, continuar) {
  const usuarios = api.usuariosDemo().filter(u => u.activo);
  raiz.innerHTML = '';
  const caja = html(`<div class="login"><div class="login-caja">
    <div class="logo"><span>Gy<b style="color:var(--naranja)">C</b></span></div>
    <div class="lema">Modo demostración · datos ficticios guardados solo en este navegador</div>
    <p style="font-weight:700;margin:0 0 8px">Ingresar como:</p>
    <div class="usuarios-demo">${usuarios.map(u => `<button data-id="${u.id}"><span class="avatar">${esc((u.codigo || '?').slice(0, 2))}</span>
      <span><b>${esc(u.nombre)}</b><small>${esc(ROLES[u.rol] || u.rol)}${u.es_admin_principal ? ' principal' : ''}</small></span></button>`).join('')}</div>
    <p class="nota" style="margin-top:12px">Abra otra pestaña con un usuario distinto para ver el trabajo simultáneo.</p>
    ${clerkConfigurado ? '<p class="nota" style="text-align:center"><a href="#" data-a="real">Volver al modo real</a></p>' : ''}
  </div></div>`);
  raiz.append(caja);
  caja.addEventListener('click', async e => {
    const b = e.target.closest('[data-id]');
    if (b) { await api.auth.ingresar(b.dataset.id); continuar(); }
    if (e.target.closest('[data-a="real"]')) { e.preventDefault(); usarModo('real'); }
  });
}

export function mostrarPendiente(raiz, mensaje) {
  raiz.innerHTML = '';
  const caja = html(`<div class="login"><div class="login-caja">
    <div class="logo"><span>Gy<b style="color:var(--naranja)">C</b></span></div>
    <div class="aviso warn" style="margin-top:14px">${esc(mensaje)}</div>
    <button class="btn" data-a="salir">Cerrar sesión</button></div></div>`);
  raiz.append(caja);
  caja.querySelector('[data-a="salir"]').onclick = async () => { await api.auth.salir(); location.reload(); };
}

// Contraseña temporal asignada por el administrador (debe_cambiar_clave): la persona define la suya antes de entrar.
// Con Clerk se cambia en el navegador (pide la contraseña temporal como actual); en demo solo se marca el perfil.
export function mostrarNuevaClave(raiz, motivo = '') {
  raiz.innerHTML = '';
  const caja = html(`<div class="login"><div class="login-caja">
    <div class="logo"><span>Gy<b style="color:var(--naranja)">C</b></span></div>
    ${motivo ? `<div class="aviso warn" style="margin-top:14px">${esc(motivo)}</div>` : ''}
    <form data-f="clave" style="display:grid;gap:10px;margin-top:14px">
      ${modoDemo ? '' : '<label>Contraseña actual (la temporal)<input type="password" name="actual" required autocomplete="current-password"></label>'}
      <label>Nueva contraseña<input type="password" name="nueva" required minlength="8" autocomplete="new-password"></label>
      <label>Repita la nueva contraseña<input type="password" name="repetir" required minlength="8" autocomplete="new-password"></label>
      <button class="btn btn-primario" type="submit">Guardar y continuar</button>
    </form>
    <p class="nota" style="text-align:center;margin-top:12px"><a href="#" data-a="salir">Cerrar sesión</a></p>
  </div></div>`);
  raiz.append(caja);
  const form = caja.querySelector('[data-f="clave"]');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    if (d.nueva !== d.repetir) return error('Las contraseñas no coinciden.');
    if (String(d.nueva).length < 8) return error('La contraseña debe tener al menos 8 caracteres.');
    const boton = form.querySelector('button');
    boton.disabled = true;
    try {
      await api.auth.cambiarClave(d.nueva, d.actual);
      location.reload();
    } catch (err) { error(mensajeError(err)); boton.disabled = false; }
  });
  caja.querySelector('[data-a="salir"]').onclick = async e => { e.preventDefault(); await api.auth.salir(); location.reload(); };
}
