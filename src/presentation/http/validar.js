import { DatosInvalidosError } from './errores.js';
import { NoEncontradoError } from '../../application/shared/errors.js';

/** Valida con zod; devuelve los datos limpios o lanza 400 con el detalle por campo. */
export function validarCon(esquema, datos) {
  const r = esquema.safeParse(datos ?? {});
  if (!r.success) throw new DatosInvalidosError(r.error.issues.map((i) => ({ campo: i.path.join('.'), mensaje: i.message })));
  return r.data;
}

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** Parámetros de ruta: todo ":algoId" debe ser un ObjectId de Mongo; si no, eso no existe (404). */
export function validarParams(params) {
  for (const [nombre, valor] of Object.entries(params)) {
    if (nombre.endsWith('Id') && !OBJECT_ID.test(valor)) throw new NoEncontradoError('No encontrado');
  }
  return params;
}
