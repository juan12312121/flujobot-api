/**
 * Errores del dominio. No saben nada de HTTP: la capa de presentación decide
 * qué código de estado le corresponde a cada uno.
 */
export class DomainError extends Error {
  constructor(codigo, mensaje, detalles = []) {
    super(mensaje);
    this.name = new.target.name;
    this.codigo = codigo;
    this.detalles = detalles;
  }
}

/** Se violó una regla de negocio (flujo sin inicio, precio negativo...). */
export class ReglaDeNegocioError extends DomainError {}

/** La persona no tiene permiso para esta acción (un editor queriendo borrar usuarios...). */
export class PermisoDenegadoError extends DomainError {
  constructor(mensaje = 'No tienes permiso para esto', detalles = []) {
    super('PERMISO_DENEGADO', mensaje, detalles);
  }
}

/** La acción no aplica en el estado actual (publicar un flujo con errores...). */
export class EstadoInvalidoError extends DomainError {}
