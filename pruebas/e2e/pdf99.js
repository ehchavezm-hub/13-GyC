const { chromium } = require('playwright');
const B = 'http://localhost:8099/';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  for (const r of ['tablero', 'equipo']) {
    await p.goto(B + '?demo&s=' + r + '#/' + r); await p.waitForTimeout(2500);
    await p.locator('button:has-text("PDF")').first().click(); await p.waitForTimeout(2000);
    const info = await p.evaluate(() => { const d = document.querySelector('.vista-pdf iframe').contentDocument;
      return [...d.querySelectorAll('table')].map(t => ({ fija: t.classList.contains('fija'), cols: t.querySelectorAll('col').length, filas: t.querySelectorAll('tbody tr').length, th: [...t.querySelectorAll('th')].map(x => x.textContent.trim()).join(' | '), primera: t.querySelector('tbody tr')?.textContent.replace(/\s+/g, ' ').trim().slice(0, 120) })); });
    console.log(r, JSON.stringify(info, null, 1));
    await p.evaluate(() => document.querySelector('.vista-pdf iframe').scrollIntoView());
    if (r === 'tablero') await p.evaluate(() => { const d = document.querySelector('.vista-pdf iframe').contentDocument; d.querySelectorAll('h2')[2]?.scrollIntoView(); });
    await p.screenshot({ path: `shots98/pdf-${r}.png` });
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  }
  console.log(errs.length ? errs : 'SIN ERRORES'); await b.close();
})();
