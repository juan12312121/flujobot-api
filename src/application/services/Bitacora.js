/**
 * Registro de actividad: quién cambió el flujo, quién atendió qué plática, quién movió un pedido...
 * Nunca rompe la acción principal: si no se puede registrar, solo se avisa en consola.
 */
export class Bitacora {
  constructor({ actividad }) {
    this.actividad = actividad;
  }

  /**
   * @param {{ id?: string, empresaId: string, email?: string }} actor
   * @param {string} accion  p. ej. "bot.publicar", "pedido.estado", "conversacion.tomar"
   * @param {{ entidad?: string, entidadId?: string, detalle?: string }} [datos]
   */
  async registrar(actor, accion, { entidad = '', entidadId = '', detalle = '' } = {}) {
    if (!actor?.empresaId) return;
    await this.actividad
      .registrar({ empresaId: actor.empresaId, usuarioId: actor.id ?? '', usuario: actor.email ?? 'sistema', accion, entidad, entidadId: String(entidadId ?? ''), detalle: String(detalle).slice(0, 500) })
      .catch((e) => console.warn('No se registró la actividad:', e.message));
  }
}
