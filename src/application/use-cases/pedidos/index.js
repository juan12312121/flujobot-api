import { UseCase } from '../../shared/UseCase.js';
import { CANALES_REALES } from '../../shared/canales.js';
import { existe } from '../../services/permisos.js';
import { ESTADO_PEDIDO_TEXTO } from '../../../domain/avisos/textos.js';

/** Pedidos y solicitudes que registran los bots (todos los canales). */

export class ListarPedidos extends UseCase {
  constructor({ pedidos }) {
    super();
    this.pedidos = pedidos;
  }

  ejecutar({ actor, estado, botId, pago }) {
    const filtro = {
      canal: { $in: CANALES_REALES },
      ...(estado ? { estado } : {}),
      ...(botId ? { botId } : {}),
      ...(pago ? { 'pago.estado': pago } : {}),
    };
    return this.pedidos.listar(actor.empresaId, filtro, { orden: { createdAt: -1 }, limite: 300 });
  }
}

/** Cambia el estado y (si la empresa lo tiene prendido) le avisa al cliente por su canal. */
export class CambiarEstadoPedido extends UseCase {
  constructor({ pedidos, avisos, bitacora }) {
    super();
    Object.assign(this, { pedidos, avisos, bitacora });
  }

  async ejecutar({ actor, pedidoId, estado, avisar = true }) {
    const antes = existe(await this.pedidos.obtener(actor.empresaId, pedidoId), 'Pedido no encontrado');
    const pedido = await this.pedidos.actualizar(actor.empresaId, pedidoId, { estado });
    let aviso = { enviado: false };
    if (avisar && antes.estado !== estado) aviso = await this.avisos.pedidoCambioEstado(pedido).catch((e) => ({ enviado: false, error: e.message }));
    await this.bitacora.registrar(actor, 'pedido.estado', { entidad: 'pedido', entidadId: pedido.id, detalle: `${pedido.folio}: ${ESTADO_PEDIDO_TEXTO[antes.estado]} → ${ESTADO_PEDIDO_TEXTO[estado]}` });
    return { ...pedido, aviso };
  }
}

/** Pago recibido por fuera (efectivo, transferencia): se marca a mano. */
export class MarcarPedidoPagado extends UseCase {
  constructor({ pedidos, bitacora }) {
    super();
    Object.assign(this, { pedidos, bitacora });
  }

  async ejecutar({ actor, pedidoId }) {
    const pedido = existe(
      await this.pedidos.actualizar(actor.empresaId, pedidoId, { 'pago.estado': 'pagado', 'pago.pagadoEn': new Date(), 'pago.proveedor': 'manual' }),
      'Pedido no encontrado',
    );
    await this.bitacora.registrar(actor, 'pedido.pagado', { entidad: 'pedido', entidadId: pedido.id, detalle: pedido.folio });
    return pedido;
  }
}
