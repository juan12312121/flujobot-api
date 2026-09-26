import { NoConfiguradoError } from '../shared/errors.js';
import { ReglaDeNegocioError } from '../../domain/shared/errors.js';

/**
 * Cobro dentro de la plática: el bloque Pedido pide un link de pago (Mercado Pago o Stripe, con la cuenta
 * de la empresa) y el aviso de la pasarela marca el pedido como pagado y le avisa al cliente.
 */
export class Cobros {
  constructor({ empresas, pedidos, cifrador, mercadopago, stripe, avisos, apiUrl, urlFrontend }) {
    Object.assign(this, { empresas, pedidos, cifrador, mercadopago, stripe, avisos, apiUrl, urlFrontend });
  }

  /** Estado para "Mi empresa → Cobros" (nunca las llaves). */
  async estado(empresaId) {
    const e = await this.empresas.conSecretosDePago(empresaId);
    const proveedor = e?.pagos?.proveedor ?? 'ninguno';
    return {
      proveedor,
      configurado: proveedor !== 'ninguno' && Boolean(e?.pagos?.llaveCifrada),
      urlAviso: proveedor === 'ninguno' ? '' : this.#urlAviso(proveedor, empresaId),
      pideSecretoWebhook: proveedor === 'stripe',
      secretoWebhook: Boolean(e?.pagos?.secretoWebhookCifrado),
    };
  }

  /** Guarda (cifradas) las llaves después de validarlas con la pasarela. Llave vacía = no cambiarla. */
  async configurar(empresaId, { proveedor, llave, secretoWebhook }) {
    const cambios = { 'pagos.proveedor': proveedor };
    if (proveedor !== 'ninguno' && llave) {
      const cliente = proveedor === 'stripe' ? this.stripe : this.mercadopago;
      await cliente.validar(llave).catch((e) => {
        throw new ReglaDeNegocioError('LLAVE_INVALIDA', `La llave no funcionó: ${e.message}`);
      });
      cambios['pagos.llaveCifrada'] = this.cifrador.cifrar(llave);
    }
    if (secretoWebhook) cambios['pagos.secretoWebhookCifrado'] = this.cifrador.cifrar(secretoWebhook);
    if (proveedor === 'ninguno') Object.assign(cambios, { 'pagos.llaveCifrada': '', 'pagos.secretoWebhookCifrado': '' });
    await this.empresas.actualizar(empresaId, cambios);
    return this.estado(empresaId);
  }

  /** Link de pago para un pedido recién registrado, o null si la empresa no configuró cobros. */
  async link({ empresaId, pedido, canal }) {
    const e = await this.empresas.conSecretosDePago(empresaId);
    const proveedor = e?.pagos?.proveedor;
    const llave = this.cifrador.descifrar(e?.pagos?.llaveCifrada);
    if (!proveedor || proveedor === 'ninguno' || !llave) return null;
    if (canal === 'simulador') return 'https://ejemplo.flujobot/pago-de-prueba (en WhatsApp aquí va el link real)';

    const datos = {
      titulo: `${e.nombre} · ${e.terminos?.pedido ?? 'Pedido'} ${pedido.folio}`,
      total: pedido.total,
      moneda: e.moneda ?? 'MXN',
      referencia: `pedido:${pedido.id}`,
      urlAviso: this.#urlAviso(proveedor, empresaId),
      urlRegreso: `${this.urlFrontend}/pago-listo`,
      metadata: { empresaId, pedidoId: pedido.id },
    };
    const r = proveedor === 'stripe' ? await this.stripe.crearLink(llave, datos) : await this.mercadopago.crearLink(llave, datos);
    await this.pedidos.actualizar(empresaId, pedido.id, { pago: { estado: 'pendiente', proveedor, url: r.url, referencia: r.id, pagadoEn: null } });
    return r.url;
  }

  /** Aviso de Mercado Pago: se pregunta el pago con la llave de la empresa y, si está aprobado, se marca. */
  async avisoMercadoPago(empresaId, pagoId) {
    const e = await this.empresas.conSecretosDePago(empresaId);
    const llave = this.cifrador.descifrar(e?.pagos?.llaveCifrada);
    if (!llave) throw new NoConfiguradoError('La empresa no tiene Mercado Pago configurado');
    const pago = await this.mercadopago.pago(llave, pagoId);
    if (!pago.aprobado) return { marcado: false, estado: pago.estado };
    return this.#marcarPagado(empresaId, pago.referencia, String(pagoId));
  }

  /** Evento de Stripe ya verificado con la firma. */
  async avisoStripe(empresaId, evento) {
    if (evento?.type !== 'checkout.session.completed') return { marcado: false };
    const sesion = evento.data?.object ?? {};
    if (sesion.payment_status !== 'paid') return { marcado: false };
    return this.#marcarPagado(empresaId, sesion.metadata?.referencia ?? sesion.client_reference_id, sesion.id);
  }

  async secretoStripe(empresaId) {
    const e = await this.empresas.conSecretosDePago(empresaId);
    return this.cifrador.descifrar(e?.pagos?.secretoWebhookCifrado);
  }

  async #marcarPagado(empresaId, referencia, idPago) {
    const pedidoId = String(referencia ?? '').startsWith('pedido:') ? referencia.slice(7) : null;
    if (!pedidoId) return { marcado: false };
    const pedido = await this.pedidos.obtener(empresaId, pedidoId);
    if (!pedido) return { marcado: false };
    if (pedido.pago?.estado === 'pagado') return { marcado: true, repetido: true };
    const actualizado = await this.pedidos.actualizar(empresaId, pedidoId, {
      'pago.estado': 'pagado',
      'pago.pagadoEn': new Date(),
      'pago.referencia': idPago,
      ...(pedido.estado === 'nuevo' ? { estado: 'confirmado' } : {}),
    });
    await this.avisos.pedidoPagado(actualizado).catch((e) => console.warn('No se avisó el pago:', e.message));
    return { marcado: true };
  }

  #urlAviso(proveedor, empresaId) {
    return `${this.apiUrl}/publico/pagos/${proveedor}/${empresaId}`;
  }
}
