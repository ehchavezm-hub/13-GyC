const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  await p.evaluate(async () => { const { api } = await import('./js/data/api.js'); const { store } = await import('./js/core/store.js');
    await api.insert('portafolios', { area_id: store.area.id, nombre: 'Obras Industriales', estado: 'activo' }); });
  await p.goto(B + '?demo&a=1#/admin'); await p.waitForTimeout(1200);
  await p.click('.admin-item:has-text("Estructura de todas")'); await p.waitForTimeout(700);
  await p.click('[data-vista="arbol"]'); await p.waitForTimeout(400);
  for (const [sel, nuevo] of [['.org-portafolio:has-text("Obras Industriales")', 'Obras Industriales y Mineras'], ['.org-proyecto:has-text("Hospital Demo Norte")', null], ['.org-empresa', null]]) {
    await p.click(sel); await p.waitForTimeout(400);
    console.log('abre:', await p.locator('.modal h2').innerText());
    if (nuevo) { await p.locator('.modal [name="nombre"]').fill(nuevo); await p.click('.modal-pie .btn-primario'); await p.waitForTimeout(700); }
    else { await p.click('.modal-pie button:has-text("Cancelar")'); await p.waitForTimeout(300); }
  }
  console.log('sigue en organigrama:', await p.locator('.org-lienzo').count(), '· nombre nuevo:', await p.locator('.org-portafolio').first().innerText());
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
