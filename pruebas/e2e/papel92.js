const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  await p.goto(B + '?demo'); await p.evaluate(() => { localStorage.clear(); });
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(800);
  await p.evaluate(() => localStorage.setItem('lpsgt-reportes', JSON.stringify({ papel: 'Carta' })));
  await p.goto(B + '?demo&y=1#/reportes'); await p.waitForTimeout(2000);
  console.log('opciones:', (await p.$$eval('[data-o="papel"] option', o => o.map(x => x.value))).join(', '), '· elegido:', await p.inputValue('[data-o="papel"]'));
  for (const papel of ['A6', 'A0']) {
    await p.selectOption('[data-o="papel"]', papel); await p.waitForTimeout(800);
    console.log(papel, '→', await p.evaluate(() => document.querySelector('[data-prev]').contentDocument.querySelector('style:nth-of-type(2)').textContent.match(/size: [^;]+/)[0]));
  }
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
