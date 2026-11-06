const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(800);
  // Vista guardada con días anchos (como la del usuario)
  await p.evaluate(() => { const db = JSON.parse(localStorage.getItem('lpsgt-demo-db')); const u = localStorage.getItem('lpsgt-demo-usuario');
    db.vistas = (db.vistas || []).filter(v => v.grilla !== 'plan');
    db.vistas.push({ id: crypto.randomUUID(), area_id: db.areas[0].id, usuario_id: u, grilla: 'plan', nombre: '__auto__',
      config: { columnas: [{ field: 'descripcion', visible: true }, { field: 'hh_lu', visible: true, width: 90 }, { field: 'hh_ma', visible: true, width: 90 }], orden: [], agrupar: '' } });
    localStorage.setItem('lpsgt-demo-db', JSON.stringify(db)); });
  // Semana pedida con una fecha que NO es lunes (miércoles 28/10/2026)
  await p.goto(B + '?demo&y=1#/plan?semana=2026-10-28'); await p.waitForTimeout(1800);
  const info = await p.$$eval('.tabulator-col[tabulator-field^="hh_"]', cs => cs.filter(c => c.offsetParent).map(c => [c.getAttribute('tabulator-field'), c.querySelector('.tabulator-col-title').textContent.trim(), Math.round(c.getBoundingClientRect().width), c.getAttribute('title') || c.querySelector('[title]')?.getAttribute('title') || '']));
  console.log(info.map(x => x.join(' ')).join('\n'));
  console.log('periodo:', (await p.textContent('body')).match(/S-\d+ · [0-9/]+ – [0-9/]+/)?.[0], '· url:', p.url().split('#')[1]);
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
