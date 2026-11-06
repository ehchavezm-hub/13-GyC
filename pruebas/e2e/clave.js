const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  await p.goto('http://localhost:8099/?demo'); await p.waitForTimeout(800);
  const r = await p.evaluate(async () => { const { mensajeError } = await import('./js/data/api.js');
    return [mensajeError(new Error('Password is known to be weak and easy to guess, please choose a different one.')), mensajeError({ message: 'weak_password' }), mensajeError(new Error('Invalid login credentials'))]; });
  console.log(r.join('\n')); console.log(errs.length ? errs : 'SIN ERRORES'); await b.close();
})();
