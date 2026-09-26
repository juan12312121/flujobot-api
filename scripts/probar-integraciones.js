/**
 * Revisa que n8n y Evolution estén bien conectados usando el .env real (con MongoDB en memoria):
 * publica un bot de prueba → debe crear su workflow en n8n; conecta WhatsApp → debe dar un QR.
 * Al final borra el bot, su workflow y su instancia.
 *
 *   node scripts/probar-integraciones.js
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongo = await MongoMemoryServer.create();
process.env.MONGO_URI = mongo.getUri('flujobot-integraciones');
process.env.PORT = '3302';
process.env.PROGRAMADOR = 'no';
const { env } = await import('../src/infrastructure/config/env.js');
const { arrancar } = await import('../src/main/arrancar.js');
const servidor = await arrancar(env);

const api = async (metodo, ruta, token, cuerpo) => {
  const r = await fetch(`http://localhost:3302${ruta}`, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const j = r.status === 204 ? null : await r.json();
  if (!r.ok) throw new Error(`${metodo} ${ruta} → ${r.status} ${JSON.stringify(j)}`);
  return j?.data;
};

try {
  const { token } = await api('POST', '/auth/registro', null, { empresa: 'Prueba integraciones', nombre: 'Prueba', email: `prueba${Date.now()}@x.mx`, password: 'secreta123' });
  const bot = await api('POST', '/bots', token, { nombre: 'Prueba integraciones', plantilla: 'informacion' });
  const pub = await api('POST', `/bots/${bot.id}/publicar`, token);
  console.log('Publicar →', pub.modo === 'n8n' ? `workflow creado en n8n (${pub.bot.n8nWorkflowId})` : 'MANUAL (n8n no respondió)');
  console.log('Webhook para Evolution →', pub.webhookUrl);
  if (pub.avisos.length) console.log('Avisos:', pub.avisos);
  const wa = await api('POST', `/bots/${bot.id}/whatsapp/conectar`, token);
  console.log('Conectar WhatsApp →', wa.estado, wa.qr ? `QR recibido (${wa.qr.length} caracteres)` : 'sin QR');
  await api('DELETE', `/bots/${bot.id}`, token);
  console.log('Limpieza → bot, workflow e instancia de prueba borrados');
} catch (e) {
  console.error('FALLÓ:', e.message);
  process.exitCode = 1;
} finally {
  servidor.close();
  await (await import('mongoose')).default.disconnect();
  await mongo.stop();
  process.exit();
}
