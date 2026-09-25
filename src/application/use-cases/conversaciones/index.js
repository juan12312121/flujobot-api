import { UseCase } from '../../shared/UseCase.js';
import { CANALES_REALES } from '../../shared/canales.js';
import { existe } from '../../services/permisos.js';

/** Bandeja de conversaciones (WhatsApp y chat web): seguimiento y las que esperan a un asesor. */

export class ListarConversaciones extends UseCase {
  constructor({ conversaciones }) {
    super();
    this.conversaciones = conversaciones;
  }

  async ejecutar({ actor, botId, estado }) {
    const filtro = { canal: { $in: CANALES_REALES }, ...(botId ? { botId } : {}), ...(estado ? { estado } : {}) };
    const lista = await this.conversaciones.listar(actor.empresaId, filtro, { orden: { actualizadoEn: -1 }, limite: 200 });
    return lista.map(({ historial = [], variables: _v, ...c }) => ({ ...c, ultimoMensaje: historial.at(-1) ?? null, mensajes: historial.length }));
  }
}

export class ObtenerConversacion extends UseCase {
  constructor({ conversaciones }) {
    super();
    this.conversaciones = conversaciones;
  }

  async ejecutar({ actor, conversacionId }) {
    return existe(await this.conversaciones.obtener(actor.empresaId, conversacionId), 'Conversación no encontrada');
  }
}

/** El asesor terminó: el bot vuelve a contestar desde el Inicio en el siguiente mensaje. */
export class DevolverAlBot extends UseCase {
  constructor({ conversaciones }) {
    super();
    this.conversaciones = conversaciones;
  }

  async ejecutar({ actor, conversacionId }) {
    return existe(
      await this.conversaciones.actualizar(actor.empresaId, conversacionId, { estado: 'terminada', nodoActual: null }),
      'Conversación no encontrada',
    );
  }
}
