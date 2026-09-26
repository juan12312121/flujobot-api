/**
 * Catálogo de bloques que se pueden arrastrar al lienzo.
 *
 * - `salidas`: puertos de salida fijos. Los nodos `menu` además tienen un puerto por opción (`opcion:<id>`).
 * - `espera`: el bot se detiene en este nodo hasta que el contacto responda.
 *
 * El frontend tiene su propia copia visual (colores, iconos); este archivo manda en las reglas.
 */
export const TIPOS_DE_NODO = Object.freeze({
  inicio: { nombre: 'Inicio', salidas: ['siguiente'], espera: false },
  mensaje: { nombre: 'Mensaje', salidas: ['siguiente'], espera: false },
  menu: { nombre: 'Menú de opciones', salidas: [], espera: true },
  pregunta: { nombre: 'Pregunta', salidas: ['siguiente'], espera: true },
  catalogo: { nombre: 'Catálogo (productos o servicios)', salidas: ['agregado', 'listo'], espera: true },
  carrito: { nombre: 'Resumen del carrito', salidas: ['siguiente', 'vacio'], espera: false },
  pedido: { nombre: 'Registrar pedido o solicitud', salidas: ['siguiente'], espera: false },
  cita: { nombre: 'Agendar cita', salidas: ['agendada', 'sin_espacio'], espera: true },
  ia: { nombre: 'Responder con IA', salidas: ['respondio', 'no_sabe'], espera: true },
  condicion: { nombre: 'Condición', salidas: ['si', 'no'], espera: false },
  webhook: { nombre: 'Tarea en n8n', salidas: ['ok', 'error'], espera: false },
  estado: { nombre: 'Consultar pedido o cita', salidas: ['encontrado', 'nada'], espera: false },
  esperar: { nombre: 'Esperar respuesta', salidas: ['respondio', 'sin_respuesta'], espera: true },
  encuesta: { nombre: 'Encuesta de satisfacción', salidas: ['buena', 'mala'], espera: true },
  permiso: { nombre: 'Pedir permiso para promociones', salidas: ['acepto', 'no_acepto'], espera: true },
  registro: { nombre: 'Guardar en módulo', salidas: ['siguiente'], espera: false },
  consulta: { nombre: 'Consultar módulo', salidas: ['encontrado', 'nada'], espera: false },
  humano: { nombre: 'Pasar a un asesor', salidas: [], espera: false },
  fin: { nombre: 'Fin', salidas: [], espera: false },
});

export const VALIDACIONES_PREGUNTA = ['texto', 'numero', 'email', 'telefono'];
export const OPERADORES = ['igual', 'distinto', 'contiene', 'mayor', 'menor', 'existe'];

/** Puertos de salida de un nodo concreto (los del menú dependen de sus opciones). */
export function puertosDe(nodo) {
  if (nodo.tipo === 'menu') return (nodo.datos?.opciones ?? []).map((o) => `opcion:${o.id}`);
  return TIPOS_DE_NODO[nodo.tipo]?.salidas ?? [];
}
