const { chromium } = require('playwright');
const BASE = 'http://localhost:8099/';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  await p.goto(BASE + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(BASE + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  await p.goto(BASE + '?demo#/equipo'); await p.waitForTimeout(1300);
  const personas = await p.$$eval('[data-tabla] tr td:first-child b', b => b.map(x => x.textContent));
  const esperadas = await p.evaluate(() => JSON.parse(localStorage.getItem('lpsgt-demo-db')).profiles.filter(x => x.activo && !['consulta', 'pendiente'].includes(x.rol)).map(x => x.nombre).sort());
  console.log('  equipo:', personas.join(', '));
  console.log(JSON.stringify(personas) === JSON.stringify(esperadas) ? 'OK  aparecen todos (incluidos administradores)' : 'FALLA esperadas: ' + esperadas.join(', '));
  console.log(errs.length ? errs.join('\n') : 'SIN ERRORES');
  await b.close();
})();
