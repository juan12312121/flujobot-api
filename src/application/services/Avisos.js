import { interpolar, dinero } from '../../domain/flujo/texto.js';
import { aLocal, nombreDia } from '../../domain/agenda/disponibilidad.js';
import { textoAviso, limpiarTexto, ESTADOS_PEDIDO_AVISADOS, ESTADOS_CITA_AVISADOS } from '../../domain/avisos/textos.js';
import { CANALES_REALES } from '../shared/canales.js';

const HORA = 3600_000;

/**
 * Lo que el bot le escribe al cliente sin que él pregunte:
 * - cambios de estado de su pedido o cita (desde el panel),
 * - pago recibido,
 * - recordatorios de cita un día y una hora antes (con "1 confirmar / 2 cancelar"),
 * - encuesta al entregar un pedido.
 *
 * Todo sale con el Mensajero por el canal donde el cliente hizo el pedido o la cita.
 */
export class Avisos {
  constructor({ empresas, bots, citas, pedidos, mensajero, programador, reloj = () => new Date() }) {
    Object.assign(this, { empresas, bots, citas, pedidos, mensajero, programador, reloj });
  }

  // ───── Pedidos ─────

  async pedidoCambioEstado(pedido) {
    if (!ESTADOS_PEDIDO_AVISADOS.includes(pedido.estado) || !CANALES_REALES.includes(pedido.canal)) return { enviado: false };
    const empresa = await this.empresas.obtener(pedido.empresaId);
    if (empresa?.avisos?.pedidos === false) return { enviado: false };
    const r = await this.#enviarPedido(empresa, pedido, `pedido.${pedido.estado}`);
    if (pedido.estado === 'entregado' && empresa?.avisos?.encuestaAlEntregar) await this.#encuestaPedido(empresa, pedido);
    return r;
  }

  async pedidoPagado(pedido) {
    if (!CANALES_REALES.includes(pedido.canal)) return { enviado: false };
    const empresa = await this.empresas.obtener(pedido.empresaId);
    return this.#enviarPedido(empresa, pedido, 'pedido.pagado');
  }

  async #enviarPedido(empresa, pedido, clave, cambios = {}) {
    const bot = await this.bots.obtener(pedido.empresaId, pedido.botId);
    if (!bot) return { enviado: false, motivo: 'el bot ya no existe' };
    const texto = limpiarTexto(interpolar(textoAviso(empresa, clave), this.#variablesPedido(empresa, pedido)));
    const r = await this.mensajero.enviar({ bot, canal: pedido.canal, contacto: pedido.contacto, nombre: pedido.nombreContacto, respuestas: [{ texto }], de: 'sistema', autor: 'Aviso automático', cambios });
    return { enviado: r.ok, error: r.error };
  }

  async #encuestaPedido(empresa, pedido) {
    const hasta = new Date(this.reloj().getTime() + 72 * HORA);
    await this.#enviarPedido(empresa, pedido, 'encuesta.pedido', { pendiente: { tipo: 'calificar_pedido', pedidoId: pedido.id, folio: pedido.folio, hasta } });
  }

  #variablesPedido(empresa, pedido) {
    return {
      // El nombre que dio en el flujo gana al de WhatsApp (el chat web no trae nombre)
      nombre: primerNombre(pedido.datos?.cliente || pedido.datos?.nombre || pedido.nombreContacto),
      folio: pedido.folio,
      total: dinero(pedido.total, empresa?.moneda),
      pedido: (empresa?.terminos?.pedido ?? 'pedido').toLowerCase(),
      empresa: empresa?.nombre ?? '',
    };
  }

  // ───── Módulos personalizados ─────

  /** Cambió un campo con "avisar" (p. ej. Estado de una orden de servicio): se le escribe al cliente. */
  async registroCambio(modulo, registro, campo) {
    const telefono = modulo.campos.find((c) => c.tipo === 'telefono' && registro.datos?.[c.id]);
    const porBot = CANALES_REALES.includes(registro.canal) && registro.contacto;
    const canal = porBot ? registro.canal : 'whatsapp';
    const contacto = porBot ? registro.contacto : registro.datos?.[telefono?.id];
    if (!contacto) return { enviado: false, motivo: 'el registro no tiene teléfono ni conversación' };
    const bot = (registro.botId && (await this.bots.obtener(registro.empresaId, registro.botId))) || (await this.bots.principal(registro.empresaId));
    if (!bot) return { enviado: false, motivo: 'la empresa no tiene un bot publicado' };
    const empresa = await this.empresas.obtener(registro.empresaId);
    const primerTexto = modulo.campos.find((c) => c.tipo === 'texto' && registro.datos?.[c.id]);
    const variables = {
      nombre: primerNombre(registro.nombreContacto || registro.datos?.[primerTexto?.id]),
      registro: modulo.singular.toLowerCase(),
      folio: registro.folio,
      valor: registro.datos?.[campo.id],
      empresa: empresa?.nombre ?? '',
    };
    const texto = limpiarTexto(interpolar(textoAviso(empresa, 'registro.cambio'), variables));
    const r = await this.mensajero.enviar({ bot, canal, contacto, nombre: variables.nombre, respuestas: [{ texto }], de: 'sistema', autor: 'Aviso automático' });
    return { enviado: r.ok, error: r.error };
  }

  // ───── Citas ─────

  async citaCambioEstado(cita) {
    if (cita.estado === 'cancelada') await this.cancelarRecordatorios(cita.id);
    if (!ESTADOS_CITA_AVISADOS.includes(cita.estado)) return { enviado: false };
    const empresa = await this.empresas.obtener(cita.empresaId);
    if (empresa?.avisos?.citas === false) return { enviado: false };
    return this.#enviarCita(empresa, cita, `cita.${cita.estado}`);
  }

  /** Programa los recordatorios (24 h y 1 h antes) si la empresa los tiene prendidos y hay a quién escribirle. */
  async programarRecordatorios(citaOId, empresaId) {
    const cita = typeof citaOId === 'string' ? await this.citas.obtener(empresaId, citaOId) : citaOId;
    if (!cita || !cita.contacto || cita.canal === 'simulador' || ['cancelada', 'atendida', 'no_asistio'].includes(cita.estado)) return [];
    const empresa = await this.empresas.obtener(cita.empresaId);
    const a = empresa?.avisos ?? {};
    const ahora = this.reloj().getTime();
    const inicio = new Date(cita.inicio).getTime();
    const programados = [];
    const planes = [
      ['dia', a.recordatorioDia !== false, inicio - 24 * HORA, ahora + HORA],
      ['hora', a.recordatorioHora !== false, inicio - HORA, ahora + 10 * 60_000],
    ];
    for (const [cual, activo, cuando, minimo] of planes) {
      if (!activo || cuando < minimo) continue;
      await this.programador.programar({
        empresaId: cita.empresaId,
        tipo: 'recordatorio_cita',
        clave: `cita:${cita.id}:${cual}`,
        ejecutarEn: new Date(cuando),
        datos: { empresaId: cita.empresaId, citaId: cita.id, cual },
      });
      programados.push(cual);
    }
    return programados;
  }

  cancelarRecordatorios(citaId) {
    return this.programador.cancelar(`cita:${citaId}:`);
  }

  /** Manejador de la tarea "recordatorio_cita". */
  async enviarRecordatorio({ empresaId, citaId, cual }) {
    const cita = await this.citas.obtener(empresaId, citaId);
    if (!cita || !['pendiente', 'confirmada'].includes(cita.estado)) return;
    if (cita.recordatorios?.[cual]) return; // ya se mandó (reintento)
    const empresa = await this.empresas.obtener(empresaId);
    const pendiente = { tipo: 'confirmar_cita', citaId: cita.id, folio: cita.folio, hasta: new Date(cita.inicio) };
    const r = await this.#enviarCita(empresa, cita, `recordatorio.${cual}`, cita.estado === 'confirmada' && cual === 'hora' ? {} : { pendiente });
    if (!r.enviado && r.error) throw new Error(r.error);
    await this.citas.actualizar(empresaId, citaId, { [`recordatorios.${cual}`]: this.reloj() });
  }

  async #enviarCita(empresa, cita, clave, cambios = {}) {
    const canal = cita.canal === 'panel' ? 'whatsapp' : cita.canal;
    if (!CANALES_REALES.includes(canal) || !cita.contacto) return { enviado: false, motivo: 'sin contacto' };
    const bot = cita.botId ? await this.bots.obtener(cita.empresaId, cita.botId) : await this.bots.principal(cita.empresaId);
    if (!bot) return { enviado: false, motivo: 'la empresa no tiene un bot publicado' };
    const zona = empresa?.zonaHoraria ?? 'America/Mexico_City';
    const l = aLocal(new Date(cita.inicio), zona);
    const variables = {
      nombre: primerNombre(cita.nombreContacto),
      folio: cita.folio,
      cita: (empresa?.terminos?.cita ?? 'cita').toLowerCase(),
      servicio: cita.servicio ? `de *${cita.servicio}*` : '',
      fecha: nombreDia(l.fecha),
      hora: l.hora,
      empresa: empresa?.nombre ?? '',
    };
    const texto = limpiarTexto(interpolar(textoAviso(empresa, clave), variables));
    const r = await this.mensajero.enviar({ bot, canal, contacto: cita.contacto, nombre: cita.nombreContacto, respuestas: [{ texto }], de: 'sistema', autor: 'Aviso automático', cambios });
    return { enviado: r.ok, error: r.error };
  }
}

const primerNombre = (n) => String(n ?? '').trim().split(/\s+/)[0] ?? '';
