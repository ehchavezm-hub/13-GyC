# Librerías de terceros incluidas

| Archivo | Librería | Versión | Licencia |
|---|---|---|---|
| tabulator.min.js / .css | Tabulator (tabulator-tables) | 6.6.1 | MIT |
| chart.umd.min.js | Chart.js | 4.5.1 | MIT |
| xlsx.full.min.js | SheetJS Community Edition | 0.20.3 (corrige CVE-2023-30533 y CVE-2024-22363) | Apache-2.0 |
| html2pdf.bundle.min.js | html2pdf.js (incluye jsPDF y html2canvas; genera el PDF que se adjunta al enviar por correo) | 0.10.2 | MIT |
| qrcode.js | qrcode-generator (Kazuhiko Arase; QR del registro de asistencia de las actas) | 2.0.4 | MIT |
| sentry.min.js | @sentry/browser (paquete generado con esbuild desde `pruebas/sentry-entrada.js`; solo se descarga si hay SENTRY_DSN) | 11.9.0 | MIT |

Se incluyen en el repositorio para que el aplicativo no dependa de servicios externos y pueda funcionar sin conexión.
