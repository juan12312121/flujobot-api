import { UseCase } from '../../shared/UseCase.js';
import { NoAutenticadoError, NoConfiguradoError, NoEncontradoError } from '../../shared/errors.js';
import { ReglaDeNegocioError } from '../../../domain/shared/errors.js';
import { PLANES, PLANES_DE_PAGO, planDe, planVigente, mesDe } from '../../../domain/planes/planes.js';
import { exigirAdmin } from '../../services/permisos.js';

/**
 * Cobros de la empresa (Mercado Pago / Stripe), el plan de FlujoBot y el panel del superadministrador.
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

// ───── Plan de FlujoBot ─────

export class ObtenerPlan extends UseCase {
  constructor({ limites, pagoPlataforma }) {
    super();
    Object.assign(this, { limites, pagoPlataforma });
  }

  async ejecutar({ actor }) {
    return { ...(await this.limites.estado(actor.empresaId)), pagoEnLinea: this.pagoPlataforma.configurado };
  }
}

/** Link de Mercado Pago (cuenta de FlujoBot) para pagar un mes del plan elegido. */
export class PagarPlan extends UseCase {
  constructor({ empresas, pagoPlataforma, bitacora }) {
    super();
    Object.assign(this, { empresas, pagoPlataforma, bitacora });
  }

  async ejecutar({ actor, plan }) {
    exigirAdmin(actor);
    if (!PLANES_DE_PAGO.includes(plan)) throw new ReglaDeNegocioError('PLAN_INVALIDO', 'Elige un plan de pago');
    if (!this.pagoPlataforma.configurado) throw new NoConfiguradoError('El pago en línea aún no está disponible: escríbenos para activar tu plan');
    const empresa = await this.empresas.obtener(actor.empresaId);
    const url = await this.pagoPlataforma.link(empresa, plan);
    await this.bitacora.registrar(actor, 'plan.pagar', { entidad: 'empresa', entidadId: empresa.id, detalle: PLANES[plan].nombre });
    return { url };
  }
}

export class RecibirPagoPlataforma extends UseCase {
  constructor({ pagoPlataforma, pagoIdMercadoPago }) {
    super();
    Object.assign(this, { pagoPlataforma, pagoIdMercadoPago });
  }

  async ejecutar({ query, cuerpo }) {
    const pagoId = this.pagoIdMercadoPago({ query, cuerpo });
    if (!pagoId) return { ignorado: 'no es un pago' };
    return this.pagoPlataforma.confirmar(pagoId);
  }
}

// ───── Superadministrador ─────

export class ListarEmpresasAdmin extends UseCase {
  constructor({ empresas, usos, bots, usuarios, reloj = () => new Date() }) {
    super();
    Object.assign(this, { empresas, usos, bots, usuarios, reloj });
  }

  async ejecutar({ texto }) {
    const mes = mesDe(this.reloj());
    const [lista, usos, bots] = await Promise.all([this.empresas.listarTodas({ texto }), this.usos.delMes(mes), this.bots.contarTodos()]);
    return lista.map((e) => {
      const plan = planDe(e);
      return {
        id: e.id,
        nombre: e.nombre,
        giro: e.giro,
        activa: e.activa !== false,
        suspendidaMotivo: e.suspendidaMotivo ?? '',
        plan: e.plan?.clave ?? 'prueba',
        planNombre: plan.nombre,
        vence: e.plan?.vence ?? null,
        vigente: planVigente(e, this.reloj()),
        bots: bots.get(e.id) ?? 0,
        uso: usos.get(e.id) ?? { conversaciones: 0, ia: 0, campanas: 0 },
        limites: { conversaciones: plan.conversaciones, ia: plan.ia, campanas: plan.campanas },
        creada: e.createdAt,
      };
    });
  }
}

/** Suspender/reactivar, cambiar de plan o mover el vencimiento de una empresa. */
export class ActualizarEmpresaAdmin extends UseCase {
  constructor({ empresas, bitacora }) {
    super();
    Object.assign(this, { empresas, bitacora });
  }

  async ejecutar({ actor, empresaId, activa, motivo, plan, vence, sumarDias }) {
    const e = await this.empresas.obtener(empresaId);
    if (!e) throw new NoEncontradoError('Empresa no encontrada');
    const cambios = {};
    if (activa !== undefined) Object.assign(cambios, { activa, suspendidaMotivo: activa ? '' : (motivo ?? '') });
    if (plan) cambios['plan.clave'] = plan;
    if (vence) cambios['plan.vence'] = new Date(vence);
    if (sumarDias) {
      const base = Math.max(Date.now(), new Date(e.plan?.vence ?? Date.now()).getTime());
      cambios['plan.vence'] = new Date(base + sumarDias * 86400000);
    }
    const r = await this.empresas.actualizar(empresaId, cambios);
    // Queda en la bitácora de la empresa afectada: su admin ve quién la cambió
    await this.bitacora.registrar({ ...actor, empresaId }, 'admin.empresa', { entidad: 'empresa', entidadId: empresaId, detalle: JSON.stringify({ activa, plan, vence, sumarDias }) });
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
