// Pedido d3: «Sub-proyecto» se llama «Grupo LPS» en todo el aplicativo. Recorre pantallas, paneles de Administración,
// formularios, tooltips, opciones de listas y exportaciones, y falla si aparece «sub-proyecto» en algo visible.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  const VIEJO = /sub[-\s]?proyect/i;
  const hallazgos = [];
  const revisar = async donde => {
    const r = await p.evaluate(() => {
      const t = [document.body.innerText];
      document.querySelectorAll('[title],[aria-label],[placeholder],option,[data-tip]').forEach(e =>
        t.push(e.getAttribute('title') || '', e.getAttribute('aria-label') || '', e.getAttribute('placeholder') || '', e.tagName === 'OPTION' ? e.textContent : '', e.getAttribute('data-tip') || ''));
      return t.join('\n');
    });
    const m = r.split('\n').filter(l => /sub[-\s]?proyect/i.test(l));
    if (m.length) hallazgos.push(`${donde}: ${[...new Set(m)].slice(0, 3).join(' | ').slice(0, 200)}`);
  };
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  // Un Grupo LPS creado desde el formulario del menú lateral («+ Agregar»)
  await p.click('[data-a="nuevo-proy"]'); await p.waitForTimeout(400);
  await revisar('formulario + Agregar');
  const m = p.locator('.modal').last();
  console.log('título del formulario:', (await m.locator('.modal-cab, h2, h3').first().innerText()).trim());
  await m.locator('[name="codigo"]').fill('G-1'); await m.locator('[name="nombre_corto"]').fill('Equipo Gestión');
  const padre = m.locator('[name="padre_id"]'); if (await padre.count()) await padre.selectOption({ index: 1 });
  await p.click('.modal-pie .btn-primario'); await p.waitForTimeout(900);
  console.log('aviso:', (await p.locator('.toast').allInnerTexts()).slice(-1)[0]);
  await revisar('menú lateral');
  console.log('cabecera del menú:', (await p.locator('.menu-proy-cab h3').innerText()).trim());
  // se elige el Grupo LPS en el menú
  await p.locator('.proy-item.arbol-sub').first().click(); await p.waitForTimeout(600);
  for (const r of ['/plan', '/lookahead', '/restricciones', '/cartera', '/tablero', '/reunion', '/equipo', '/plantillas', '/reportes', '/config/listas?lista=__proyectos', '/config/usuarios', '/config/importar', '/config/respaldo', '/config/parametros', '/config/permisos', '/config/columnas', '/config/auditoria', '/mejoras', '/ayuda', '/proyectos']) {
    await p.goto(B + '?demo#' + r); await p.waitForTimeout(1300); await revisar(r);
  }
  // Administración: cada panel de la plataforma y de la empresa, con ambas pestañas de estructura
  await p.goto(B + '?demo&a=1#/admin'); await p.waitForTimeout(1200);
  console.log('barra superior:', (await p.locator('.admin-migas').innerText()).replace(/\s+/g, ' ').slice(0, 160));
  const paneles = (await p.locator('.admin-item').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());
  for (let i = 0; i < paneles.length; i++) { const t = paneles[i];
    await p.locator('.admin-item').nth(i).click(); await p.waitForTimeout(700); await revisar('Admin › ' + t.trim());
    if (await p.locator('[data-vista="arbol"]').count()) { await p.click('[data-vista="arbol"]'); await p.waitForTimeout(500); await revisar('Admin › ' + t.trim() + ' › jerárquica'); await p.click('[data-vista="tabla"]'); await p.waitForTimeout(400); }
  }
  // botón «+ Grupo LPS» y su formulario
  await p.locator('.admin-item', { hasText: 'Estructura de todas' }).click(); await p.waitForTimeout(600);
  const boton = p.locator('[data-a="nuevo-sub"]'); console.log('botón:', (await boton.innerText()).trim());
  await boton.click(); await p.waitForTimeout(400); await revisar('formulario Nuevo Grupo LPS');
  console.log('formulario:', (await p.locator('.modal').last().innerText()).replace(/\s+/g, ' ').slice(0, 120));
  await p.locator('.modal-pie button:has-text("Cancelar")').last().click().catch(() => {}); await p.waitForTimeout(300);
  // Descargar XLS: cabeceras
  const bx = p.locator('button:has-text("Descargar XLS")');
  if (await bx.count()) {
    const [d] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), bx.first().click()]);
    const XLSX = require(require('path').join(__dirname, '..', '..', 'app', 'vendor', 'xlsx.full.min.js'));
    const wb = XLSX.read(require('fs').readFileSync(await d.path()), { type: 'buffer' }); const cab = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 })[0];
    console.log('cabeceras XLS:', cab.join(' | '));
    if (cab.some(c => VIEJO.test(c))) hallazgos.push('XLS: ' + cab.join(' | '));
  }
  console.log(hallazgos.length ? 'APARECE «sub-proyecto»:\n  ' + hallazgos.join('\n  ') : 'Ningún «sub-proyecto» visible');
  console.log(errs.length || hallazgos.length ? ['ERRORES', ...errs] : 'SIN ERRORES');
  await b.close();
})();
