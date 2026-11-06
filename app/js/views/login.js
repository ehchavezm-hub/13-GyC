// Ingreso, registro, recuperación de contraseña y selección de usuario de demostración.
import { api, modoDemo, clerkConfigurado, usarModo, mensajeError } from '../data/api.js';
import { ROLES } from '../data/catalogos.js';
import { esc, html } from '../core/util.js';
import { error, ok } from '../ui/ui.js';

export function mostrarLogin(raiz, continuar) {
  if (modoDemo) return loginDemo(raiz, continuar);
  raiz.innerHTML = '';
  const caja = html(`<div class="login"><div class="login-caja">
    <div class="logo"><span>Gy<b style="color:var(--naranja)">C</b></span></div>
    <div class="lema">Gestión y Construcción</div>
    <form data-f="ingresar">
      <div class="campo"><label for="l-email">Correo</label><input id="l-email" type="email" autocomplete="username" required></div>
      <div class="campo"><label for="l-clave">Contraseña</label><input id="l-clave" type="password" autocomplete="current-password" required></div>
      <button class="btn btn-primario" type="submit">Ingresar</button>
    </form>
    <form data-f="registrar" class="oculto">
      <div class="campo"><label for="r-nombre">Nombre y apellido</label><input id="r-nombre" required></div>
      <div class="campo"><label for="r-email">Correo</label><input id="r-email" type="email" autocomplete="username" required></div>
      <div class="campo"><label for="r-clave">Contraseña (mínimo 8 caracteres)</label><input id="r-clave" type="password" autocomplete="new-password" minlength="8" required></div>
      <button class="btn btn-primario" type="submit">Crear cuenta</button>
      <p class="nota">El administrador debe aprobar su cuenta y asignarle un rol antes de que pueda usar el aplicativo.</p>
    </form>
    <p style="display:flex;justify-content:space-between;margin-top:12px;font-size:13px">
      <a href="#" data-a="alternar" class="oculto">Crear una cuenta</a><a href="#" data-a="olvido">Olvidé mi contraseña</a></p>
    <p class="nota" style="text-align:center;margin-top:10px"><a href="#" data-a="demo">Probar el modo demostración</a></p>
  </div></div>`);
  raiz.append(caja);
  // Con varias empresas en la plataforma, las cuentas las crea el administrador de cada empresa (pedido 113)
  api.rpc('registro_abierto').then(abierto => { if (abierto !== false) caja.querySelector('[data-a="alternar"]').classList.remove('oculto'); })
    .catch(() => caja.querySelector('[data-a="alternar"]').classList.remove('oculto'));   // base sin la migración 019
  const fIng = caja.querySelector('[data-f="ingresar"]');
  const fReg = caja.querySelector('[data-f="registrar"]');
  fIng.addEventListener('submit', async e => {
    e.preventDefault();
    const b = fIng.querySelector('button'); b.disabled = true;
    const email = caja.querySelector('#l-email').value.trim(), clave = caja.querySelector('#l-clave').value;
    try {
      await api.auth.ingresar(email, clave);
      continuar();
    } catch (err) {
      // El pedido no salió del navegador: se reintenta una vez y, si sigue, se diagnostica la conexión (no solo «Sin conexión»)
      if (!/Failed to fetch|NetworkError|Load failed/i.test(String(err?.message || err))) { error(mensajeError(err)); return; }
      try { await api.auth.ingresar(email, clave); continuar(); return; } catch (err2) {
        if (!/Failed to fetch|NetworkError|Load failed/i.test(String(err2?.message || err2))) { error(mensajeError(err2)); return; }
      }
      mostrarDiagnostico(caja, await probarConexion());
    } finally { b.disabled = false; }
  });
  fReg.addEventListener('submit', async e => {
    e.preventDefault();
    const clave = caja.querySelector('#r-clave').value;
    if (clave.length < 8) return error('La contraseña debe tener al menos 8 caracteres.');
    const b = fReg.querySelector('button'); b.disabled = true;
    const correo = caja.querySelector('#r-email').value.trim();
    try {
      const r = await api.auth.registrar(correo, clave, caja.querySelector('#r-nombre').value.trim());
      if (r.session) return continuar();
      // Aviso fijo (no solo un mensaje temporal) y vuelta al formulario de ingreso con el correo listo
      caja.querySelector('[data-aviso-registro]')?.remove();
      fIng.before(html(`<div class="aviso ok" data-aviso-registro>Cuenta creada. Le enviamos un correo a <b>${esc(correo)}</b>:
        ábralo, pulse el enlace de confirmación y luego ingrese aquí. Si no llega en unos minutos, revise la carpeta de spam.</div>`));
      caja.querySelector('#l-email').value = correo;
      caja.querySelector('[data-a="alternar"]').click();
    } catch (err) { error(mensajeError(err)); } finally { b.disabled = false; }
  });
  caja.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    e.preventDefault();
    if (a === 'alternar') {
      fIng.classList.toggle('oculto'); fReg.classList.toggle('oculto');
      e.target.textContent = fReg.classList.contains('oculto') ? 'Crear una cuenta' : 'Ya tengo cuenta';
    }
    if (a === 'olvido') {
      const email = caja.querySelector('#l-email').value.trim() || prompt('Correo de su cuenta:');
      if (!email) return;
      try { await api.auth.recuperar(email); ok('Le enviamos un correo para restablecer su contraseña.'); } catch (err) { error(mensajeError(err)); }
    }
    if (a === 'demo') usarModo('demo');
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
    <p class="nota" style="margin-top:12px">Abra otra pestaña con un usuario distinto para ver el trabajo simultáneo en tiempo real.</p>
    ${clerkConfigurado ? '<p class="nota" style="text-align:center"><a href="#" data-a="real">Volver al modo real</a></p>' : ''}
  </div></div>`);
  raiz.append(caja);
  caja.addEventListener('click', async e => {
    const b = e.target.closest('[data-id]');
    if (b) { await api.auth.ingresar(b.dataset.id); continuar(); }
    if (e.target.closest('[data-a="real"]')) { e.preventDefault(); usarModo('real'); }
  });
}

// ¿El navegador llega al servidor de datos? (Vercel API /health)
async function probarConexion() {
  const cfg = window.GYC_CONFIG || {};
  const base = cfg.apiBase || '/api';
  const host = location.hostname;
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(`${base}/health`, { signal: ctrl.signal, cache: 'no-store' });
    return { llega: r.ok || r.status < 500, estado: r.status, host };
  } catch (e) {
    return { llega: false, host, motivo: e?.name === 'AbortError' ? 'no respondió en 8 segundos' : 'el navegador bloqueó o no pudo abrir la conexión' };
  } finally { clearTimeout(t); }
}

function mostrarDiagnostico(caja, d) {
  caja.querySelector('.login-diagnostico')?.remove();
  const ahora = new Date().toLocaleString();
  const cuerpo = d.llega
    ? `<p><b>El servidor responde</b>, pero el ingreso se interrumpió dos veces. Intente de nuevo en unos segundos.</p>`
    : `<p><b>Este navegador no logra conectarse al servidor de datos</b> (<code>${esc(d.host)}</code>): ${esc(d.motivo)}.
       La página del aplicativo sí carga, pero el ingreso y los datos van a ese servidor.</p>
       <p>Pruebe, en este orden:</p><ol>
       <li>Abrir el aplicativo en una <b>ventana de incógnito</b> (Ctrl+Shift+N). Si ahí funciona, una <b>extensión</b> del navegador lo bloquea.</li>
       <li>Desactivar la VPN o probar con otra red (por ejemplo, los datos del celular).</li>
       <li>Si nada funciona: pedir a soporte de TI que permita <code>${esc(d.host)}</code> en el navegador / proxy / antivirus.</li></ol>`;
  caja.querySelector('[data-f="ingresar"]').insertAdjacentElement('afterend', html(`<div class="login-diagnostico nota" role="alert"
    style="margin-top:12px;padding:10px 12px;border:1px solid #f0c36d;background:#fff8e6;border-radius:8px;text-align:left;font-size:.85rem">
    ${cuerpo}<p style="margin:6px 0 0;opacity:.7">Diagnóstico ${esc(ahora)} · ${d.llega ? `servidor ${d.estado}` : 'sin respuesta'}. Envíe una captura de este mensaje al administrador.</p></div>`));
  error(d.llega ? 'El ingreso se interrumpió. Intente nuevamente.' : 'Este navegador no logra conectarse al servidor de datos.');
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

export function mostrarNuevaClave(raiz, motivo = '') {
  raiz.innerHTML = '';
  const caja = html(`<div class="login"><div class="login-caja">
    <div class="logo"><span>Gy<b style="color:var(--naranja)">C</b></span></div>
    <div class="lema">Defina su nueva contraseña</div>
    ${motivo ? `<div class="aviso">${esc(motivo)}</div>` : ''}
    <form><div class="campo"><label for="n1">Nueva contraseña</label><input id="n1" type="password" minlength="8" required autocomplete="new-password"></div>
    <div class="campo"><label for="n2">Repetir</label><input id="n2" type="password" minlength="8" required autocomplete="new-password"></div>
    <button class="btn btn-primario" type="submit">Guardar</button></form>
    <button class="btn btn-sm" data-a="salir" style="margin-top:10px">Cerrar sesión</button></div></div>`);
  raiz.append(caja);
  caja.querySelector('[data-a="salir"]').onclick = async () => { await api.auth.salir(); location.hash = ''; location.reload(); };
  caja.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault();
    const a = caja.querySelector('#n1').value, b = caja.querySelector('#n2').value;
    if (a.length < 8) return error('Mínimo 8 caracteres.');
    if (a !== b) return error('Las contraseñas no coinciden.');
    try { await api.auth.cambiarClave(a); ok('Contraseña actualizada.'); location.hash = ''; setTimeout(() => location.reload(), 800); }
    catch (err) { error(mensajeError(err)); }
  });
}
