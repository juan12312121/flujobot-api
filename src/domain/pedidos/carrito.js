import { dinero } from '../flujo/texto.js';

/** Carrito de una conversación: [{ productoId, nombre, precio, cantidad }]. Funciones puras. */

export function agregarAlCarrito(carrito, producto, cantidad = 1) {
  const existente = carrito.find((i) => i.productoId === producto.id);
  if (existente) return carrito.map((i) => (i === existente ? { ...i, cantidad: i.cantidad + cantidad } : i));
  return [...carrito, { productoId: producto.id, nombre: producto.nombre, precio: producto.precio, cantidad }];
}

export function totalCarrito(carrito) {
  return Math.round(carrito.reduce((s, i) => s + i.precio * i.cantidad, 0) * 100) / 100;
}

export function resumenCarrito(carrito, moneda = 'MXN') {
  const lineas = carrito.map((i) => `• ${i.cantidad} x ${i.nombre} — ${dinero(i.precio * i.cantidad, moneda)}`);
  return `${lineas.join('\n')}\n*Total: ${dinero(totalCarrito(carrito), moneda)}*`;
}
