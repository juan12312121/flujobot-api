/**
 * Planes de FlujoBot. Los límites son por mes calendario (zona de la empresa no importa aquí: se cuenta en UTC).
 *
 * - conversaciones: conversaciones nuevas en canales reales (cada vez que un cliente arranca el bot).
 * - ia: respuestas del bloque "Responder con IA" y del menú con IA.
 * - campanas: mensajes enviados por campañas (0 = el plan no incluye campañas).
 * - canales: por dónde puede atender el bot.
 */
export const PLANES = Object.freeze({
  prueba: {
    nombre: 'Prueba gratis',
    precio: 0,
    diasPrueba: 14,
    bots: 2,
    conversaciones: 300,
    ia: 200,
    campanas: 100,
    canales: ['whatsapp', 'web', 'telegram'],
  },
  basico: {
    nombre: 'Básico',
    precio: 349,
    bots: 2,
    conversaciones: 1500,
    ia: 1000,
    campanas: 1000,
    canales: ['whatsapp', 'web', 'telegram'],
  },
  pro: {
    nombre: 'Pro',
    precio: 899,
    bots: 10,
    conversaciones: 10000,
    ia: 6000,
    campanas: 10000,
    canales: ['whatsapp', 'web', 'telegram', 'messenger', 'instagram'],
  },
});

export const PLANES_DE_PAGO = ['basico', 'pro'];

export const planDe = (empresa) => PLANES[empresa?.plan?.clave] ?? PLANES.prueba;

/** "2026-09": los contadores de uso se agrupan por mes. */
export const mesDe = (fecha = new Date()) => fecha.toISOString().slice(0, 7);

/** El plan sigue vigente (la prueba o el mes pagado no han vencido). */
export function planVigente(empresa, ahora = new Date()) {
  const vence = empresa?.plan?.vence ? new Date(empresa.plan.vence) : null;
  return !vence || vence > ahora;
}

/** Cuánto le queda al plan en días (redondeado hacia arriba); negativo = vencido. */
export function diasRestantes(empresa, ahora = new Date()) {
  const vence = empresa?.plan?.vence ? new Date(empresa.plan.vence) : null;
  return vence ? Math.ceil((vence - ahora) / 86400000) : null;
}
