const { chromium } = require('playwright');
const BASE = 'http://localhost:8099/';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const chk = (c, m) => { console.log((c ? 'OK  ' : 'FALLA ') + m); if (!c) errs.push(m); };
  const fila = n => p.$$eval(`[data-tabla] tr:has(b:text-is("${n}")) select`, s => s.map(x => x.options[x.selectedIndex]?.textContent.trim()));
  await p.goto(BASE + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(BASE + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  await p.goto(BASE + '?demo#/equipo'); await p.waitForTimeout(1300);
  const base = await fila('Ana Torres');
  // poner Ana: martes Remoto, jueves Vacaciones
  const sel = await p.$$('[data-tabla] tr:has(b:text-is("Ana Torres")) select');
  const val = async (s, t) => s.$$eval('option', (o, t) => o.find(x => x.textContent.includes(t)).value, t);
  await sel[1].selectOption(await val(sel[1], 'Remoto')); await p.waitForTimeout(600);
  const sel2 = await p.$$('[data-tabla] tr:has(b:text-is("Ana Torres")) select');
  await sel2[3].selectOption(await val(sel2[3], 'Vacaciones')); await p.waitForTimeout(600);
  const actual = await fila('Ana Torres'); console.log('  semana actual Ana:', actual.join(', '));
  await p.click('[data-a="sig"]'); await p.waitForTimeout(1500);
  const sig = await fila('Ana Torres'); console.log('  semana siguiente Ana:', sig.join(', '));
  console.log('  toasts:', await p.$$eval('.toast', t => t.map(x => x.textContent).join(' | ')));
  chk(sig[1] === 'Remoto', 'hereda el martes Remoto');
  chk(!sig[3].includes('Vacaciones'), 'no hereda vacaciones');
  // borrar todo y verificar que no se re-hereda
  for (let i = 0; i < 5; i++) { const s = (await p.$$('[data-tabla] tr:has(b:text-is("Ana Torres")) select'))[i]; await s.selectOption(''); await p.waitForTimeout(500); }
  chk((await fila('Ana Torres')).every(x => x === '—'), 'si se borra a propósito, no vuelve a heredarse');
  // semana pasada no se toca
  await p.click('[data-a="hoy"]'); await p.waitForTimeout(800); await p.click('[data-a="ant"]'); await p.waitForTimeout(1200);
  console.log(errs.length ? 'ERRORES:\n' + errs.join('\n') : 'SIN ERRORES');
  await b.close();
})();
