const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = process.env.B || 'http://localhost:8099/';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  await p.goto(B + '?demo&a=1#/admin'); await p.waitForTimeout(300);
  await p.evaluate(async () => { const { api } = await import('./js/data/api.js'); const orig = api.adminUsuarios.bind(api); window.__n = 0;
    api.adminUsuarios = (...a) => { window.__n++; return orig(...a); }; });
  for (const t of ['Resumen', 'Empresas', 'Usuarios', 'Estructura de todas', 'Propietarios', 'Reportes', 'Empresas', 'Estructura de todas']) {
    await p.locator('.admin-item', { hasText: t }).first().click(); await p.waitForTimeout(400);
  }
  console.log('llamadas al servidor en 8 cambios de panel:', await p.evaluate(() => window.__n));
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
