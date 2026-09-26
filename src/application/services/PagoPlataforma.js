import { PLANES } from '../../domain/planes/planes.js';

/**
 * Cobro mensual de FlujoBot a las empresas, con la cuenta de Mercado Pago de la plataforma
 * (MP_PLATAFORMA_TOKEN). Cada pago aprobado suma 30 días al plan elegido.
 */
export class PagoPlataforma {
  constructor({ token, mercadopago, empresas, apiUrl, urlFrontend, reloj = () => new Date() }) {
    Object.assign(this, { token, mercadopago, empresas, apiUrl, urlFrontend, reloj });
  }

  get configurado() {
    return Boolean(this.token);
  }

  async link(empresa, clave) {
    const plan = PLANES[clave];
    const r = await this.mercadopago.crearLink(this.token, {
      titulo: `FlujoBot plan ${plan.nombre} (1 mes) · ${empresa.nombre}`,
      total: plan.precio,
      moneda: 'MXN',
      referencia: `plan:${empresa.id}:${clave}`,
      urlAviso: `${this.apiUrl}/publico/pagos/plataforma`,
      urlRegreso: `${this.urlFrontend}/plan`,
    });
    return r.url;
  }

  async confirmar(pagoId) {
    const pago = await this.mercadopago.pago(this.token, pagoId);
    if (!pago.aprobado) return { aplicado: false, estado: pago.estado };
    const [tipo, empresaId, clave] = String(pago.referencia).split(':');
    if (tipo !== 'plan' || !PLANES[clave]) return { aplicado: false };
    const empresa = await this.empresas.obtener(empresaId);
    if (!empresa) return { aplicado: false };
    // Evita sumar dos veces el mismo pago si Mercado Pago repite el aviso
    if (empresa.plan?.ultimoPago === String(pagoId)) return { aplicado: true, repetido: true };
    const base = Math.max(this.reloj().getTime(), new Date(empresa.plan?.vence ?? 0).getTime());
    await this.empresas.actualizar(empresaId, { 'plan.clave': clave, 'plan.vence': new Date(base + 30 * 86400000), 'plan.ultimoPago': String(pagoId) });
    return { aplicado: true };
  }
}
