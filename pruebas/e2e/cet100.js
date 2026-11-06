const { chromium } = require('playwright');
const B = 'http://localhost:8099/';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:has-text("Bruno Salas")'); await p.waitForTimeout(1200);
  let n = 0;
  for (const r of ['lookahead', 'plan', 'cartera']) {
    await p.goto(B + '?demo&y=' + r + '#/' + r); await p.waitForTimeout(2000);
    const btn = p.locator('[data-a="cet"]');
    if (!await btn.count()) { console.log(r, 'FALLA sin botón'); continue; }
    if (r === 'lookahead') await p.screenshot({ path: 'shots98/cet-boton.png', clip: { x: 240, y: 200, width: 900, height: 60 } });
    await btn.click(); await p.waitForTimeout(400);
    n++; await p.fill('.modal [name="codigo"]', 'CET-T' + n); await p.fill('.modal [name="valor"]', 'Servicio prueba ' + n);
    await p.click('.modal-pie .btn-primario'); await p.waitForTimeout(1200);
    const ok = await p.evaluate(c => { const d = JSON.parse(localStorage.getItem('lpsgt-demo-db')); return d.lista_valores.some(v => v.codigo === c); }, 'CET-T' + n);
    console.log(r, ok ? 'OK botón visible y CET agregado' : 'FALLA');
  }
  await p.evaluate(() => localStorage.removeItem('lpsgt-demo-usuario'));
  await p.goto(B + '?demo&x=2#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:has-text("Diego Paredes")'); await p.waitForTimeout(1200);
  await p.goto(B + '?demo&y=z#/lookahead'); await p.waitForTimeout(1800);
  console.log('Responsable de actividad:', await p.locator('[data-a="cet"]').count() ? 'FALLA ve el botón' : 'OK sin botón');
  console.log(errs.length ? errs : 'SIN ERRORES'); await b.close();
})();
