const { chromium } = require('playwright');
const SH = require('path').join(__dirname, 'salida') + '/' + '';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const p = await (await b.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/fonts.g*/**', r => r.abort());
  const B = 'http://localhost:8099/';
  await p.goto(B + '?demo'); await p.evaluate(() => localStorage.clear());
  await p.goto(B + '?demo&x=1#/'); await p.waitForSelector('.usuarios-demo button'); await p.click('.usuarios-demo button:nth-child(1)'); await p.waitForTimeout(1000);
  await p.goto(B + '?demo&a=1#/admin'); await p.waitForTimeout(1200);
  const guardar = async () => { await p.click('.modal-pie .btn-primario'); await p.waitForTimeout(600); };
  const llenar = async (n, v) => { const el = p.locator(`.modal [name="${n}"]`).first(); const tag = await el.evaluate(e => e.tagName); if (tag === 'SELECT') await el.selectOption({ label: v }); else await el.fill(v); };
  // empresa nueva con portafolio > programa > proyecto > Grupo LPS
  await p.click('.admin-item:has-text("Empresas")'); await p.waitForTimeout(500);
  await p.click('[data-a="nueva"]'); await p.waitForTimeout(300); await llenar('nombre_empresa', 'Constructora Andina'); await guardar();
  await p.click('.admin-item:has-text("Estructura de todas")'); await p.waitForTimeout(800);
  const emp = p.locator('.est-empresa:has-text("Constructora Andina")');
  await emp.locator('[data-nuevo="portafolios"]').click(); await p.waitForTimeout(300); await llenar('nombre', 'POR'); await guardar();
  await p.locator('.est-portafolio:has-text("POR") [data-nuevo="programas"]').click(); await p.waitForTimeout(300); await llenar('nombre', 'PROG'); await guardar();
  await p.locator('.est-programa:has-text("PROG") [data-nuevo="proyectos"]').click(); await p.waitForTimeout(300); await llenar('codigo', 'P1'); await llenar('nombre_corto', 'Proy1'); await guardar();
  await p.locator('.est-proyecto:has-text("Proy1") [data-padre]').click(); await p.waitForTimeout(300); await llenar('codigo', 'P1.1'); await llenar('nombre_corto', 'Sub1'); await guardar();
  const botones = await p.evaluate(() => [...document.querySelectorAll('tr.est-fila')].filter(r => /Andina|POR|PROG|Proy1|Sub1/.test(r.innerText)).map(r => r.dataset.tipo + ': ' + [...r.querySelectorAll('.acciones-fila button')].map(b => b.innerText.trim()).join(' | ')));
  console.log(botones.join('\n'));
  const estados = () => p.evaluate(() => [...document.querySelectorAll('tr.est-fila')].filter(r => /POR|PROG|Proy1|Sub1/.test(r.innerText)).map(r => r.dataset.tipo + '=' + (/Inactivo|Cerrado/.test(r.innerText) ? 'inactivo' : 'activo')).join(', '));
  // desactivar el portafolio: cascada
  await p.locator('.est-portafolio:has-text("POR") [data-activo]').click(); await p.waitForTimeout(300);
  console.log('confirmación:', (await p.locator('.modal').last().innerText()).replace(/\s+/g, ' ').slice(0, 160));
  await p.locator('.modal-pie .btn-peligro, .modal-pie .btn-primario').last().click(); await p.waitForTimeout(1500);
  console.log('tras desactivar POR:', await estados());
  // reactivar el portafolio sin lo de abajo
  await p.locator('.est-portafolio:has-text("POR") [data-activo]').click(); await p.waitForTimeout(300);
  await p.locator('.modal-pie .btn-primario').last().click(); await p.waitForTimeout(400);
  await p.locator('.modal-pie button:has-text("Cancelar"), .modal-pie button:has-text("No")').last().click(); await p.waitForTimeout(1500);
  console.log('reactivar solo POR:', await estados());
  // reactivar el programa con lo de abajo
  await p.locator('.est-programa:has-text("PROG") [data-activo]').click(); await p.waitForTimeout(300);
  await p.locator('.modal-pie .btn-primario').last().click(); await p.waitForTimeout(400);
  await p.locator('.modal-pie .btn-primario').last().click(); await p.waitForTimeout(1500);
  console.log('reactivar PROG con lo de abajo:', await estados());
  // empresa
  await emp.locator('[data-activo]').click(); await p.waitForTimeout(300); await p.locator('.modal-pie .btn-peligro, .modal-pie .btn-primario').last().click(); await p.waitForTimeout(1200);
  console.log('empresa:', (await p.locator('.est-empresa:has-text("Constructora Andina")').innerText()).replace(/\s+/g, ' ').slice(0, 120));
  console.log('empresa en uso sin botón:', await p.locator('.est-empresa').first().locator('[data-activo]').count());
  await p.screenshot({ path: SH + 'q15.png' });
  console.log(errs.length ? errs : 'SIN ERRORES');
  await b.close();
})();
