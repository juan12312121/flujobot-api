/**
 * Levanta la API con un MongoDB en memoria (sin Atlas). Útil para probar el editor
 * sin tocar la base real. Los datos se pierden al apagar.
 *
 *   npm run dev:memoria
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongo = await MongoMemoryServer.create();
process.env.MONGO_URI = mongo.getUri('flujobot');
process.env.JWT_SECRET ??= 'secreto-solo-para-desarrollo-local';

const { env } = await import('../src/infrastructure/config/env.js');
const { arrancar } = await import('../src/main/arrancar.js');
await arrancar(env);
console.log('⚠ MongoDB EN MEMORIA: los datos se borran al apagar');
