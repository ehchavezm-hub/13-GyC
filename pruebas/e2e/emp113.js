const { chromium } = require('playwright');
const B = 'http://localhost:8099/';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errs = [], fallas = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const chk = (c, m) => { console.log((c ? 'OK  ' : 'FALLA ') + m); if (!c) fallas.push(m); };
  const entrar = async texto => {
    await p.evaluate(() => localStorage.removeItem('lpsgt-demo-usuario'));
    await p.goto(B + '?demo&e=' + Math.random() + '#/'); await p.waitForSelector('.usuarios-demo button');
    await p.click(`.usuarios-demo button:has-text("${texto}")`); await p.waitForTimeout(1300);
  };
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await entrar('Gerente Técnico (demo)');
  await p.goto(B + '?demo&a=1#/config/empresas'); await p.waitForTimeout(1500);
  chk(await p.locator('[data-s="empresas"]').count() === 1, 'el administrador de la plataforma ve la pestaña Empresas');
  await p.click('[data-a="nueva"]'); await p.waitForTimeout(400);
  await p.fill('.modal [name="nombre_empresa"]', 'Constructora Andina'); await p.fill('.modal [name="descripcion"]', 'Minería');
  await p.fill('.modal [name="nombre"]', 'Ana Andina'); await p.fill('.modal [name="email"]', 'ana@andina.pe'); await p.fill('.modal [name="clave"]', 'Temporal123');
  await p.click('.modal-pie .btn-primario'); await p.waitForTimeout(1500);
  const filas = await p.$$eval('table.simple tr', t => t.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
  console.log('  ' + filas.join('\n  '));
  chk(filas.some(f => f.includes('Constructora Andina') && f.includes('Ana Andina')), 'la empresa nueva aparece con su administrador');
  // Entrar como el administrador de la empresa nueva
  await entrar('Ana Andina');
  console.log('  pantalla:', (await p.locator('body').innerText()).slice(0, 200).replace(/\s+/g, ' '));
  if (await p.locator('input[type="password"]').count()) { const c = p.locator('input[type="password"]'); for (let i = 0; i < await c.count(); i++) await c.nth(i).fill('NuevaClave123'); await p.locator('button[type="submit"]').first().click(); await p.waitForTimeout(1500); }
  chk(/Constructora Andina/.test(await p.locator('.cab-area').innerText()), 'cabecera con el nombre de la empresa nueva');
  const sinDatos = await p.evaluate(() => (window.__store || null));
  await p.goto(B + '?demo&a=2#/config/usuarios'); await p.waitForTimeout(1500);
  const usuarios = await p.$$eval('table.simple', ts => [...ts[0].querySelectorAll('tr td:first-child')].map(x => x.textContent.trim()).filter(Boolean));
  chk(usuarios.length === 1 && usuarios[0].includes('Ana Andina'), 'solo ve a los usuarios de su empresa: ' + usuarios.join(', '));
  chk(await p.locator('[data-s="empresas"]').count() === 0, 'el administrador de la empresa no ve la pestaña Empresas');
  await p.goto(B + '?demo&a=3#/config/listas?lista=gerencias'); await p.waitForTimeout(1500);
  const ger = await p.evaluate(() => { const t = Tabulator.findTable('.grilla-tabla')[0]; return t ? t.getData().filter(r => r.id).length : -1; });
  chk(ger === 0, 'la lista de gerencias de la empresa nueva empieza vacía (' + ger + ')');
  await p.goto(B + '?demo&a=4#/config/listas?lista=estados_la'); await p.waitForTimeout(1500);
  const est = await p.evaluate(() => { const t = Tabulator.findTable('.grilla-tabla')[0]; return t ? t.getData().filter(r => r.id).length : -1; });
  chk(est === 5, 'tiene los estados del Look Ahead (' + est + ')');
  await p.goto(B + '?demo&a=5#/plan'); await p.waitForTimeout(1800);
  const filasPlan = await p.evaluate(() => { const t = Tabulator.findTable('[data-grilla] .tabulator')[0] || Tabulator.findTable('[data-grilla]')[0]; return t.getData().filter(r => r.id).length; });
  chk(filasPlan === 0, 'su Plan semanal no muestra actividades de la otra empresa (' + filasPlan + ')');
  const proys = await p.$$eval('.proy-item', x => x.map(i => i.textContent.replace(/\s+/g, ' ').trim()));
  console.log('  menú de proyectos:', proys.join(' | '));
  chk(proys.every(t => /Todos los proyectos/.test(t)), 'su menú de proyectos no tiene proyectos de la otra empresa');
  // Desactivar la empresa
  await entrar('Gerente Técnico (demo)');
  await p.goto(B + '?demo&a=6#/config/empresas'); await p.waitForTimeout(1500);
  await p.locator('[data-estado]').first().click(); await p.waitForTimeout(300);
  await p.locator('.modal .btn-peligro, .modal-pie .btn-primario').last().click(); await p.waitForTimeout(1200);
  chk(await p.locator('table.simple tr', { hasText: 'Desactivada' }).count() === 1, 'empresa desactivada');
  await entrar('Ana Andina');
  chk(/desactivada/i.test(await p.locator('body').innerText()), 'su administrador ya no puede ingresar');
  // Otro administrador (no de plataforma) no ve Empresas
  await entrar('Diana Rojas');
  await p.goto(B + '?demo&a=7#/config/empresas'); await p.waitForTimeout(1200);
  chk(await p.locator('[data-s="empresas"]').count() === 0, 'el delegado no ve Empresas');
  console.log(fallas.length ? 'FALLAS: ' + fallas.length : 'TODO OK');
  console.log(errs.length ? errs : 'SIN ERRORES'); await b.close();
})();
