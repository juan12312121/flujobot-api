import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { ApiResponse } from './ApiResponse.js';
import { manejarErrores, rutaNoEncontrada } from './errores.js';

/**
 * Arma la app Express con las rutas que le pasa la composición.
 * @param {{ rutas: Array<[string, import('express').Router]>, rutasPublicas?: Array<[string, import('express').Router]>, corsOrigen: string | string[] }} opciones
 *   rutasPublicas: se montan con CORS abierto (el chat web vive en páginas de cualquier dominio).
 */
export function crearApp({ rutas, rutasPublicas = [], corsOrigen }) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  // 1 MB: un flujo grande (muchos bloques) y los webhooks de Evolution caben de sobra
  // rawBody: Stripe y Meta firman el cuerpo EXACTO que mandaron
  app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => (req.rawBody = buf) }));
  // Antes del CORS restringido del panel: estas rutas las llama el globito desde el sitio de cada negocio
  for (const [prefijo, router] of rutasPublicas) app.use(prefijo, cors({ origin: '*' }), router);
  app.use(cors({ origin: corsOrigen }));

  app.get('/', (_req, res) => ApiResponse.enviar(res, 200, { nombre: 'FlujoBot API', version: '1.0.0' }));
  app.get('/salud', (_req, res) => ApiResponse.enviar(res, 200, { ok: true, hora: new Date().toISOString() }));

  for (const [prefijo, router] of rutas) app.use(prefijo, router);

  app.use(rutaNoEncontrada);
  app.use(manejarErrores);
  return app;
}
