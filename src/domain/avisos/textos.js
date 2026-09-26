/**
 * Textos que el bot manda por su cuenta (no como respuesta a un mensaje): cambios de estado,
 * recordatorios y campañas. Cada empresa puede cambiarlos en "Mi empresa → Avisos".
 * Variables: {{nombre}}, {{folio}}, {{total}}, {{pedido}}, {{cita}}, {{servicio}}, {{fecha}}, {{hora}}, {{empresa}}.
 */

/** Cómo se le dice al cliente cada estado del pedido. */
export const ESTADO_PEDIDO_TEXTO = {
  nuevo: 'Recibido',
  confirmado: 'Confirmado',
  preparando: 'En preparación',
  enviado: 'En camino',
  listo: 'Listo para recoger',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
};

export const ESTADO_CITA_TEXTO = {
  pendiente: 'Agendada',
  confirmada: 'Confirmada',
  atendida: 'Atendida',
  cancelada: 'Cancelada',
  no_asistio: 'No asistió',
};

export const PAGO_TEXTO = { sin_cobro: '', pendiente: 'pago pendiente', pagado: 'pagado', fallido: 'pago rechazado' };

export const TEXTOS_AVISO = {
  'pedido.confirmado': 'Hola {{nombre}}, tu {{pedido}} *{{folio}}* fue confirmado. ¡Gracias!',
  'pedido.preparando': 'Hola {{nombre}}, ya estamos preparando tu {{pedido}} *{{folio}}*.',
  'pedido.enviado': 'Hola {{nombre}}, tu {{pedido}} *{{folio}}* va en camino.',
  'pedido.listo': 'Hola {{nombre}}, tu {{pedido}} *{{folio}}* está listo para recoger.',
  'pedido.entregado': 'Hola {{nombre}}, tu {{pedido}} *{{folio}}* fue entregado. ¡Gracias por tu compra!',
  'pedido.cancelado': 'Hola {{nombre}}, tu {{pedido}} *{{folio}}* fue cancelado. Si tienes dudas, escríbenos.',
  'pedido.pagado': '¡Recibimos tu pago de {{total}}! Tu {{pedido}} *{{folio}}* quedó pagado.',
  'cita.confirmada': 'Hola {{nombre}}, tu {{cita}} del *{{fecha}}* a las *{{hora}}* quedó confirmada.',
  'cita.cancelada': 'Hola {{nombre}}, tu {{cita}} del *{{fecha}}* a las *{{hora}}* fue cancelada. Si quieres otra fecha, escríbenos.',
  'recordatorio.dia':
    'Hola {{nombre}}, te recordamos tu {{cita}} {{servicio}} *mañana {{fecha}}* a las *{{hora}}*.\n\nResponde *1* para confirmar o *2* para cancelar.',
  'recordatorio.hora':
    'Hola {{nombre}}, tu {{cita}} {{servicio}} es *hoy a las {{hora}}* (en una hora).\n\nResponde *1* para confirmar o *2* para cancelar.',
  'encuesta.pedido': '¿Cómo calificarías tu {{pedido}} *{{folio}}*? Responde con un número del *1* (malo) al *5* (excelente).',
  'carrito.abandonado': 'Hola {{nombre}}, vimos que dejaste tu {{pedido}} a medias ({{total}}). ¿Lo terminamos? Te dejo donde te quedaste:',
};

/** Estados del pedido que se avisan al cliente (el "nuevo" ya lo contestó el bot al registrarlo). */
export const ESTADOS_PEDIDO_AVISADOS = ['confirmado', 'preparando', 'enviado', 'listo', 'entregado', 'cancelado'];
export const ESTADOS_CITA_AVISADOS = ['confirmada', 'cancelada'];

/** Pie obligatorio de las campañas: la persona siempre puede darse de baja. */
export const PIE_CAMPANA = '\n\n_Responde BAJA si ya no quieres recibir estos mensajes._';

export const PALABRAS_BAJA = ['baja', 'stop', 'cancelar suscripcion', 'no mas mensajes'];
export const PALABRAS_ALTA = ['alta', 'suscribir', 'suscribirme'];
export const PALABRAS_SI = ['1', 'si', 'confirmo', 'confirmar', 'ok', 'claro', 'va'];
export const PALABRAS_NO = ['2', 'no', 'cancelo', 'cancelar', 'no puedo'];

/** "Hola , tu pedido" → "Hola, tu pedido" cuando falta una variable (p. ej. no se sabe el nombre). */
export const limpiarTexto = (t) =>
  String(t)
    .replace(/[ \t]+([,.!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

export const textoAviso = (empresa, clave) => {
  const propio = empresa?.avisos?.textos?.[clave];
  return typeof propio === 'string' && propio.trim() ? propio : TEXTOS_AVISO[clave];
};
