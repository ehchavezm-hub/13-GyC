const { chromium } = require('playwright');
const LAT = 200;
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1500);
  await p.evaluate(l => localStorage.setItem('lpsgt-latencia', l), String(LAT));
  for (const r of (process.argv[2] || '/plan').split(',')) {
    if (r === 'arranque') { await p.goto(B + '?demo#/plan'); await p.waitForTimeout(4000); }
    else { await p.evaluate(() => { window.__linea = []; }); await p.evaluate(h => { location.hash = h; }, '#' + r); await p.waitForTimeout(4000); }
    const l = await p.evaluate(() => window.__linea || []);
    const t0 = l.length ? Number(l[0].split(' ')[0]) : 0;
    console.log('== ' + r); console.log(l.map(x => { const [t, ...m] = x.split(' '); return `+${Number(t) - t0} ${m.join(' ')}`; }).join('\n'));
    await p.evaluate(() => { window.__linea = []; });
  }
  await b.close();
})();
