import crypto from 'node:crypto';
import { ServicioExternoError } from '../../application/shared/errors.js';
import { firmaValida } from '../security/Cifrador.js';

/**
 * Pasarelas de pago. No se usan SDKs: son dos llamadas REST cada una.
 * Las llaves son de cada empresa (las pega en "Mi empresa → Cobros"); la plataforma usa las suyas para cobrar el plan.
 */

async function json(r, quien) {
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new ServicioExternoError(`${quien}: ${datos.message ?? datos.error?.message ?? r.status}`);
  return datos;
}

export class MercadoPagoCliente {
  /**
   * Link de pago (Checkout Pro). `referencia` vuelve en el webhook para saber qué se pagó.
   * @returns {Promise<{ url: string, id: string }>}
   */
  async crearLink(token, { titulo, total, moneda = 'MXN', referencia, urlAviso, urlRegreso }) {
    const r = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        items: [{ title: titulo.slice(0, 250), quantity: 1, unit_price: Math.round(total * 100) / 100, currency_id: moneda }],
        external_reference: referencia,
        notification_url: urlAviso,
        ...(urlRegreso ? { back_urls: { success: urlRegreso, failure: urlRegreso, pending: urlRegreso }, auto_return: 'approved' } : {}),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const d = await json(r, 'Mercado Pago');
    return { url: d.init_point, id: d.id };
  }

  /** El aviso de Mercado Pago solo trae el id: el estado real se pregunta con la llave del dueño (así no se puede falsificar). */
  async pago(token, pagoId) {
    const r = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(pagoId)}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    const d = await json(r, 'Mercado Pago');
    return { aprobado: d.status === 'approved', estado: d.status, referencia: d.external_reference ?? '', monto: d.transaction_amount };
  }

  /** Valida la llave antes de guardarla. */
  async validar(token) {
    const r = await fetch('https://api.mercadopago.com/users/me', { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    const d = await json(r, 'Mercado Pago');
    return { cuenta: d.nickname ?? d.email ?? String(d.id) };
  }
}

/** Id del pago en el aviso de Mercado Pago (llega en el cuerpo o en la query según la versión del webhook). */
export function pagoIdMercadoPago({ query = {}, cuerpo = {} }) {
  const tipo = cuerpo.type ?? cuerpo.topic ?? query.type ?? query.topic;
  if (tipo && tipo !== 'payment') return null;
  return cuerpo.data?.id ?? query['data.id'] ?? query.id ?? null;
}

export class StripeCliente {
  async #llamar(llave, ruta, campos) {
    const r = await fetch(`https://api.stripe.com/v1${ruta}`, {
      method: campos ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${llave}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: campos ? new URLSearchParams(campos) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    return json(r, 'Stripe');
  }

  async crearLink(llave, { titulo, total, moneda = 'MXN', referencia, metadata = {}, urlRegreso }) {
    const d = await this.#llamar(llave, '/checkout/sessions', {
      mode: 'payment',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': moneda.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(Math.round(total * 100)),
      'line_items[0][price_data][product_data][name]': titulo.slice(0, 250),
      client_reference_id: referencia,
      success_url: urlRegreso,
      cancel_url: urlRegreso,
      ...Object.fromEntries(Object.entries({ ...metadata, referencia }).map(([k, v]) => [`metadata[${k}]`, String(v)])),
    });
    return { url: d.url, id: d.id };
  }

  async validar(llave) {
    const d = await this.#llamar(llave, '/balance');
    return { cuenta: d.livemode ? 'modo real' : 'modo de prueba' };
  }
}

/**
 * Verifica la cabecera Stripe-Signature ("t=...,v1=...") contra el cuerpo crudo y devuelve el evento.
 * Tolerancia de 5 minutos para que no se pueda reenviar un aviso viejo.
 */
export function eventoStripe(cuerpoCrudo, cabecera, secreto, ahora = Date.now()) {
  const partes = Object.fromEntries(String(cabecera ?? '').split(',').map((p) => p.split('=')));
  const t = Number(partes.t);
  if (!t || Math.abs(ahora / 1000 - t) > 300) return null;
  if (!firmaValida(secreto, `${t}.${cuerpoCrudo}`, partes.v1)) return null;
  try {
    return JSON.parse(cuerpoCrudo);
  } catch {
    return null;
  }
}

export const referenciaAleatoria = () => crypto.randomBytes(6).toString('hex');
