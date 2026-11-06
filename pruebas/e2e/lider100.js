const { chromium } = require('playwright');
const B = 'http://localhost:8099/';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errs = [], fallas = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const chk = (c, m) => { console.log((c ? 'OK  ' : 'FALLA ') + m); if (!c) fallas.push(m); };
  const db = () => p.evaluate(() => JSON.parse(localStorage.getItem('lpsgt-demo-db')));
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:has-text("Bruno Salas")'); await p.waitForTimeout(1200);
  // 1. Agregar proyecto desde el ＋ del menú de proyectos: queda activo, no "propuesto"
  chk(await p.locator('[data-a="nuevo-proy"]').count() === 1, 'el líder ve ＋ en el menú de proyectos');
  await p.click('[data-a="nuevo-proy"]'); await p.waitForTimeout(500);
  console.log('  título:', (await p.locator('.modal h2, .modal-cab').first().innerText()).trim());
  await p.fill('.modal [name="codigo"]', 'L-777'); await p.fill('.modal [name="nombre_corto"]', 'Proyecto del líder');
  const ger = await p.$$eval('.modal [name="gerencia_id"] option', o => o.map(x => x.value).filter(Boolean)[0]);
  await p.selectOption('.modal [name="gerencia_id"]', ger);
  await p.click('.modal-pie .btn-primario'); await p.waitForTimeout(1500);
  const pr = (await db()).proyectos.find(x => x.codigo === 'L-777');
  chk(pr && pr.estado === 'activo', 'proyecto agregado como activo: ' + pr?.estado);
  chk(await p.locator('.proy-lista', { hasText: 'Proyecto del líder' }).count() > 0, 'aparece en "Mis" proyectos de quien lo agregó');
  await p.click('.menu-proy [data-p="todos"]'); await p.waitForTimeout(300);
  chk(await p.locator('.proy-lista', { hasText: 'Proyecto del líder' }).count() > 0, 'y en "Todos" (lo ve todo el equipo)');
  // 2. Agregar CET / Servicio con clic derecho en el título CET del Look Ahead
  await p.goto(B + '?demo&y=1#/lookahead'); await p.waitForTimeout(2000);
  await p.click('.tabulator-col[tabulator-field="_cet"] .tabulator-col-title', { button: 'right' }); await p.waitForTimeout(300);
  const items = await p.$$eval('.tabulator-menu .tabulator-menu-item', i => i.map(x => x.textContent.trim()));
  chk(items.some(t => t.includes('Agregar CET / Servicio')) && !items.some(t => t.includes('editar o eliminar')), 'menú del título CET: ' + items.join(' | '));
  await p.locator('.tabulator-menu .tabulator-menu-item', { hasText: 'Agregar CET / Servicio' }).click(); await p.waitForTimeout(500);
  await p.selectOption('.modal [name="proyecto_id"]', pr.id);
  await p.fill('.modal [name="codigo"]', 'CET-L777'); await p.fill('.modal [name="valor"]', 'Servicio del líder');
  await p.click('.modal-pie .btn-primario'); await p.waitForTimeout(1500);
  const d = await db(); const l = d.listas.find(x => x.clave === 'servicios');
  const v = d.lista_valores.find(x => x.lista_id === l.id && x.codigo === 'CET-L777');
  chk(v && v.valor === 'Servicio del líder' && v.extra?.proyecto_id === pr.id, 'CET / Servicio agregado y asociado al proyecto');
  // CET repetido: avisa
  await p.click('.tabulator-col[tabulator-field="servicio_id"] .tabulator-col-title', { button: 'right' }); await p.waitForTimeout(300);
  await p.locator('.tabulator-menu .tabulator-menu-item', { hasText: 'Agregar CET / Servicio' }).click(); await p.waitForTimeout(400);
  await p.fill('.modal [name="codigo"]', 'cet-l777'); await p.fill('.modal [name="valor"]', 'Otro');
  await p.click('.modal-pie .btn-primario'); await p.waitForTimeout(800);
  const msg = (await p.locator('.toast, .toasts').allInnerTexts().catch(() => [])).join(' ') + (await p.locator('.modal').count() ? ' [ventana abierta]' : '');
  chk(/ya existe/i.test(msg) && msg.includes('[ventana abierta]'), 'CET repetido: avisa que ya existe y deja corregirlo');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  // 3. En la fila, al elegir el proyecto nuevo aparece su CET
  const fila = p.locator('.tabulator-row:has([tabulator-field="_cet"])').first();
  await fila.locator('[tabulator-field="proyecto_id"]').dblclick(); await p.waitForTimeout(300);
  await p.locator('.tabulator-edit-list-item', { hasText: 'L-777' }).first().click(); await p.waitForTimeout(800);
  chk((await fila.locator('[tabulator-field="_cet"]').innerText()).trim() === 'CET-L777', 'al elegir el proyecto se completa su CET');
  // 4. Un Responsable de actividad no tiene estas opciones
  await p.evaluate(() => localStorage.removeItem('lpsgt-demo-usuario'));
  await p.goto(B + '?demo&x=2#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:has-text("Diego Paredes")'); await p.waitForTimeout(1200);
  chk(await p.locator('[data-a="nuevo-proy"]').count() === 0, 'Responsable de actividad: sin ＋ de proyectos');
  await p.click('.menu-proy [data-p="todos"]'); await p.waitForTimeout(300);
  chk(await p.locator('.proy-lista', { hasText: 'Proyecto del líder' }).count() > 0, 'otro usuario también ve el proyecto del líder');
  console.log(fallas.length ? 'FALLAS: ' + fallas.length : 'TODO OK');
  console.log(errs.length ? errs : 'SIN ERRORES'); await b.close();
})();
