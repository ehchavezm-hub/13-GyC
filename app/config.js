// Configuración de conexión.
// La clave publicable (publishable) es pública por diseño: la seguridad está en las Vercel Functions.
// NUNCA escriba aquí la clave secreta de Clerk.
// Si se deja vacío, el aplicativo funciona en modo demostración (datos ficticios en el navegador).
window.GYC_CONFIG = {
  clerkPublishableKey: 'pk_test_YWRhcHRlZC10cm9sbC0zNDIxLmNsZXJrLmFjY291bnRzLmRldiQ',
  apiBase: '/api',
};

// Clerk v5 CDN requiere data-clerk-publishable-key en el <script> antes de ejecutarse.
// config.js corre sincrónicamente antes de que el script async de Clerk descargue y se ejecute.
(function () {
  var key = window.GYC_CONFIG.clerkPublishableKey;
  if (!key) return;
  var el = document.getElementById('clerk-js');
  if (el) el.setAttribute('data-clerk-publishable-key', key);
})();
