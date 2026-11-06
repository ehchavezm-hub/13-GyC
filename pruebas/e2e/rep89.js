const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(800);
  await p.goto(B + '?demo&y=1#/reportes'); await p.waitForTimeout(2500);
  const ids = await p.$$eval('[data-r]', bs => bs.map(x => [x.dataset.r, x.textContent]));
  console.log('reportes en el árbol:', ids.length);
  for (const [id, t] of ids) {
    await p.click(`[data-r="${id}"]`); await p.waitForTimeout(1300);
    const fr = p.frameLocator('[data-prev]');
    const info = await p.evaluate(() => { const d = document.querySelector('[data-prev]').contentDocument; return d ? [d.querySelectorAll('table').length, d.querySelectorAll('svg').length, d.querySelectorAll('tbody tr').length, d.querySelector('h1')?.textContent] : null; });
    console.log(`${t.padEnd(45)} tablas ${info?.[0]} · gráficos ${info?.[1]} · filas ${info?.[2]} · título "${info?.[3]}"`);
  }
  await p.click('[data-r="ejecutivo"]'); await p.waitForTimeout(1500);
  await p.screenshot({ path: require('path').join(__dirname, 'salida') + '/' + 'rep_ejec.png' }).catch(() => {});
  await p.click('[data-r="lookahead"]'); await p.waitForTimeout(1500);
  await p.waitForTimeout(500);
  const z = await p.evaluate(() => document.querySelector('[data-prev]').contentDocument.getElementById('contenido').style.zoom);
  console.log('Todo en 1 hoja → zoom', z);
  await p.screenshot({ path: require('path').join(__dirname, 'salida') + '/' + 'rep_la.png' }).catch(() => {});
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
