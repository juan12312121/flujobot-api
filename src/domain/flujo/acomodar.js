import { puertosDe } from './tiposDeNodo.js';

const ANCHO_COLUMNA = 340;
const SEPARACION = 40;
const X0 = 40;
const Y0 = 40;

/** Alto aproximado del bloque en el lienzo (mismo cálculo que el editor: encabezado + resumen + salidas). */
const altoDe = (nodo) => Math.max(32 + 40 + puertosDe(nodo).length * 26 + 6, 76);

/**
 * Acomoda los bloques en columnas de izquierda a derecha según la distancia desde el Inicio
 * (recorrido a lo ancho). Lo usa el asistente de IA, que genera bloques sin posición.
 * Los bloques que no se alcanzan desde el Inicio quedan en una última columna.
 */
export function acomodar({ nodos, conexiones }) {
  const inicio = nodos.find((n) => n.tipo === 'inicio');
  const nivel = new Map();
  if (inicio) {
    nivel.set(inicio.id, 0);
    const cola = [inicio.id];
    while (cola.length) {
      const id = cola.shift();
      for (const c of conexiones.filter((x) => x.origen === id)) {
        if (!nivel.has(c.destino)) {
          nivel.set(c.destino, nivel.get(id) + 1);
          cola.push(c.destino);
        }
      }
    }
  }
  const ultimo = Math.max(0, ...nivel.values()) + 1;
  const columnas = new Map();
  for (const n of nodos) {
    const col = nivel.get(n.id) ?? ultimo;
    columnas.set(col, [...(columnas.get(col) ?? []), n]);
  }

  const posiciones = new Map();
  for (const [col, lista] of columnas) {
    let y = Y0;
    for (const n of lista) {
      posiciones.set(n.id, { x: X0 + col * ANCHO_COLUMNA, y });
      y += altoDe(n) + SEPARACION;
    }
  }
  return { nodos: nodos.map((n) => ({ ...n, posicion: posiciones.get(n.id) })), conexiones };
}
