const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
  const errs = [];
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await p.route('**/fonts.googleapis.com/**', r => r.abort());
  await p.goto(process.argv[2] || 'http://localhost:8099/?demo', { waitUntil: 'load' });
  await p.waitForTimeout(800);
  await p.click('.usuarios-demo button:nth-child(3)');
  await p.waitForTimeout(2500);
  await p.screenshot({ path: process.argv[3] || 'shot.png' });
  console.log('URL', p.url());
  console.log((await p.textContent('body')).slice(0, 600).replace(/\s+/g, ' '));
  console.log(errs.join('\n'));
  await b.close();
})();
