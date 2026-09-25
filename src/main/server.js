import { env } from '../infrastructure/config/env.js';
import { arrancar } from './arrancar.js';

arrancar(env).catch((e) => {
  console.error('No se pudo arrancar FlujoBot API:', e.message);
  process.exit(1);
});
