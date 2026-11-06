// Configuración de conexión.
// La clave publicable (publishable) es pública por diseño: la seguridad está en las Vercel Functions.
// NUNCA escriba aquí la clave secreta de Clerk.
// Si se deja vacío, el aplicativo funciona en modo demostración (datos ficticios en el navegador).
window.GYC_CONFIG = {
  clerkPublishableKey: 'pk_test_YWRhcHRlZC10cm9sbC0zNDIxLmNsZXJrLmFjY291bnRzLmRldiQ',
  apiBase: '/api',
};

// Carga Clerk (v5) con la clave de arriba: única fuente de la clave publicable (index.html no la repite).
// Clerk v5 lee data-clerk-publishable-key del <script> al ejecutarse, por eso el atributo va antes del src.
(function () {
  var key = window.GYC_CONFIG.clerkPublishableKey;
  var demo = /[?&]demo(=|&|$)/.test(location.search);
  try { demo = demo || localStorage.getItem('gyc-modo') === 'demo'; } catch (e) { /* sin almacenamiento */ }
  if (!key || demo) return;
  var s = document.createElement('script');
  s.id = 'clerk-js';
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.setAttribute('data-clerk-publishable-key', key);
  s.src = 'https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/dist/clerk.browser.js';
  document.head.appendChild(s);
})();
