// Configuración de conexión.
// La clave publicable (publishable) es pública por diseño: la seguridad está en las Vercel Functions.
// NUNCA escriba aquí la clave secreta de Clerk.
window.GYC_CONFIG = {
  clerkPublishableKey: 'pk_test_YWRhcHRlZC10cm9sbC0zNDIxLmNsZXJrLmFjY291bnRzLmRldiQ',
  apiBase: '/api',
};

// Carga Clerk (v5) con la clave de arriba: única fuente de la clave publicable (index.html no la repite).
// Se usa el script que sirve la propia instancia de Clerk (dominio dentro de la clave, como recomienda Clerk);
// si falla, el de jsDelivr. Un error queda en window.__clerkError y la pantalla de ingreso lo muestra.
(function () {
  var key = window.GYC_CONFIG.clerkPublishableKey;
  if (!key) return;
  var dominio = '';
  try { dominio = atob(key.split('_')[2] || '').replace(/\$$/, ''); } catch (e) { /* clave mal copiada */ }
  var fuentes = [];
  if (/^[a-z0-9.-]+$/i.test(dominio)) fuentes.push('https://' + dominio + '/npm/@clerk/clerk-js@5/dist/clerk.browser.js');
  fuentes.push('https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/dist/clerk.browser.js');

  function cargar(i) {
    var s = document.createElement('script');
    s.id = 'clerk-js';
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.setAttribute('data-clerk-publishable-key', key);
    s.src = fuentes[i];
    s.onerror = function () {
      s.remove();
      if (i + 1 < fuentes.length) cargar(i + 1);
      else window.__clerkError = 'No se pudo descargar Clerk (' + fuentes.join(' / ') + '). Revise la conexión o un bloqueador de contenido.';
    };
    document.head.appendChild(s);
  }
  cargar(0);
})();
