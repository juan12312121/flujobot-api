import { UseCase } from '../../shared/UseCase.js';
import { CANALES_REALES } from '../../shared/canales.js';
import { aLocal, localAUtc } from '../../../domain/agenda/disponibilidad.js';

/** Números de la pantalla de inicio de la empresa. */
export class ObtenerResumen extends UseCase {
  constructor({ bots, productos, pedidos, conversaciones, citas, empresas, encuestas, limites, reloj = () => new Date() }) {
    super();
    Object.assign(this, { bots, productos, pedidos, conversaciones, citas, empresas, encuestas, limites, reloj });
  }

  async ejecutar({ actor }) {
    const e = actor.empresaId;
    const ahora = this.reloj();
    const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    const hace24h = new Date(ahora - 24 * 3600_000);
    const empresa = await this.empresas.obtener(e);
    const zona = empresa?.zonaHoraria ?? 'America/Mexico_City';
    const hoyLocal = aLocal(ahora, zona).fecha;
    const inicioHoy = localAUtc(hoyLocal, '00:00', zona);
    const [bots, productos, pendientes, conversacionesHoy, esperandoAsesor, mes, ultimos, citasHoy, proximas] = await Promise.all([
      this.bots.contar(e),
      this.productos.contar(e, { activo: true }),
      this.pedidos.contar(e, { canal: { $in: CANALES_REALES }, estado: 'nuevo' }),
      this.conversaciones.contar(e, { canal: { $in: CANALES_REALES }, actualizadoEn: { $gte: hace24h } }),
      this.conversaciones.contar(e, { canal: { $in: CANALES_REALES }, estado: 'humano' }),
      this.pedidos.ventasDesde(e, inicioMes),
      this.pedidos.listar(e, { canal: { $in: CANALES_REALES } }, { limite: 5 }),
      this.citas.contar(e, { canal: { $ne: 'simulador' }, inicio: { $gte: inicioHoy, $lt: new Date(inicioHoy.getTime() + 86400000) }, estado: { $ne: 'cancelada' } }),
      this.citas.listar(e, { canal: { $ne: 'simulador' }, inicio: { $gte: ahora }, estado: { $in: ['pendiente', 'confirmada'] } }, { orden: { inicio: 1 }, limite: 5 }),
    ]);
    const hace30 = new Date(ahora - 30 * 86400000);
    const [satisfaccion, recuperados, plan] = await Promise.all([
      this.encuestas ? this.encuestas.resumen(e, hace30) : null,
      this.pedidos.contar(e, { recuperado: true, createdAt: { $gte: inicioMes } }),
      this.limites ? this.limites.estado(empresa) : null,
    ]);
    return {
      bots,
      productos,
      pedidosPendientes: pendientes,
      conversacionesHoy,
      esperandoAsesor,
      ventasMes: mes,
      ultimosPedidos: ultimos,
      citasHoy,
      proximasCitas: proximas,
      satisfaccion,
      carritosRecuperados: recuperados,
      plan: plan && { nombre: plan.nombre, vigente: plan.vigente, diasRestantes: plan.diasRestantes, clave: plan.clave, uso: plan.uso, limites: plan.limites },
    };
  }
}
