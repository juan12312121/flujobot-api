import { UseCase } from '../../shared/UseCase.js';
import { NoAutenticadoError, NoConfiguradoError, NoEncontradoError } from '../../shared/errors.js';
import { exigirAdmin } from '../../services/permisos.js';

/**
 * Cobros de la empresa (Mercado Pago / Stripe) y el panel del superadministrador.
 */

// ───── Cobros de la empresa a sus clientes ─────

export class ObtenerCobros extends UseCase {
  constructor({ cobros }) {
    super();
    this.cobros = cobros;
  }

  ejecutar({ actor }) {
    return this.cobros.estado(actor.empresaId);
  }
}

export class ConfigurarCobros extends UseCase {
  constructor({ cobros, bitacora }) {
    super();
    Object.assign(this, { cobros, bitacora });
  }

  async ejecutar({ actor, proveedor, llave, secretoWebhook }) {
    exigirAdmin(actor);
    const r = await this.cobros.configurar(actor.empresaId, { proveedor, llave, secretoWebhook });
    await this.bitacora.registrar(actor, 'empresa.cobros', { entidad: 'empresa', entidadId: actor.empresaId, detalle: proveedor });
    return r;
  }
}

/** Aviso de pago de Mercado Pago o Stripe para una empresa (público, lo llama la pasarela). */
export class RecibirAvisoPago extends UseCase {
  constructor({ cobros, eventoStripe, pagoIdMercadoPago }) {
    super();
    Object.assign(this, { cobros, eventoStripe, pagoIdMercadoPago });
  }

  async ejecutar({ proveedor, empresaId, query, cuerpo, crudo, firma }) {
    if (proveedor === 'mercadopago') {
      const pagoId = this.pagoIdMercadoPago({ query, cuerpo });
      if (!pagoId) return { ignorado: 'no es un pago' };
      return this.cobros.avisoMercadoPago(empresaId, pagoId);
    }
    if (proveedor === 'stripe') {
      const secreto = await this.cobros.secretoStripe(empresaId);
      const evento = this.eventoStripe(crudo, firma, secreto);
      if (!evento) throw new NoAutenticadoError('Firma de Stripe inválida');
      return this.cobros.avisoStripe(empresaId, evento);
    }
    throw new NoEncontradoError('Pasarela desconocida');
  }
}

// ───── Superadministrador ─────

export class ListarEmpresasAdmin extends UseCase {
  constructor({ empresas, bots }) {
    super();
    Object.assign(this, { empresas, bots });
  }

  async ejecutar({ texto }) {
    const [lista, bots] = await Promise.all([this.empresas.listarTodas({ texto }), this.bots.contarTodos()]);
    return lista.map((e) => ({
      id: e.id,
      nombre: e.nombre,
      giro: e.giro,
      activa: e.activa !== false,
      suspendidaMotivo: e.suspendidaMotivo ?? '',
      bots: bots.get(e.id) ?? 0,
      creada: e.createdAt,
    }));
  }
}

/** Suspender o reactivar una empresa (suspendida: nadie entra al panel y sus bots no contestan). */
export class ActualizarEmpresaAdmin extends UseCase {
  constructor({ empresas, bitacora }) {
    super();
    Object.assign(this, { empresas, bitacora });
  }

  async ejecutar({ actor, empresaId, activa, motivo }) {
    const e = await this.empresas.obtener(empresaId);
    if (!e) throw new NoEncontradoError('Empresa no encontrada');
    const r = await this.empresas.actualizar(empresaId, { activa, suspendidaMotivo: activa ? '' : (motivo ?? '') });
    // Queda en la bitácora de la empresa afectada: su admin ve quién la cambió
    const detalle = activa ? 'Reactivada' : `Suspendida${motivo ? `: ${motivo}` : ''}`;
    await this.bitacora.registrar({ ...actor, empresaId }, 'admin.empresa', { entidad: 'empresa', entidadId: empresaId, detalle });
    return r;
  }
}

// ───── Interno ─────

/** Vuelta del Programador disparada desde fuera (Uptime Kuma, n8n Schedule, cron del VPS). */
export class CorrerProgramador extends UseCase {
  constructor({ programador, cronSecreto, generador }) {
    super();
    Object.assign(this, { programador, cronSecreto, generador });
  }

  async ejecutar({ secreto }) {
    if (!this.cronSecreto) throw new NoConfiguradoError('Falta CRON_SECRETO en el servidor');
    if (!this.generador.iguales(secreto, this.cronSecreto)) throw new NoAutenticadoError('Secreto inválido');
    return this.programador.tick();
  }
}
