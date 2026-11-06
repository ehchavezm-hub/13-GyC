const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(800);
  for (const ruta of ['plan']) {
    await p.goto(B + '?demo&y=' + ruta + '#/' + ruta); await p.waitForTimeout(1800);
    const fila = p.locator('.tabulator-row:has([tabulator-field="descripcion"])').first();
    const celda = fila.locator('[tabulator-field="descripcion"]');
    const h0 = Math.round((await fila.boundingBox()).height);
    await celda.dblclick(); await p.waitForTimeout(300);
    await p.keyboard.press('Control+A');
    await p.keyboard.type('Se tuvo una reunión larga con los encargados por la revisión del modelo y los planos de detalle de la estructura metálica');
    await p.keyboard.press('Enter'); await p.keyboard.type('Segunda línea');
    await p.locator('h1, .pagina-titulo, body').first().click({ position: { x: 5, y: 5 } }); await p.waitForTimeout(1200);
    const h1 = Math.round((await fila.boundingBox()).height);
    const texto = await celda.innerText();
    console.log(ruta, 'alto fila', h0, '→', h1, h1 > h0 + 15 ? 'OK crece' : 'FALLA', '· saltos de línea:', texto.includes('\n') ? 'sí' : 'no');
    await p.waitForTimeout(1500); await p.reload(); await p.waitForTimeout(1800);
    const t2 = await p.locator('.tabulator-row:has([tabulator-field="descripcion"])').first().locator('[tabulator-field="descripcion"]').innerText();
    console.log(ruta, 'guardado tras recargar:', t2.includes('Segunda línea') ? 'OK' : 'FALLA: ' + t2.slice(0, 60));
  }
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
