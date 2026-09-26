import { nombreDia } from '../../domain/agenda/disponibilidad.js';

const EJEMPLOS = {
  numero: '25',
  email: 'ana@correo.com',
  telefono: '5512345678',
};

/** Ejemplo razonable para una Pregunta de texto según el nombre de su variable. */
function ejemploTexto(variable = '') {
  const v = variable.toLowerCase();
  if (/nombre|cliente|contacto/.test(v)) return 'Ana López';
  if (/direcci|domicilio|calle/.test(v)) return 'Av. Juárez 10, Centro';
  if (/comentario|nota|mensaje/.test(v)) return 'Me interesa, llámenme por la tarde';
  return 'Sí';
}

/**
 * Qué podría contestar el cliente ahora mismo, según el bloque donde quedó esperando.
 * El simulador las muestra como botones para que alguien sin experiencia no tenga que adivinar.
 *
 * @returns {{ texto: string, etiqueta: string }[]}
 */
export function sugerenciasPara(flujo, sesion) {
  const inicio = flujo.inicio();
  const arrancar = inicio?.datos?.palabrasClave?.[0] ?? 'hola';
  if (sesion.estado !== 'activa' || !sesion.nodoActual) return [{ texto: arrancar, etiqueta: `Escribir "${arrancar}"` }];

  const nodo = flujo.nodo(sesion.nodoActual);
  const d = nodo?.datos ?? {};
  const v = sesion.variables ?? {};
  switch (nodo?.tipo) {
    case 'menu':
      return (d.opciones ?? []).slice(0, 8).map((o, i) => ({ texto: String(i + 1), etiqueta: `${i + 1}. ${o.etiqueta}` }));
    case 'pregunta': {
      const ejemplo = d.validacion && d.validacion !== 'texto' ? EJEMPLOS[d.validacion] : ejemploTexto(d.variable);
      return [{ texto: ejemplo, etiqueta: ejemplo }];
    }
    case 'catalogo': {
      const nombres = v._catalogoNombres ?? [];
      const opciones = nombres.slice(0, 5).map((n, i) => ({ texto: String(i + 1), etiqueta: `${i + 1}. ${n}` }));
      return [...opciones, { texto: '0', etiqueta: d.modo === 'elegir' ? '0. Regresar' : '0. Terminar' }];
    }
    case 'cita': {
      const cita = v._cita;
      if (cita?.paso === 'hora') return (cita.horas ?? []).slice(0, 6).map((h, i) => ({ texto: String(i + 1), etiqueta: h }));
      return (cita?.dias ?? []).slice(0, 5).map((f, i) => ({ texto: String(i + 1), etiqueta: nombreDia(f) }));
    }
    case 'esperar':
      return [
        { texto: 'Sí, me interesa', etiqueta: 'Contestar a tiempo' },
        { texto: '/pasar', etiqueta: 'Simular que no contestó' },
      ];
    case 'encuesta':
      if (v._encuesta?.paso === 'comentario') return [{ texto: 'Muy buena atención', etiqueta: 'Dejar comentario' }, { texto: 'no', etiqueta: 'Sin comentario' }];
      return [5, 4, 2].map((n) => ({ texto: String(n), etiqueta: `Calificar con ${n}` }));
    case 'permiso':
      return [
        { texto: '1', etiqueta: '1. Sí, quiero' },
        { texto: '2', etiqueta: '2. No, gracias' },
      ];
    case 'ia':
      return [
        { texto: '¿Qué formas de pago aceptan?', etiqueta: '¿Qué formas de pago aceptan?' },
        { texto: '¿Tienen estacionamiento?', etiqueta: '¿Tienen estacionamiento?' },
      ];
    default:
      return [];
  }
}
