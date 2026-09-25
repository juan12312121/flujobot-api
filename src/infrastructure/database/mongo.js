import dns from 'node:dns';
import mongoose from 'mongoose';

mongoose.set('strictQuery', true);

/** DNS públicos para cuando el del equipo no resuelve los registros SRV de Atlas (pasa en algunos Windows y módems). */
const DNS_RESPALDO = ['8.8.8.8', '1.1.1.1'];

const conectar = (uri) => mongoose.connect(uri, { serverSelectionTimeoutMS: 15_000 });

/** Abre la conexión de Mongoose. Todos los modelos comparten esta conexión global. */
export async function conectarMongo(uri) {
  try {
    await conectar(uri);
  } catch (e) {
    // "querySrv ECONNREFUSED/ETIMEOUT": el DNS local no contestó la consulta SRV de mongodb+srv://
    if (!uri.startsWith('mongodb+srv://') || !/querySrv/i.test(e.message)) throw e;
    console.warn(`El DNS del equipo no resolvió Atlas (${e.message}); reintentando con ${DNS_RESPALDO.join(' y ')}`);
    dns.setServers(DNS_RESPALDO);
    await conectar(uri);
  }
  const { host, name } = mongoose.connection;
  console.log(`MongoDB conectado (${host}/${name})`);
  return mongoose.connection;
}

export async function desconectarMongo() {
  await mongoose.disconnect();
}
