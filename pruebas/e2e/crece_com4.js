const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1880, height: 730 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = process.env.B || 'http://localhost:8099/';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(800);
  for (const ruta of ['plan']) { for (const n of [0,1,2,3,4]) {
    await p.goto(B + '?demo&y=' + ruta + '#/' + ruta); await p.waitForTimeout(1800);
    console.log(await p.evaluate(() => { const t = Tabulator.findTable('.tabulator')[0]; const c = t.getColumns().find(c => c.getField() === 'proyecto_id' || c.getField()==='semana'); const r = c?.getField(); t.getColumn('comentario').setWidth(180); return 'ok ' + r; }));
    await p.waitForTimeout(800);
    { const f0 = p.locator('.tabulator-row:has([tabulator-field="descripcion"])').nth(n).locator('[tabulator-field="descripcion"]');
      await f0.dblclick(); await p.waitForTimeout(200); await p.keyboard.press('Control+A');
      await p.keyboard.type('Actividad larga con muchas palabras para que ocupe varias líneas dentro de la celda de actividad del plan semanal'); await p.keyboard.press('Enter'); await p.waitForTimeout(800); }
    const fila = p.locator('.tabulator-row:has([tabulator-field="comentario"])').nth(n);
    const celda = fila.locator('[tabulator-field="comentario"]');
    await celda.scrollIntoViewIfNeeded(); await celda.dblclick(); await p.waitForTimeout(200); console.log('ancho celda/caja', Math.round((await celda.boundingBox()).width), Math.round((await p.locator('.tabulator-cell textarea').boundingBox()).width));
    await p.keyboard.press('Control+A');
    const alturas = [];
    for (const parte of ['Se tuvo una reunión larga ', 'con los encargados por la revisión ', 'del modelo y los planos de detalle ', 'de la estructura metálica del edificio']) {
      await p.keyboard.type(parte); await p.waitForTimeout(150);
      alturas.push(Math.round((await p.locator('.tabulator-cell textarea').boundingBox()).height) + '/' + Math.round((await fila.boundingBox()).height));
    }
    await p.keyboard.press('Alt+Enter'); await p.keyboard.type('Segunda línea'); await p.waitForTimeout(150);
    alturas.push(Math.round((await p.locator('.tabulator-cell textarea').boundingBox()).height) + '/' + Math.round((await fila.boundingBox()).height));
    console.log(ruta, n, 'caja/fila mientras se escribe:', alturas.join(' → '));
    await p.keyboard.press('Enter'); await p.waitForTimeout(1500);
    const editando = await p.locator('.tabulator-cell textarea').count();
    await p.reload(); await p.waitForTimeout(1800);
    const t = await p.locator('.tabulator-row:has([tabulator-field="comentario"])').nth(n).locator('[tabulator-field="comentario"]').innerText();
    console.log(ruta, 'Enter guardó:', editando === 0 && t.includes('metálica') && t.includes('Segunda línea') ? 'OK' : 'FALLA ' + t);
  }
  }
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
