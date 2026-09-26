/**
 * Prueba de punta a punta de las funciones de seguimiento y crecimiento, contra un MongoDB en memoria:
 * avisos de estado, bandeja del asesor, versiones, Esperar + Programador, encuestas, permisos y campañas,
 * carritos abandonados, recordatorios de cita, BAJA, planes y límites, superadministrador y bitácora.
 *
 *   npm run e2e
 */
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongo = await MongoMemoryServer.create();
const CRON = 'secreto-del-cron-para-pruebas';
Object.assign(process.env, {
  MONGO_URI: mongo.getUri('flujobot-e2e-crecimiento'),
  JWT_SECRET: 'secreto-de-prueba-e2e-1234567890',
  PORT: '3398',
  N8N_URL: '',
  EVOLUTION_URL: '',
  OPENROUTER_API_KEY: '',
  GROQ_API_KEY: '',
  PROGRAMADOR: 'no',
  CRON_SECRETO: CRON,
  SUPERADMINS: 'dueno@flujobot.mx',
});
const { env } = await import('../src/infrastructure/config/env.js');
const { arrancar } = await import('../src/main/arrancar.js');
const M = await import('../src/infrastructure/persistence/models/index.js');
const servidor = await arrancar(env);
const BASE = 'http://localhost:3398';

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
const tick = () => api('POST', '/interno/tick', { headers: { 'x-cron-secreto': CRON } });
const alPasado = (filtro) => M.TrabajoModel.updateMany({ estado: 'pendiente', ...filtro }, { $set: { ejecutarEn: new Date(Date.now() - 1000) } });

try {
  // ───── Empresas: la de FlujoBot (superadmin) y una taquería
  const hq = await api('POST', '/auth/registro', { cuerpo: { empresa: 'FlujoBot HQ', nombre: 'Dueño', email: 'dueno@flujobot.mx', password: 'secreta123' }, esperado: 201 });
  const tq = await api('POST', '/auth/registro', { cuerpo: { empresa: 'Taquería Don Pepe', nombre: 'Pepe', email: 'pepe@test.mx', password: 'secreta123', giro: 'restaurante' }, esperado: 201 });
  assert.equal(hq.usuario.esSuperadmin, true);
  assert.equal(tq.usuario.esSuperadmin, false);
  const T = tq.token;
  await api('POST', '/productos', { token: T, cuerpo: { nombre: 'Taco al pastor', precio: 18 }, esperado: 201 });

  // ───── Bot de pedidos publicado + chat web
  const bot = await api('POST', '/bots', { token: T, cuerpo: { nombre: 'Pedidos', plantilla: 'tienda' }, esperado: 201 });
  assert.deepEqual(bot.telegram, { activo: false, usuario: '' });
  await api('POST', `/bots/${bot.id}/publicar`, { token: T });
  const web = await api('PUT', `/bots/${bot.id}/web`, { token: T, cuerpo: { activo: true } });
  const vis = 'visitante-crecimiento-1';
  const chat = (texto, clave = web.clave) => api('POST', `/publico/chat/${clave}/mensajes`, { cuerpo: { visitante: vis, texto } });
  const nuevos = (desde, clave = web.clave) => api('GET', `/publico/chat/${clave}/mensajes?visitante=${vis}&desde=${encodeURIComponent(desde)}`);

  let ultimo;
  for (const t of ['hola', '1', '1 2', '2', 'Vero']) ultimo = await chat(t);
  ultimo = await chat('Calle 1');
  assert.match(ultimo.respuestas[0].texto, /P-000001/);

  // 1. Seguimiento: al cambiar el estado se le avisa al cliente por su canal
  const [pedido] = await api('GET', '/pedidos', { token: T });
  const cambio = await api('PATCH', `/pedidos/${pedido.id}/estado`, { token: T, cuerpo: { estado: 'enviado' } });
  assert.equal(cambio.aviso.enviado, true);
  let llegan = await nuevos(ultimo.fecha);
  assert.match(llegan.mensajes.at(-1).texto, /orden \*P-000001\* va en camino/, 'usa el término de la empresa (restaurante: "orden")');
  await api('PATCH', `/pedidos/${pedido.id}/estado`, { token: T, cuerpo: { estado: 'preparando', avisar: false } });
  assert.equal((await nuevos(llegan.fecha)).mensajes.length, 0, 'sin avisar no se manda nada');
  await api('POST', `/pedidos/${pedido.id}/pagado`, { token: T });
  assert.equal((await api('GET', '/pedidos?pago=pagado', { token: T })).length, 1);

  // Bandeja: el asesor toma la plática, escribe y la devuelve
  const [convWeb] = await api('GET', '/conversaciones?canal=web', { token: T });
  await api('POST', `/conversaciones/${convWeb.id}/tomar`, { token: T });
  const antes = new Date().toISOString();
  const resp = await api('POST', `/conversaciones/${convWeb.id}/mensajes`, { token: T, cuerpo: { texto: 'Hola Vero, soy Pepe. Tu orden sale en 10 min.' } });
  assert.equal(resp.enviado, true);
  llegan = await nuevos(antes);
  assert.equal(llegan.mensajes[0].de, 'asesor');
  assert.equal(llegan.estado, 'humano');
  assert.equal((await chat('gracias')).respuestas.length, 0, 'con asesor el bot no contesta');
  await api('POST', `/conversaciones/${convWeb.id}/devolver-al-bot`, { token: T });
  assert.ok((await chat('hola')).respuestas.length > 0);

  // 10. Versiones: cada publicación se guarda y se puede restaurar
  const det = await api('GET', `/bots/${bot.id}`, { token: T });
  const cambiado = structuredClone(det.borrador);
  cambiado.nodos.find((n) => n.tipo === 'menu').datos.texto = 'Menú NUEVO';
  await api('PUT', `/bots/${bot.id}/flujo`, { token: T, cuerpo: { nodos: cambiado.nodos, conexiones: cambiado.conexiones } });
  await api('POST', `/bots/${bot.id}/publicar`, { token: T });
  const versiones = await api('GET', `/bots/${bot.id}/versiones`, { token: T });
  assert.equal(versiones.length, 2);
  assert.equal(versiones[0].activa, true);
  await api('POST', `/bots/${bot.id}/versiones/${versiones[1].id}/restaurar`, { token: T });
  const restaurado = await api('GET', `/bots/${bot.id}`, { token: T });
  assert.notEqual(restaurado.borrador.nodos.find((n) => n.tipo === 'menu').datos.texto, 'Menú NUEVO');
  assert.equal(restaurado.cambiosSinPublicar, true, 'restaurar no publica solo');

  // 9 + 8 + 1. Bot de seguimiento: Consultar → Esperar → Encuesta → Permiso
  const seguimiento = {
    nodos: [
      { id: 'i', tipo: 'inicio', datos: { palabrasClave: [] } },
      { id: 'e', tipo: 'estado', datos: {} },
      { id: 'w', tipo: 'esperar', datos: { minutos: 30, texto: '¿Te ayudo con algo más?' } },
      { id: 'q', tipo: 'encuesta', datos: {} },
      { id: 'p', tipo: 'permiso', datos: {} },
      { id: 'x', tipo: 'mensaje', datos: { texto: '¿Sigues ahí? Aquí estamos.' } },
      { id: 'f', tipo: 'fin', datos: {} },
    ],
    conexiones: [
      ['i', 'siguiente', 'e'], ['e', 'encontrado', 'w'], ['e', 'nada', 'f'], ['w', 'respondio', 'q'], ['w', 'sin_respuesta', 'x'],
      ['x', 'siguiente', 'f'], ['q', 'buena', 'p'], ['q', 'mala', 'p'], ['p', 'acepto', 'f'], ['p', 'no_acepto', 'f'],
    ].map(([origen, puerto, destino]) => ({ origen, puerto, destino })),
  };
  const bot2 = await api('POST', '/bots', { token: T, cuerpo: { nombre: 'Seguimiento', flujo: seguimiento }, esperado: 201 });
  await api('POST', '/bots', { token: T, cuerpo: { nombre: 'Tercero' }, esperado: 422 }); // plan de prueba: 2 bots
  await api('POST', `/bots/${bot2.id}/publicar`, { token: T });
  const web2 = await api('PUT', `/bots/${bot2.id}/web`, { token: T, cuerpo: { activo: true } });

  let r = await chat('¿cómo va mi pedido?', web2.clave);
  assert.match(r.respuestas[0].texto, /P-000001\* — En preparación — \$36\.00 \(pagado\)/);
  assert.match(r.respuestas[1].texto, /algo más/);
  assert.equal(await M.TrabajoModel.countDocuments({ tipo: 'reanudar_espera', estado: 'pendiente' }), 1);
  await alPasado({ tipo: 'reanudar_espera' });
  const t1 = await tick();
  assert.equal(t1.trabajos, 1);
  llegan = await nuevos(r.fecha, web2.clave);
  assert.match(llegan.mensajes.at(-1).texto, /Sigues ahí/, 'el Programador siguió por "No respondió"');

  r = await chat('hola', web2.clave);
  r = await chat('no, gracias', web2.clave);
  assert.match(r.respuestas[0].texto, /del \*1\* \(malo\) al \*5\*/);
  r = await chat('5', web2.clave);
  assert.match(r.respuestas.at(-1).texto, /promociones/);
  await chat('1', web2.clave);
  await alPasado({ tipo: 'reanudar_espera' });
  assert.equal((await tick()).trabajos, 1);
  assert.equal((await nuevos(r.fecha, web2.clave)).mensajes.filter((m) => /Sigues ahí/.test(m.texto)).length, 0, 'ya contestó: la espera vieja no manda nada');

  const encuestas = await api('GET', '/gestion/encuestas', { token: T });
  assert.equal(encuestas.total, 1);
  assert.equal(encuestas.promedio, 5);
  assert.equal((await api('GET', '/tablero/resumen', { token: T })).satisfaccion.promedio, 5);
  assert.equal((await api('GET', '/campanas/contactos?permiso=true', { token: T })).length, 1);

  // WhatsApp (por n8n): BAJA, carrito abandonado y confirmación de un recordatorio
  const wf = await api('GET', `/bots/${bot.id}/workflow-n8n`, { token: T });
  const tokenMotor = wf.nodes[1].parameters.headerParameters.parameters[0].value;
  const whatsapp = (texto, contacto = '5215511112222') =>
    api('POST', `/motor/bots/${bot.id}/mensajes`, { cuerpo: { contacto, nombre: 'Carla', texto }, headers: { 'x-bot-token': tokenMotor } });
  r = await whatsapp('ALTA');
  assert.match(r.respuestas[0].texto, /Te avisaremos/);
  r = await whatsapp('baja');
  assert.match(r.respuestas[0].texto, /ya no te mandaremos/);
  const carla = await M.ContactoModel.findOne({ contacto: '5215511112222' }).lean();
  assert.equal(carla.aceptaPromos, false);

  // 6. Carrito abandonado
  for (const t of ['hola', '1', '1 3']) await whatsapp(t);
  await api('PUT', `/bots/${bot.id}/recuperacion`, { token: T, cuerpo: { activo: true, horas: 1 } });
  await M.ConversacionModel.updateOne({ contacto: '5215511112222' }, { $set: { actualizadoEn: new Date(Date.now() - 2 * 3600_000) } });
  const t2 = await tick();
  assert.equal(t2.barridos.carritos.enviados, 1);
  const recordada = await M.ConversacionModel.findOne({ contacto: '5215511112222' }).lean();
  assert.ok(recordada.carritoRecordado);
  assert.match(recordada.historial.map((h) => h.texto).join('\n'), /dejaste tu orden a medias \(\$54\.00\)/);
  assert.equal((await tick()).barridos.carritos.enviados, 0, 'solo se recuerda una vez');
  for (const t of ['2', 'Carla']) await whatsapp(t);
  r = await whatsapp('Calle 5');
  assert.match(r.respuestas[0].texto, /P-000002/);
  assert.equal((await api('GET', '/tablero/resumen', { token: T })).carritosRecuperados, 1);

  // 2. Recordatorios de cita
  const enDosDias = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const cita = await api('POST', '/citas', { token: T, cuerpo: { fecha: enDosDias, hora: '12:00', nombreContacto: 'Carla', contacto: '5511112222' }, esperado: 201 });
  assert.deepEqual(cita.recordatorios, ['dia', 'hora']);
  assert.equal(await M.TrabajoModel.countDocuments({ clave: { $regex: `^cita:${cita.id}:` }, estado: 'pendiente' }), 2);
  await api('PATCH', `/citas/${cita.id}`, { token: T, cuerpo: { estado: 'cancelada', avisar: false } });
  assert.equal(await M.TrabajoModel.countDocuments({ clave: { $regex: `^cita:${cita.id}:` }, estado: 'cancelado' }), 2);

  const cita2 = await api('POST', '/citas', { token: T, cuerpo: { fecha: enDosDias, hora: '13:00', nombreContacto: 'Carla', contacto: '5215511112222' }, esperado: 201 });
  await api('PATCH', `/citas/${cita2.id}`, { token: T, cuerpo: { estado: 'pendiente', avisar: false } });
  await M.ConversacionModel.updateOne(
    { contacto: '5215511112222' },
    { $set: { pendiente: { tipo: 'confirmar_cita', citaId: cita2.id, folio: cita2.folio, hasta: new Date(Date.now() + 86400000) } } },
  );
  r = await whatsapp('1');
  assert.match(r.respuestas[0].texto, /reservación de las 13:00 quedó confirmada/);
  assert.equal((await api('GET', '/citas', { token: T })).find((c) => c.id === cita2.id).estado, 'confirmada');

  // 5. Campañas: solo a quien dio permiso y por canales que dejan escribir primero
  const camp = await api('POST', '/campanas', { token: T, cuerpo: { botId: bot.id, nombre: 'Martes de tacos', texto: 'Hola {{nombre}}, hoy 2x1' }, esperado: 201 });
  let seg = await api('GET', '/campanas/segmento?tipo=todos', { token: T });
  assert.equal(seg.conPermiso, 1);
  assert.equal(seg.destinatarios, 0, 'el visitante web no recibe campañas');
  await api('POST', `/campanas/${camp.id}/programar`, { token: T, cuerpo: {}, esperado: 422 });
  await M.ContactoModel.create({ empresaId: tq.empresa.id, canal: 'telegram', contacto: '99887766', nombre: 'Luis', aceptaPromos: true });
  seg = await api('GET', '/campanas/segmento?tipo=todos', { token: T });
  assert.equal(seg.destinatarios, 1);
  assert.equal((await api('GET', '/campanas/segmento?tipo=compraron&dias=30', { token: T })).destinatarios, 0);
  await api('POST', `/campanas/${camp.id}/programar`, { token: T, cuerpo: {} });
  await tick(); // arranca: arma la lista
  await tick(); // manda el lote
  const enviada = (await api('GET', '/campanas', { token: T }))[0];
  assert.equal(enviada.estado, 'enviada');
  assert.equal(enviada.totales.destinatarios, 1);
  assert.equal(enviada.totales.fallidos, 1, 'el bot no tiene Telegram conectado: queda como fallido');
  await api('PATCH', `/campanas/${camp.id}`, { token: T, cuerpo: { nombre: 'otra' }, esperado: 409 });

  // 13. Plan y límites
  const plan = await api('GET', '/gestion/plan', { token: T });
  assert.equal(plan.clave, 'prueba');
  assert.equal(plan.uso.bots, 2);
  assert.ok(plan.uso.conversaciones >= 3);

  // 14. Superadministrador
  await api('GET', '/admin/empresas', { token: T, esperado: 403 });
  const empresas = await api('GET', '/admin/empresas', { token: hq.token });
  assert.equal(empresas.length, 2);
  await api('PATCH', `/admin/empresas/${tq.empresa.id}`, { token: hq.token, cuerpo: { activa: false, motivo: 'falta de pago' } });
  await api('POST', '/auth/login', { cuerpo: { email: 'pepe@test.mx', password: 'secreta123' }, esperado: 401 });
  await api('GET', '/auth/perfil', { token: T, esperado: 401 });
  assert.equal((await whatsapp('hola', '5215500000000')).respuestas.length, 0, 'suspendida: el bot no contesta');
  await api('PATCH', `/admin/empresas/${tq.empresa.id}`, { token: hq.token, cuerpo: { activa: true, vence: new Date(Date.now() - 1000).toISOString() } });
  assert.equal((await whatsapp('hola', '5215500000001')).respuestas.length, 0, 'plan vencido: no abre conversaciones nuevas');
  assert.equal((await api('GET', '/gestion/plan', { token: T })).vigente, false);
  await api('PATCH', `/admin/empresas/${tq.empresa.id}`, { token: hq.token, cuerpo: { plan: 'pro', sumarDias: 30 } });
  assert.ok((await whatsapp('hola', '5215500000002')).respuestas.length > 0);

  // 15. Bitácora (solo admin de la empresa)
  const actividad = await api('GET', '/gestion/actividad', { token: T });
  for (const accion of ['pedido.estado', 'bot.publicar', 'bot.restaurar', 'conversacion.tomar', 'campana.programar', 'admin.empresa']) {
    assert.ok(actividad.some((a) => a.accion === accion), `falta ${accion} en la bitácora`);
  }
  assert.equal(actividad.find((a) => a.accion === 'conversacion.tomar').usuario, 'pepe@test.mx');

  // Webhooks y seguridad
  await api('POST', '/interno/tick', { headers: { 'x-cron-secreto': 'otro' }, esperado: 401 });
  assert.equal((await api('GET', '/gestion/cobros', { token: T })).proveedor, 'ninguno');
  await api('POST', `/publico/pagos/mercadopago/${tq.empresa.id}`, { cuerpo: { type: 'payment', data: { id: '123' } }, esperado: 503 });
  await api('POST', `/publico/pagos/stripe/${tq.empresa.id}`, { cuerpo: { type: 'checkout.session.completed' }, headers: { 'stripe-signature': 't=1,v1=abc' }, esperado: 401 });
  await api('PUT', `/bots/${bot.id}/telegram`, { token: T, cuerpo: { token: 'no-es-token' }, esperado: 400 });
  const verif = await fetch(`${BASE}/publico/meta?hub.mode=subscribe&hub.verify_token=x&hub.challenge=123`);
  assert.equal(verif.status, 403);

  console.log(`\n✔ e2e crecimiento OK (${pasos} peticiones)`);
} catch (e) {
  console.error('\n✘ e2e crecimiento FALLÓ:', e.message);
  process.exitCode = 1;
} finally {
  servidor.close();
  await (await import('mongoose')).default.disconnect();
  await mongo.stop();
  process.exit();
}
