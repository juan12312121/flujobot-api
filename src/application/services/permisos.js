import { PermisoDenegadoError } from '../../domain/shared/errors.js';
import { NoEncontradoError } from '../shared/errors.js';

/** Solo el admin de la empresa administra usuarios y borra bots. */
export function exigirAdmin(actor) {
  if (actor?.rol !== 'admin') throw new PermisoDenegadoError('Solo un administrador de la empresa puede hacer esto');
}

/** Lanza 404 si el repositorio no encontró nada (o era de otra empresa, que para el caso es lo mismo). */
export function existe(valor, mensaje = 'No encontrado') {
  if (!valor) throw new NoEncontradoError(mensaje);
  return valor;
}
