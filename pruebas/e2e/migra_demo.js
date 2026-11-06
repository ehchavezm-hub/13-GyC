const { chromium } = require('playwright');
const BASE = 'http://localhost:8099/';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  await p.goto(BASE + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(BASE + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button');
  // simular datos viejos: principal con rol admin
  await p.evaluate(() => { const db = JSON.parse(localStorage.getItem('lpsgt-demo-db')); db.profiles.find(x => x.es_admin_principal).rol = 'admin'; localStorage.setItem('lpsgt-demo-db', JSON.stringify(db)); });
  await p.goto(BASE + '?demo&x=2#/'); await p.waitForSelector('.usuarios-demo button');
  await p.click('.usuarios-demo button:has-text("Gerente Técnico")'); await p.waitForTimeout(1000);
  await p.goto(BASE + '?demo#/config/usuarios'); await p.waitForTimeout(1200);
  console.log((await p.textContent('tr:has-text("Gerente Técnico")')).includes('Super administrador') ? 'OK datos viejos actualizados' : 'FALLA');
  console.log(errs.length ? errs.join('\n') : 'SIN ERRORES');
  await b.close();
})();
