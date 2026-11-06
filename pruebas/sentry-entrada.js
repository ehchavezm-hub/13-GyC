// Entrada para generar app/vendor/sentry.min.js (ver verificar-librerias.mjs y app/vendor/LICENCIAS.md)
export { init, captureException, captureMessage, startSpan, setUser, setTag, withScope, browserTracingIntegration, flush } from '@sentry/browser';
