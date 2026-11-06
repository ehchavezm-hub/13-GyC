const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  const S = require('path').join(__dirname, 'salida') + '/' + '';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(800);
  await p.goto(B + '?demo&y=1#/lookahead'); await p.waitForTimeout(1800);
  const ancho = () => p.evaluate(() => Math.round(document.querySelector('.lateral').getBoundingClientRect().width));
  const filaAlto = () => p.evaluate(() => Math.round(document.querySelector('.tabulator-row:not(.tabulator-group)').getBoundingClientRect().height));
  console.log('inicio: lateral', await ancho(), '· fila', await filaAlto());
  // (B) arrastrar el borde
  const t = await p.locator('.lateral-tirador').boundingBox();
  await p.mouse.move(t.x + 3, t.y + 300); await p.mouse.down(); await p.mouse.move(t.x + 103, t.y + 300, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(300);
  console.log('tras arrastrar +100:', await ancho());
  // (C) contraer con ☰
  await p.click('[data-a="menu"]'); await p.waitForTimeout(400);
  console.log('contraído:', await ancho(), '· textos ocultos:', await p.locator('.nav a .txt').first().isHidden());
  await p.screenshot({ path: S + 'v93_contraido.png' });
  await p.reload(); await p.waitForTimeout(1800);
  console.log('recuerda tras recargar:', await ancho());
  await p.click('[data-a="menu"]'); await p.waitForTimeout(300);
  console.log('expandido de nuevo:', await ancho());
  // (A) letra grande
  await p.click('[data-a="letra-grande"]'); await p.waitForTimeout(500);
  console.log('A+: fila', await filaAlto(), '· letra', await p.evaluate(() => getComputedStyle(document.querySelector('.tabulator')).fontSize));
  await p.screenshot({ path: S + 'v93_grande.png' });
  await p.click('[data-a="letra-normal"]'); await p.waitForTimeout(400);
  console.log('A: fila', await filaAlto());
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
