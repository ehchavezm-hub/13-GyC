const { chromium } = require('playwright');
const BASE = 'http://localhost:8099/';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const chk = (c, m) => { console.log((c ? 'OK  ' : 'FALLA ') + m); if (!c) errs.push(m); };
  await p.goto(BASE + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(BASE + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  await p.goto(BASE + '?demo#/config/listas'); await p.waitForTimeout(1200);
  const g = await p.$$eval('[data-l] optgroup:first-child option', o => o.map(x => x.textContent));
  console.log('  primer grupo:', g.join(' | '));
  chk(g[2] === 'CET / Servicio' && !g.some(x => x.startsWith('CET (')), 'CET / Servicio en lugar de las dos listas');
  await p.selectOption('[data-l]', 'servicios'); await p.waitForTimeout(1000);
  const cols = await p.$$eval('.tabulator-col-title', t => t.map(x => x.textContent).filter(Boolean));
  chk(cols.includes('Proyecto') && !cols.includes('Descripción') && !cols.includes('Color'), 'columnas: ' + cols.join(', '));
  const n = await p.evaluate(() => Tabulator.findTable('.grilla-tabla')[0].getDataCount());
  chk(n > 3, 'conserva los datos de servicios (' + n + ' valores)');
  await p.goto(BASE + '?demo#/plan'); await p.waitForTimeout(1300);
  const pc = await p.$$eval('.tabulator-col-title', t => t.map(x => x.textContent).filter(Boolean));
  chk(pc.includes('CET / Servicio') && !pc.includes('CET') && !pc.includes('Servicio / Entregable'), 'plan muestra CET / Servicio');
  // datos viejos del navegador se renombran
  await p.evaluate(() => { const db = JSON.parse(localStorage.getItem('lpsgt-demo-db')); db.listas.find(l => l.clave === 'servicios').nombre = 'Servicios / Entregables'; localStorage.setItem('lpsgt-demo-db', JSON.stringify(db)); });
  await p.goto(BASE + '?demo&y=1#/config/listas'); await p.waitForTimeout(1500);
  chk((await p.$$eval('[data-l] option', o => o.map(x => x.textContent))).includes('CET / Servicio'), 'datos demo existentes renombrados');
  console.log(errs.length ? 'ERRORES:\n' + errs.join('\n') : 'SIN ERRORES');
  await b.close();
})();
