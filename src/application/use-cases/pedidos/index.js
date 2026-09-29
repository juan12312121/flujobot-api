import { UseCase } from '../../shared/UseCase.js';
import { CANALES_REALES } from '../../shared/canales.js';
import { existe } from '../../services/permisos.js';
import { ESTADO_PEDIDO_TEXTO } from '../../../domain/avisos/textos.js';
import { ESTADOS_REPARTIDOR } from '../../../domain/permisos/roles.js';
import { PermisoDenegadoError, ReglaDeNegocioError } from '../../../domain/shared/errors.js';

/** El repartidor solo toca los pedidos que tiene asignados. */
function exigirAsignado(actor, pedido) {
  if (actor.rol === 'repartidor' && pedido.repartidorId !== actor.id) throw new PermisoDenegadoError('Este pedido no está asignado a ti');
}

/** Pedidos y solicitudes que registran los bots (todos los canales). */

export class ListarPedidos extends UseCase {
  constructor({ pedidos }) {
    super();
    this.pedidos = pedidos;
  }

  ejecutar({ actor, estado, botId, pago, repartidorId }) {
    const filtro = {
      canal: { $in: CANALES_REALES },
      ...(actor.rol === 'repartidor' ? { repartidorId: actor.id } : repartidorId ? { repartidorId } : {}),
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
    exigirAsignado(actor, antes);
    if (actor.rol === 'repartidor' && !ESTADOS_REPARTIDOR.includes(estado)) {
      throw new PermisoDenegadoError('Como repartidor solo puedes marcar "En camino" o "Entregado"');
    }
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
    exigirAsignado(actor, existe(await this.pedidos.obtener(actor.empresaId, pedidoId), 'Pedido no encontrado'));
    const pedido = await this.pedidos.actualizar(actor.empresaId, pedidoId, { 'pago.estado': 'pagado', 'pago.pagadoEn': new Date(), 'pago.proveedor': 'manual' });
    await this.bitacora.registrar(actor, 'pedido.pagado', { entidad: 'pedido', entidadId: pedido.id, detalle: pedido.folio });
    return pedido;
  }
}

/** Asignar (o quitar) el repartidor de un pedido. */
export class AsignarRepartidor extends UseCase {
  constructor({ pedidos, usuarios, bitacora }) {
    super();
    Object.assign(this, { pedidos, usuarios, bitacora });
  }

  async ejecutar({ actor, pedidoId, usuarioId }) {
    if (actor.rol === 'repartidor') throw new PermisoDenegadoError('No puedes asignar pedidos');
    existe(await this.pedidos.obtener(actor.empresaId, pedidoId), 'Pedido no encontrado');
    let cambios = { repartidorId: '', repartidorNombre: '' };
    if (usuarioId) {
      const u = existe(await this.usuarios.obtener(actor.empresaId, usuarioId), 'Usuario no encontrado');
      if (u.rol !== 'repartidor') throw new ReglaDeNegocioError('NO_ES_REPARTIDOR', `${u.nombre} no tiene el rol de repartidor`);
      cambios = { repartidorId: u.id, repartidorNombre: u.nombre };
    }
    const pedido = await this.pedidos.actualizar(actor.empresaId, pedidoId, cambios);
    await this.bitacora.registrar(actor, 'pedido.repartidor', { entidad: 'pedido', entidadId: pedidoId, detalle: `${pedido.folio}: ${cambios.repartidorNombre || 'sin repartidor'}` });
    return pedido;
  }
}
