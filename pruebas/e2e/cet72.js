const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(800);
  // Códigos CET en dos servicios
  await p.evaluate(() => { const db = JSON.parse(localStorage.getItem('lpsgt-demo-db'));
    const l = db.listas.find(x => x.clave === 'servicios'); const vs = db.lista_valores.filter(v => v.lista_id === l.id);
    vs[0].codigo = 'CET-101'; vs[1].codigo = 'CET-202'; window.__s = [vs[0].valor, vs[1].valor];
    localStorage.setItem('lpsgt-demo-db', JSON.stringify(db)); localStorage.setItem('svc', JSON.stringify(window.__s)); });
  const [s0, s1] = await p.evaluate(() => JSON.parse(localStorage.getItem('svc')));
  for (const ruta of ['lookahead']) {
    await p.goto(B + '?demo&y=' + ruta + '#/' + ruta); await p.waitForTimeout(1800);
    const fila = p.locator('.tabulator-row:has([tabulator-field="_cet"])').first();
    // 1) Elegir CET → se completa el Servicio
    await fila.locator('[tabulator-field="_cet"]').dblclick(); await p.waitForTimeout(300);
    await p.locator('.tabulator-edit-list-item', { hasText: 'CET-202' }).first().click(); await p.waitForTimeout(800);
    const serv1 = await fila.locator('[tabulator-field="servicio_id"]').innerText(), cet1 = await fila.locator('[tabulator-field="_cet"]').innerText();
    console.log(ruta, 'CET elegido →', cet1, '/', serv1, serv1 === s1 && cet1 === 'CET-202' ? 'OK' : 'FALLA');
    // 2) Elegir Servicio → se muestra su CET
    await fila.locator('[tabulator-field="servicio_id"]').dblclick(); await p.waitForTimeout(300);
    await p.locator('.tabulator-edit-list-item', { hasText: s0 }).first().click(); await p.waitForTimeout(800);
    const serv2 = await fila.locator('[tabulator-field="servicio_id"]').innerText(), cet2 = await fila.locator('[tabulator-field="_cet"]').innerText();
    console.log(ruta, 'Servicio elegido →', cet2, '/', serv2, serv2 === s0 && cet2 === 'CET-101' ? 'OK' : 'FALLA');
    // 3) Se guardó: recargar y verificar
    await p.waitForTimeout(1500); await p.reload(); await p.waitForTimeout(1800);
    const cet3 = await p.locator('.tabulator-row:has([tabulator-field="_cet"])').first().locator('[tabulator-field="_cet"]').innerText();
    console.log(ruta, 'tras recargar CET =', cet3, cet3 === 'CET-101' ? 'OK' : 'FALLA');
    // 4) Filtro por CET
    await p.locator('.tabulator-col[tabulator-field="_cet"] input').fill('CET-101'); await p.waitForTimeout(600);
    console.log(ruta, 'filas con filtro CET-101:', await p.locator('.tabulator-row').count());
    await p.locator('.tabulator-col[tabulator-field="_cet"] input').fill('');
  }
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
