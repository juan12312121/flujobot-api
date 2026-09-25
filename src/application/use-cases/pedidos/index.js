import { UseCase } from '../../shared/UseCase.js';
import { CANALES_REALES } from '../../shared/canales.js';
import { existe } from '../../services/permisos.js';

/** Pedidos y solicitudes que registran los bots (WhatsApp y chat web). */

export class ListarPedidos extends UseCase {
  constructor({ pedidos }) {
    super();
    this.pedidos = pedidos;
  }

  ejecutar({ actor, estado, botId }) {
    const filtro = { canal: { $in: CANALES_REALES }, ...(estado ? { estado } : {}), ...(botId ? { botId } : {}) };
    return this.pedidos.listar(actor.empresaId, filtro, { orden: { createdAt: -1 }, limite: 300 });
  }
}

export class CambiarEstadoPedido extends UseCase {
  constructor({ pedidos }) {
    super();
    this.pedidos = pedidos;
  }

  async ejecutar({ actor, pedidoId, estado }) {
    return existe(await this.pedidos.actualizar(actor.empresaId, pedidoId, { estado }), 'Pedido no encontrado');
  }
}
