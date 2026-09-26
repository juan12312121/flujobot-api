import 'dotenv/config';
import { z } from 'zod';

const url = z.string().url();

const esquema = z.object({
  PORT: z.coerce.number().default(3300),
  /** mongodb+srv://usuario:contraseña@cluster0.xxxxx.mongodb.net/flujobot?retryWrites=true&w=majority */
  MONGO_URI: z.string().startsWith('mongodb'),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRA: z.string().default('7d'),
  CORS_ORIGEN: z
    .string()
    .default('*')
    .transform((v) => (v.trim() === '*' ? '*' : v.split(',').map((o) => o.trim()).filter(Boolean))),

  /** URL con la que n8n alcanza esta API (en el VPS suele ser la interna de Docker). */
  API_URL_PUBLICA: url.default('http://localhost:3300'),

  /** n8n: sin URL + API key, "Publicar" solo genera el JSON del workflow para importarlo a mano. */
  N8N_URL: url.optional(),
  N8N_API_KEY: z.string().optional(),
  /** Credencial Header Auth (apikey de Evolution) que usarán los workflows generados. */
  N8N_EVOLUTION_CREDENCIAL_ID: z.string().optional(),

  /** Evolution API: sin ella no se puede conectar WhatsApp desde el panel (el simulador sí funciona). */
  EVOLUTION_URL: url.optional(),
  EVOLUTION_API_KEY: z.string().optional(),

  /** Imágenes (productos, logo, mensajes) en Cloudinary. Sin las tres, subir imágenes responde 503 y se puede pegar una URL. */
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  /** Asistente de IA (OpenRouter). Sin la llave, el asistente responde 503 y todo lo demás funciona. */
  OPENROUTER_API_KEY: z.string().optional(),
  /** Modelos en orden de preferencia, separados por coma. Si uno falla o está saturado se usa el siguiente. */
  OPENROUTER_MODELOS: z
    .string()
    .default('nvidia/nemotron-3-super-120b-a12b:free,qwen/qwen3.8-27b:free,google/gemma-4-31b-it:free')
    .transform((v) => v.split(',').map((m) => m.trim()).filter(Boolean)),
  /** Tope de la respuesta de la IA. Un flujo mediano ocupa ~2,500 tokens. */
  OPENROUTER_MAX_TOKENS: z.coerce.number().int().min(1000).max(32000).default(8000),
  URL_FRONTEND: url.default('http://localhost:4400'),

  /** Llave para cifrar los secretos que pegan las empresas (pagos, Telegram, Meta). Sin ella se usa JWT_SECRET. */
  CIFRADO_LLAVE: z.string().min(16).optional(),
  /** Correos con acceso al panel de superadministrador (separados por coma). */
  SUPERADMINS: z
    .string()
    .default('')
    .transform((v) => v.split(',').map((c) => c.trim().toLowerCase()).filter(Boolean)),
  /** Secreto para POST /interno/tick (lo llama un monitor o cron para correr las tareas programadas). */
  CRON_SECRETO: z.string().min(16).optional(),
  /** Programador interno (recordatorios, campañas, esperas, carritos). "no" lo apaga (p. ej. en pruebas). */
  PROGRAMADOR: z.enum(['si', 'no']).default('si'),
  PROGRAMADOR_SEGUNDOS: z.coerce.number().int().min(10).max(3600).default(60),

  /** Notas de voz: Whisper en Groq (nivel gratuito). Sin llave el bot pide que le escriban. */
  GROQ_API_KEY: z.string().optional(),

  /** App de Meta de FlujoBot (Messenger / Instagram). */
  META_APP_SECRET: z.string().optional(),
  META_VERIFY_TOKEN: z.string().optional(),

});

const resultado = esquema
  .refine((e) => !e.N8N_URL || e.N8N_API_KEY, { message: 'Falta N8N_API_KEY', path: ['N8N_API_KEY'] })
  .refine((e) => !e.EVOLUTION_URL || e.EVOLUTION_API_KEY, { message: 'Falta EVOLUTION_API_KEY', path: ['EVOLUTION_API_KEY'] })
  // Una variable vacía (`N8N_URL=`) cuenta como no configurada, no como inválida
  .safeParse(Object.fromEntries(Object.entries(process.env).filter(([, valor]) => valor !== '')));
if (!resultado.success) {
  console.error('Variables de entorno inválidas:', resultado.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = resultado.data;
