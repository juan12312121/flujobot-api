import http from 'node:http';
import { crearContenedor } from './container.js';
import { crearApp } from '../presentation/http/crearApp.js';

/** Conecta Mongo, arma la app y escucha. Lo usan server.js (Atlas) y scripts/servidor-memoria.js. */
export async function arrancar(config) {
  const contenedor = await crearContenedor(config);
  const app = crearApp({ rutas: contenedor.rutas, rutasPublicas: contenedor.rutasPublicas, corsOrigen: config.CORS_ORIGEN });
  const servidor = http.createServer(app);

  servidor.on('error', (e) => {
    if (e.code === 'EADDRINUSE') console.error(`El puerto ${config.PORT} ya está ocupado (¿otro servidor corriendo?). Cambia PORT en .env o ciérralo.`);
    else console.error(e);
    process.exit(1);
  });
  await new Promise((listo) => servidor.listen(config.PORT, listo));
  const { n8n, evolution, ia, voz, meta } = contenedor.integraciones;
  const si = (v) => (v ? 'sí' : 'no');
  console.log(
    `FlujoBot API en http://localhost:${config.PORT} · n8n: ${n8n ? 'sí' : 'manual'} · Evolution: ${si(evolution)} · IA: ${si(ia)} · Voz: ${si(voz)} · Meta: ${si(meta)}`,
  );
  // Recordatorios, esperas, campañas y carritos abandonados
  if (config.PROGRAMADOR === 'si') contenedor.programador.iniciar(config.PROGRAMADOR_SEGUNDOS * 1000);

  async function apagar() {
    contenedor.programador.detener();
    servidor.close();
    await contenedor.cerrar().catch(() => {});
    process.exit(0);
  }
  process.on('SIGINT', apagar);
  process.on('SIGTERM', apagar);
  return servidor;
}
