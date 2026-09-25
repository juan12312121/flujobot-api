/**
 * Prueba de punta a punta contra un MongoDB en memoria:
 * dos empresas, catálogo, bot con plantilla, simulador, publicar (modo manual),
 * mensajes "de WhatsApp" por el motor (como los manda n8n) y aislamiento entre empresas.
 *
 *   npm run e2e
 */
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongo = await MongoMemoryServer.create();
Object.assign(process.env, {
  MONGO_URI: mongo.getUri('flujobot-e2e'),
  JWT_SECRET: 'secreto-de-prueba-e2e-1234567890',
  PORT: '3399',
  N8N_URL: '',
  EVOLUTION_URL: '',
});
const { env } = await import('../src/infrastructure/config/env.js');
const { arrancar } = await import('../src/main/arrancar.js');
const servidor = await arrancar(env);
const BASE = 'http://localhost:3399';

let pasos = 0;
async function api(metodo, ruta, { token, cuerpo, headers = {}, esperado = 200 } = {}) {
  const r = await fetch(BASE + ruta, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const json = r.status === 204 ? null : await r.json();
  assert.equal(r.status, esperado, `${metodo} ${ruta} → ${r.status} ${JSON.stringify(json)}`);
  pasos++;
  return json?.data;
}

try {
  // 1. Dos empresas
  const a = await api('POST', '/auth/registro', { cuerpo: { empresa: 'Taquería Don Pepe', nombre: 'Pepe', email: 'pepe@test.mx', password: 'secreta123' }, esperado: 201 });
  const b = await api('POST', '/auth/registro', { cuerpo: { empresa: 'Floreria Luna', nombre: 'Luna', email: 'luna@test.mx', password: 'secreta123' }, esperado: 201 });
  await api('POST', '/auth/registro', { cuerpo: { empresa: 'X', nombre: 'X', email: 'pepe@test.mx', password: 'secreta123' }, esperado: 409 });
  const login = await api('POST', '/auth/login', { cuerpo: { email: 'pepe@test.mx', password: 'secreta123' } });
  assert.equal(login.empresa.nombre, 'Taquería Don Pepe');
  const TA = a.token;
  const TB = b.token;

  // 2. Catálogo
  const p1 = await api('POST', '/productos', { token: TA, cuerpo: { nombre: 'Taco al pastor', precio: 18, categoria: 'Tacos' }, esperado: 201 });
  await api('POST', '/productos', { token: TA, cuerpo: { nombre: 'Horchata', precio: 25, categoria: 'Bebidas' }, esperado: 201 });
  await api('POST', '/productos', { token: TB, cuerpo: { nombre: 'Ramo de rosas', precio: 450 }, esperado: 201 });
  assert.equal((await api('GET', '/productos', { token: TA })).length, 2);
  assert.deepEqual(await api('GET', '/productos/categorias', { token: TA }), ['Bebidas', 'Tacos']);
  await api('PATCH', `/productos/${p1.id}`, { token: TB, cuerpo: { precio: 1 }, esperado: 404 }); // otra empresa

  // 3. Bot con plantilla y simulador
  const bot = await api('POST', '/bots', { token: TA, cuerpo: { nombre: 'Pedidos WhatsApp', plantilla: 'tienda' }, esperado: 201 });
  assert.equal(bot.tokenMotor, undefined, 'el token del motor no sale al frontend');
  const detalle = await api('GET', `/bots/${bot.id}`, { token: TA });
  assert.equal(detalle.problemas.filter((p) => p.nivel === 'error').length, 0);
  await api('GET', `/bots/${bot.id}`, { token: TB, esperado: 404 });

  let sim = await api('POST', `/bots/${bot.id}/simulador`, { token: TA, cuerpo: { texto: 'hola' } });
  assert.match(sim.respuestas[0].texto, /Taquería Don Pepe/);
  sim = await api('POST', `/bots/${bot.id}/simulador`, { token: TA, cuerpo: { texto: '1' } });
  assert.match(sim.respuestas[0].texto, /Taco al pastor/);
  sim = await api('POST', `/bots/${bot.id}/simulador`, { token: TA, cuerpo: { texto: '2 2' } });
  assert.equal(sim.carrito[0].cantidad, 2);

  // 4. Flujo con error → no se publica; se corrige → se publica en modo manual
  const roto = { nodos: detalle.borrador.nodos.filter((n) => n.tipo !== 'inicio'), conexiones: [] };
  const guardado = await api('PUT', `/bots/${bot.id}/flujo`, { token: TA, cuerpo: roto });
  assert.ok(guardado.problemas.some((p) => p.mensaje.includes('Inicio')));
  await api('POST', `/bots/${bot.id}/publicar`, { token: TA, esperado: 409 });
  await api('PUT', `/bots/${bot.id}/flujo`, { token: TA, cuerpo: { nodos: detalle.borrador.nodos, conexiones: detalle.borrador.conexiones } });
  const pub = await api('POST', `/bots/${bot.id}/publicar`, { token: TA });
  assert.equal(pub.modo, 'manual');
  assert.equal(pub.bot.cambiosSinPublicar, false);

  // 5. Workflow de n8n exportable, con el token del motor dentro
  const wf = await api('GET', `/bots/${bot.id}/workflow-n8n`, { token: TA });
  assert.equal(wf.nodes.length, 4);
  const tokenMotor = wf.nodes[1].parameters.headerParameters.parameters[0].value;

  // 6. Mensajes como los manda n8n (webhook crudo de Evolution)
  const evolution = (texto, fromMe = false) => ({
    event: 'messages.upsert',
    instance: bot.instancia,
    data: { key: { remoteJid: '5215511112222@s.whatsapp.net', fromMe, id: 'X' }, pushName: 'Carla', message: { conversation: texto }, messageType: 'conversation' },
  });
  const motor = (cuerpo, token = tokenMotor, esperado = 200) =>
    api('POST', `/motor/bots/${bot.id}/mensajes`, { cuerpo, headers: { 'x-bot-token': token }, esperado });

  await motor(evolution('hola'), 'token-falso', 401);
  assert.equal((await motor(evolution('eco', true))).ignorado, 'mensaje propio');
  let r = await motor(evolution('hola'));
  assert.equal(r.respuestas[0].numero, '5215511112222');
  assert.match(r.respuestas[0].texto, /Hola Carla/);
  await motor(evolution('1'));
  await motor(evolution('2 3')); // catálogo alfabético: 1. Horchata, 2. Taco al pastor
  r = await motor(evolution('2'));
  assert.match(r.respuestas.map((x) => x.texto).join(), /Total: \$54\.00/);
  await motor(evolution('Carla Ruiz'));
  r = await motor(evolution('Calle 5 #10'));
  assert.match(r.respuestas[0].texto, /P-000001/);

  // 7. Pedido, conversación y resumen
  const pedidos = await api('GET', '/pedidos', { token: TA });
  assert.equal(pedidos.length, 1, 'el pedido del simulador no cuenta');
  assert.equal(pedidos[0].total, 54);
  assert.equal(pedidos[0].datos.direccion, 'Calle 5 #10');
  await api('PATCH', `/pedidos/${pedidos[0].id}/estado`, { token: TA, cuerpo: { estado: 'confirmado' } });
  assert.equal((await api('GET', '/pedidos', { token: TB })).length, 0);

  const convs = await api('GET', '/conversaciones', { token: TA });
  assert.equal(convs.length, 1);
  assert.equal(convs[0].nombre, 'Carla');
  const conv = await api('GET', `/conversaciones/${convs[0].id}`, { token: TA });
  assert.ok(conv.historial.length >= 12);

  const resumen = await api('GET', '/tablero/resumen', { token: TA });
  assert.equal(resumen.ventasMes.total, 54);
  assert.equal(resumen.pedidosPendientes, 0);

  // 7b. Chat web público (sin sesión, CORS abierto) y resultados del lienzo
  const web = await api('PUT', `/bots/${bot.id}/web`, { token: TA, cuerpo: { activo: true, titulo: 'Taquería en línea' } });
  assert.ok(web.clave.length >= 16);
  await api('PUT', `/bots/${bot.id}/web`, { token: TB, cuerpo: { activo: true }, esperado: 404 });
  const desdeOtroSitio = await fetch(`${BASE}/publico/chat/${web.clave}`, { headers: { origin: 'https://taqueria-don-pepe.com' } });
  assert.equal(desdeOtroSitio.headers.get('access-control-allow-origin'), '*', 'el globito funciona desde cualquier dominio');
  const publico = (await desdeOtroSitio.json()).data;
  assert.equal(publico.titulo, 'Taquería en línea');
  assert.equal(publico.empresa.nombre, 'Taquería Don Pepe');
  const visitante = { visitante: 'visitante-e2e-1' };
  let chat = await api('POST', `/publico/chat/${web.clave}/mensajes`, { cuerpo: { ...visitante, texto: 'hola' } });
  assert.match(chat.respuestas[0].texto, /En qué te ayudo/);
  assert.equal(chat.sugerencias.length, 3);
  chat = await api('POST', `/publico/chat/${web.clave}/mensajes`, { cuerpo: { ...visitante, texto: '1' } });
  assert.match(chat.respuestas[0].texto, /Taco al pastor/);
  await api('POST', `/publico/chat/no-existe-esta-clave-123/mensajes`, { cuerpo: { ...visitante, texto: 'hola' }, esperado: 404 });
  const convsWeb = await api('GET', '/conversaciones', { token: TA });
  assert.ok(convsWeb.some((c) => c.canal === 'web'), 'la bandeja muestra las del chat web');

  const res = await api('GET', `/bots/${bot.id}/resultados?dias=7`, { token: TA });
  assert.equal(res.conversaciones, 2, 'Carla por WhatsApp + el visitante web');
  assert.equal(res.nodos.menu, 2);
  assert.equal(res.flechas['menu|opcion:catalogo'], 2);
  assert.equal(res.nodos.catalogo, 2);
  assert.equal(res.enCurso.catalogo, 1, 'el visitante web sigue en el catálogo');
  await api('PUT', `/bots/${bot.id}/web`, { token: TA, cuerpo: { activo: false } });
  await api('GET', `/publico/chat/${web.clave}`, { esperado: 404 });

  // 8. Otro giro: salón de belleza con agenda, personalización y citas por WhatsApp
  const giros = await api('GET', '/giros');
  assert.ok(giros.some((g) => g.id === 'belleza'));
  const salon = await api('POST', '/auth/registro', {
    cuerpo: { empresa: 'Estética Lupita', nombre: 'Lupita', email: 'lupita@test.mx', password: 'secreta123', giro: 'belleza' },
    esperado: 201,
  });
  assert.equal(salon.empresa.terminos.items, 'Servicios');
  assert.equal(salon.empresa.modulos.agenda, true);
  const TS = salon.token;
  const personalizada = await api('PATCH', '/empresa', {
    token: TS,
    cuerpo: { marca: { colorPrimario: '#db2777' }, terminos: { clientes: 'Clientas' }, horario: { dias: [0, 1, 2, 3, 4, 5, 6], apertura: '00:00', cierre: '23:30' } },
  });
  assert.equal(personalizada.marca.colorPrimario, '#db2777');
  assert.equal(personalizada.marca.colorMenu, '#0f1b17', 'cambiar un color no borra el otro');
  assert.equal(personalizada.terminos.items, 'Servicios');
  await api('PATCH', '/empresa', { token: TS, cuerpo: { marca: { colorPrimario: 'rosa' } }, esperado: 400 });
  await api('PATCH', '/empresa', { token: TS, cuerpo: { horario: { apertura: '18:00', cierre: '09:00' } }, esperado: 422 });

  await api('POST', '/productos', { token: TS, cuerpo: { nombre: 'Corte', precio: 150, tipo: 'servicio', duracionMin: 60 }, esperado: 201 });
  const botSalon = await api('POST', '/bots', { token: TS, cuerpo: { nombre: 'Citas' }, esperado: 201 });
  assert.ok(botSalon.borrador.nodos.some((n) => n.tipo === 'cita'), 'la plantilla sale del giro');
  await api('POST', `/bots/${botSalon.id}/publicar`, { token: TS });
  const wfSalon = await api('GET', `/bots/${botSalon.id}/workflow-n8n`, { token: TS });
  const tokenSalon = wfSalon.nodes[1].parameters.headerParameters.parameters[0].value;
  const clienta = (texto) =>
    api('POST', `/motor/bots/${botSalon.id}/mensajes`, { cuerpo: { contacto: '5215599990000', nombre: 'Rosa', texto }, headers: { 'x-bot-token': tokenSalon } });
  for (const t of ['hola', '1', '1', 'Rosa']) await clienta(t);
  await clienta('1'); // primer día libre
  r = await clienta('1'); // primer horario libre
  assert.match(r.respuestas[0].texto, /C-000001/);
  const agenda = await api('GET', '/citas', { token: TS });
  assert.equal(agenda.length, 1);
  assert.equal(agenda[0].servicio, 'Corte');
  await api('PATCH', `/citas/${agenda[0].id}`, { token: TS, cuerpo: { estado: 'confirmada' } });
  await api('POST', '/citas', { token: TS, cuerpo: { fecha: '2030-01-15', hora: '10:00', nombreContacto: 'Cliente por teléfono' }, esperado: 201 });
  assert.equal((await api('GET', '/citas', { token: TA })).length, 0, 'la taquería no ve la agenda del salón');
  assert.equal((await api('GET', '/tablero/resumen', { token: TS })).proximasCitas.length, 2); // la de WhatsApp + la capturada a mano

  // 9. Equipo: el editor no puede borrar bots
  await api('POST', '/usuarios', { token: TA, cuerpo: { nombre: 'Editor', email: 'editor@test.mx', password: 'secreta123', rol: 'editor' }, esperado: 201 });
  const ed = await api('POST', '/auth/login', { cuerpo: { email: 'editor@test.mx', password: 'secreta123' } });
  await api('DELETE', `/bots/${bot.id}`, { token: ed.token, esperado: 403 });
  await api('DELETE', `/bots/${bot.id}`, { token: TA, esperado: 204 });

  console.log(`\n✔ e2e OK (${pasos} peticiones)`);
} catch (e) {
  console.error('\n✘ e2e FALLÓ:', e.message);
  process.exitCode = 1;
} finally {
  servidor.close();
  await (await import('mongoose')).default.disconnect();
  await mongo.stop();
  process.exit();
}
