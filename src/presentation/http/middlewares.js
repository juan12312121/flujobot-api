import rateLimit from 'express-rate-limit';
import { ApiResponse } from './ApiResponse.js';
import { NoAutenticadoError } from '../../application/shared/errors.js';

/**
 * Exige "Authorization: Bearer <token>" y deja { id, empresaId, rol, email } en req.actor.
 * El empresaId del token es el que aísla los datos de cada empresa.
 */
export const autenticar = (tokens) => (req, _res, next) => {
  const cabecera = req.headers.authorization ?? '';
  if (!cabecera.startsWith('Bearer ')) return next(new NoAutenticadoError());
  try {
    req.actor = tokens.verificar(cabecera.slice(7));
    next();
  } catch (e) {
    next(e);
  }
};

const limitar = (limit, windowMs, codigo, mensaje) =>
  rateLimit({ windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false, handler: (_req, res) => ApiResponse.error(res, 429, codigo, mensaje) });

/** Freno contra fuerza bruta en login/registro: 20 intentos por IP cada 15 minutos. */
export const limiteAuth = limitar(20, 15 * 60_000, 'DEMASIADOS_INTENTOS', 'Demasiados intentos, espera unos minutos');

/** Panel: límite amplio (el editor guarda seguido). */
export const limiteGeneral = limitar(600, 60_000, 'DEMASIADAS_PETICIONES', 'Demasiadas peticiones, baja el ritmo');

/** Asistente de IA: cada llamada cuesta dinero; 20 por IP cada 10 minutos. */
export const limiteIA = limitar(20, 10 * 60_000, 'DEMASIADAS_PETICIONES_IA', 'Usaste mucho el asistente en poco tiempo, espera unos minutos');

/** Chat web público: por visitante (IP), generoso para una conversación normal pero no para un robot. */
export const limiteChatPublico = limitar(90, 60_000, 'DEMASIADOS_MENSAJES', 'Demasiados mensajes, espera un momento');

/** Motor: todos los mensajes de WhatsApp de todos los bots llegan desde la IP de n8n. */
export const limiteMotor = limitar(3000, 60_000, 'DEMASIADOS_MENSAJES', 'Demasiados mensajes por minuto');
