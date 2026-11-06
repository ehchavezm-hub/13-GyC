const { chromium } = require('playwright');
const BASE = 'http://localhost:8099/';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const chk = (c, m) => { console.log((c ? 'OK  ' : 'FALLA ') + m); if (!c) errs.push(m); };
  const entrar = async nombre => {
    await p.evaluate(() => localStorage.removeItem('lpsgt-demo-usuario'));
    await p.goto(BASE + '?demo&x=' + Date.now() + '#/'); await p.waitForSelector('.usuarios-demo button');
    await p.click(`.usuarios-demo button:has-text("${nombre}")`); await p.waitForTimeout(1000);
  };
  await p.goto(BASE + '?demo'); await p.evaluate(() => localStorage.clear());
  await entrar('Gerente Técnico');
  chk((await p.textContent('.usuarios-demo, body')).length > 0, 'ingresa');
  await p.goto(BASE + '?demo#/config/usuarios'); await p.waitForTimeout(1200);
  chk((await p.textContent('tr:has-text("Gerente Técnico")')).includes('Super administrador'), 'principal es Super administrador');
  // Hacer administrador a Bruno
  await p.click('tr:has-text("Bruno Salas") [data-editar]'); await p.waitForTimeout(300);
  await p.selectOption('.modal select[name="rol"]', 'admin'); await p.click('.modal-pie button:has-text("Guardar")'); await p.waitForTimeout(1000);
  chk((await p.textContent('tr:has-text("Bruno Salas")')).includes('Administrador'), 'Bruno ahora es Administrador');
  // Matriz: columna Administrador editable por el super
  await p.goto(BASE + '?demo#/config/permisos'); await p.waitForTimeout(1000);
  const sel = 'input[data-r="admin"][data-acc="gestionar_listas"]';
  chk(!(await p.$eval(sel, i => i.disabled)) && await p.$eval(sel, i => i.checked), 'super edita columna Administrador (marcada por defecto)');
  await p.click(sel); await p.waitForTimeout(800);
  await p.screenshot({ path: 'shots3/matriz_super.png' });
  // Bruno (admin) no puede editar su columna ni gestionar listas
  await entrar('Bruno Salas');
  await p.goto(BASE + '?demo#/config/permisos'); await p.waitForTimeout(1000);
  chk(await p.$eval(sel, i => i.disabled), 'admin no edita su propia columna');
  chk(!(await p.$eval('input[data-r="delegado"][data-acc="comentar"]', i => i.disabled)), 'admin sí edita la columna del delegado');
  await p.goto(BASE + '?demo#/config/listas'); await p.waitForTimeout(1000);
  chk(!(await p.$('[data-a="nueva"]')), 'admin sin permiso de listas no crea listas');
  await p.goto(BASE + '?demo#/config/usuarios'); await p.waitForTimeout(1000);
  const ops = await (async () => { await p.click('[data-a="nuevo"]'); await p.waitForTimeout(300); const o = await p.$$eval('.modal select[name="rol"] option', x => x.map(y => y.value)); await p.click('.modal [data-cerrar]'); return o; })();
  chk(!ops.includes('superadmin') && !ops.includes('admin') && !ops.includes('delegado'), 'admin no asigna roles de gestión: ' + ops.join(','));
  chk(!(await p.$('tr:has-text("Gerente Técnico") [data-eliminar]')), 'admin no puede eliminar al super');
  console.log(errs.length ? 'ERRORES:\n' + errs.join('\n') : 'SIN ERRORES');
  await b.close();
})();
