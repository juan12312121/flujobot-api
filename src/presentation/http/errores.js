import { ApiResponse } from './ApiResponse.js';
import { ReglaDeNegocioError, PermisoDenegadoError, EstadoInvalidoError } from '../../domain/shared/errors.js';
import {
  NoEncontradoError,
  NoAutenticadoError,
  ConflictoError,
  NoConfiguradoError,
  ServicioExternoError,
} from '../../application/shared/errors.js';

/** El cuerpo, la query o los parámetros no tienen la forma esperada. */
export class DatosInvalidosError extends Error {
  constructor(detalles) {
    super('Datos inválidos');
    this.codigo = 'DATOS_INVALIDOS';
    this.detalles = detalles;
  }
}

/** Traducción de errores de dominio/aplicación a HTTP. El orden importa (el primero que coincide gana). */
const ESTADOS = [
  [DatosInvalidosError, 400],
  [NoAutenticadoError, 401],
  [PermisoDenegadoError, 403],
  [NoEncontradoError, 404],
  [ConflictoError, 409],
  [EstadoInvalidoError, 409],
  [ReglaDeNegocioError, 422],
  [ServicioExternoError, 502],
  [NoConfiguradoError, 503],
];

export const rutaNoEncontrada = (req, res) => ApiResponse.error(res, 404, 'RUTA_NO_ENCONTRADA', `No existe ${req.method} ${req.path}`);

// eslint-disable-next-line no-unused-vars
export const manejarErrores = (err, _req, res, _next) => {
  const conocido = ESTADOS.find(([Clase]) => err instanceof Clase);
  if (conocido) return ApiResponse.error(res, conocido[1], err.codigo, err.message, err.detalles);
  if (err?.type === 'entity.parse.failed') return ApiResponse.error(res, 400, 'JSON_INVALIDO', 'El cuerpo no es JSON válido');
  if (err?.type === 'entity.too.large') return ApiResponse.error(res, 413, 'MUY_GRANDE', 'El cuerpo es demasiado grande');
  // Errores de Mongo/Mongoose que se escapan de las validaciones
  if (err?.code === 11000) return ApiResponse.error(res, 409, 'DUPLICADO', 'Ya existe un registro igual');
  if (err?.name === 'ValidationError') return ApiResponse.error(res, 422, 'RESTRICCION', err.message);
  if (err?.name === 'CastError') return ApiResponse.error(res, 400, 'FORMATO_INVALIDO', 'Formato de dato inválido');
  console.error(err);
  return ApiResponse.error(res, 500, 'ERROR_INTERNO', 'Error interno');
};
