import { PLANES, planDe, planVigente, mesDe, diasRestantes } from '../../domain/planes/planes.js';
import { ReglaDeNegocioError } from '../../domain/shared/errors.js';

/** Recursos que se cuentan por mes contra el plan. */
const RECURSOS = { conversaciones: 'conversaciones nuevas', ia: 'respuestas con IA', campanas: 'mensajes de campaña' };

/**
 * Planes y consumo de cada empresa: qué puede usar, cuánto lleva en el mes y si su plan sigue vigente.
 * Cuando se pasa un límite el bot no se cae: deja de abrir conversaciones nuevas (o de usar IA) hasta el siguiente mes.
 */
export class Limites {
  constructor({ empresas, usos, bots, reloj = () => new Date() }) {
    Object.assign(this, { empresas, usos, bots, reloj });
  }

  async #empresa(empresaOId) {
    return typeof empresaOId === 'string' ? this.empresas.obtener(empresaOId) : empresaOId;
  }

  /** Lo que ve "Mi plan": plan, vencimiento, uso del mes y límites. */
  async estado(empresaOId) {
    const empresa = await this.#empresa(empresaOId);
    const plan = planDe(empresa);
    const [uso, bots] = await Promise.all([this.usos.obtener(empresa.id, mesDe(this.reloj())), this.bots.contar(empresa.id)]);
    return {
      clave: empresa.plan?.clave ?? 'prueba',
      nombre: plan.nombre,
      precio: plan.precio,
      vence: empresa.plan?.vence ?? null,
      diasRestantes: diasRestantes(empresa, this.reloj()),
      vigente: planVigente(empresa, this.reloj()),
      activa: empresa.activa !== false,
      uso: { ...uso, bots },
      limites: { conversaciones: plan.conversaciones, ia: plan.ia, campanas: plan.campanas, bots: plan.bots },
      canales: plan.canales,
      planes: Object.entries(PLANES).map(([clave, p]) => ({ clave, ...p })),
    };
  }

  /** ¿Puede gastar `n` de `recurso` este mes? (false también si la empresa está suspendida o el plan venció). */
  async puede(empresaOId, recurso, n = 1) {
    const empresa = await this.#empresa(empresaOId);
    if (!empresa || empresa.activa === false || !planVigente(empresa, this.reloj())) return false;
    const limite = planDe(empresa)[recurso];
    if (limite == null) return true;
    const uso = await this.usos.obtener(empresa.id, mesDe(this.reloj()));
    return uso[recurso] + n <= limite;
  }

  /** Cuánto le queda de un recurso este mes. */
  async restante(empresaOId, recurso) {
    const empresa = await this.#empresa(empresaOId);
    const uso = await this.usos.obtener(empresa.id, mesDe(this.reloj()));
    return Math.max(0, planDe(empresa)[recurso] - uso[recurso]);
  }

  sumar(empresaId, recurso, n = 1) {
    return this.usos.sumar(empresaId, mesDe(this.reloj()), recurso, n).catch((e) => console.warn('No se contó el uso:', e.message));
  }

  async exigirVigente(empresaOId) {
    const empresa = await this.#empresa(empresaOId);
    if (!planVigente(empresa, this.reloj())) {
      throw new ReglaDeNegocioError('PLAN_VENCIDO', 'Tu plan venció. Elige un plan en "Mi plan" para seguir usando esta función.');
    }
    return empresa;
  }

  async exigir(empresaOId, recurso, n = 1) {
    const empresa = await this.exigirVigente(empresaOId);
    if (!(await this.puede(empresa, recurso, n))) {
      const plan = planDe(empresa);
      throw new ReglaDeNegocioError('LIMITE_PLAN', `Tu plan ${plan.nombre} incluye ${plan[recurso]} ${RECURSOS[recurso]} al mes y ya no alcanza. Sube de plan en "Mi plan".`);
    }
  }

  async exigirBotNuevo(empresaId) {
    const empresa = await this.exigirVigente(empresaId);
    const plan = planDe(empresa);
    if ((await this.bots.contar(empresaId)) >= plan.bots) {
      throw new ReglaDeNegocioError('LIMITE_PLAN', `Tu plan ${plan.nombre} permite ${plan.bots} bot(s). Sube de plan en "Mi plan" para crear más.`);
    }
  }

  canalPermitido(empresa, canal) {
    return canal === 'simulador' || planDe(empresa).canales.includes(canal);
  }

  exigirCanal(empresa, canal) {
    if (!this.canalPermitido(empresa, canal)) {
      throw new ReglaDeNegocioError('LIMITE_PLAN', `Tu plan ${planDe(empresa).nombre} no incluye ${canal}. Sube de plan en "Mi plan".`);
    }
  }

  /** Envuelve al RespondedorIA: sin saldo de IA contesta "no sé" (el flujo sigue por "No supo") y cada respuesta se cuenta. */
  conLimiteIA(respondedor) {
    return {
      responder: async (entrada) => {
        if (!(await this.puede(entrada.empresaId, 'ia'))) return null;
        const r = await respondedor.responder(entrada);
        await this.sumar(entrada.empresaId, 'ia');
        return r;
      },
    };
  }
}
