import { normalizar } from './texto.js';

const leer = (variable, variables) =>
  String(variable ?? '')
    .split('.')
    .reduce((obj, k) => (obj == null ? undefined : obj[k]), variables);

const OPERADORES_TEXTO = {
  igual: 'es igual a',
  distinto: 'es distinto de',
  contiene: 'contiene',
  mayor: 'es mayor que',
  menor: 'es menor que',
  existe: 'tiene algún valor',
};

/** 'edad (30) es mayor que "17"' — para explicarle la condición a alguien sin experiencia. */
export function describirCondicion({ variable, operador, valor }, variables) {
  const actual = leer(variable, variables);
  const visto = actual == null || actual === '' ? 'vacío' : typeof actual === 'object' ? 'con datos' : `"${actual}"`;
  const comparacion = operador === 'existe' ? OPERADORES_TEXTO.existe : `${OPERADORES_TEXTO[operador] ?? operador} "${valor ?? ''}"`;
  return `"${variable}" (${visto}) ${comparacion}`;
}

/** "$1,350.50" → 1350.5; así {{total}} (que se guarda con formato de dinero) se puede comparar. */
function numero(v) {
  if (typeof v === 'number') return v;
  const limpio = String(v ?? '').replace(/[^0-9.-]/g, '');
  return limpio === '' || limpio === '-' ? NaN : Number(limpio);
}
const comparable = (a, b) => Number.isFinite(a) && Number.isFinite(b);

/** Evalúa el bloque Condición contra las variables de la conversación. */
export function cumpleCondicion({ variable, operador, valor }, variables) {
  const actual = leer(variable, variables);

  if (operador === 'existe') return actual != null && String(actual).trim() !== '';
  if (actual == null) return false;

  const a = normalizar(actual);
  const b = normalizar(valor);
  switch (operador) {
    case 'igual':
      return a === b;
    case 'distinto':
      return a !== b;
    case 'contiene':
      return a.includes(b);
    case 'mayor':
      return comparable(numero(actual), numero(valor)) && numero(actual) > numero(valor);
    case 'menor':
      return comparable(numero(actual), numero(valor)) && numero(actual) < numero(valor);
    default:
      return false;
  }
}
