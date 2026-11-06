const { chromium } = require('playwright');
const BASE = 'http://localhost:8099/';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/404|ERR_FAILED|fonts/.test(m.text())) errs.push(m.text()); });
  await p.route('**/fonts.g*/**', r => r.abort());
  const chk = (c, m) => { console.log((c ? 'OK  ' : 'FALLA ') + m); if (!c) errs.push(m); };
  const db = () => p.evaluate(() => JSON.parse(localStorage.getItem('lpsgt-demo-db')));
  await p.goto(BASE + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(BASE + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  await p.goto(BASE + '?demo#/config/usuarios'); await p.waitForTimeout(1200);
  // crear usuario sin historial
  await p.click('[data-a="nuevo"]'); await p.waitForTimeout(300);
  await p.fill('.modal input[name="nombre"]', 'Temporal Uno'); await p.fill('.modal input[name="email"]', 'temp@x.pe');
  await p.click('.modal-pie button:has-text("Crear usuario")'); await p.waitForTimeout(1000);
  await p.click('.modal-pie button:has-text("Cerrar")');
  console.log('  botones 🗑:', await p.$$eval('[data-eliminar]', b => b.length), 'filas:', await p.$$eval('table.simple tr', t => t.length - 1));
  await p.click('tr:has-text("Temporal Uno") [data-eliminar]'); await p.waitForTimeout(300);
  await p.screenshot({ path: 'shots3/eliminar_confirm.png' });
  await p.click('.modal-pie button:has-text("Eliminar")'); await p.waitForTimeout(1200);
  chk(!(await db()).profiles.some(x => x.email === 'temp@x.pe'), 'sin historial: perfil borrado');
  // con historial
  const ana = (await db()).profiles.find(x => x.nombre === 'Ana Torres').id;
  await p.click('tr:has-text("Ana Torres") [data-eliminar]'); await p.waitForTimeout(300);
  await p.click('.modal-pie button:has-text("Eliminar")'); await p.waitForTimeout(1200);
  const a = (await db()).profiles.find(x => x.id === ana);
  chk(a && a.eliminado && !a.activo, 'con historial: perfil conservado como eliminado');
  chk(!(await p.textContent('table.simple')).includes('Ana Torres'), 'no aparece en la lista de usuarios');
  console.log('  toasts:', await p.$$eval('.toast', t => t.map(x => x.textContent).join(' | ')));
  await p.goto(BASE + '?demo#/plan'); await p.waitForTimeout(1300);
  chk(!(await p.$$eval('[data-resp] option', o => o.map(x => x.textContent).join())).includes('Ana Torres'), 'no aparece en selector de responsables');
  // delegado no ve eliminar
  await p.evaluate(() => localStorage.removeItem('lpsgt-demo-usuario'));
  await p.goto(BASE + '?demo&x=2#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(2)'); await p.waitForTimeout(1000);
  await p.goto(BASE + '?demo#/config/usuarios'); await p.waitForTimeout(1200);
  chk((await p.$$eval('[data-eliminar]', b => b.length)) === 0, 'delegado no puede eliminar');
  console.log(errs.length ? 'ERRORES:\n' + errs.join('\n') : 'SIN ERRORES');
  await b.close();
})();
