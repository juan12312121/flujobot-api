/** Errores de la capa de aplicación (los de reglas de negocio viven en domain/shared/errors.js). */
export class ApplicationError extends Error {
  constructor(codigo, mensaje, detalles = []) {
    super(mensaje);
    this.name = new.target.name;
    this.codigo = codigo;
    this.detalles = detalles;
  }
}

export class NoEncontradoError extends ApplicationError {
  constructor(mensaje = 'No encontrado') {
    super('NO_ENCONTRADO', mensaje);
  }
}

export class NoAutenticadoError extends ApplicationError {
  constructor(mensaje = 'No autenticado') {
    super('NO_AUTENTICADO', mensaje);
  }
}

/** Choca con el estado actual de los datos (correo ya registrado...). */
export class ConflictoError extends ApplicationError {}

/** Falta configurar un servicio externo (n8n, Evolution) en las variables de entorno. */
export class NoConfiguradoError extends ApplicationError {
  constructor(mensaje) {
    super('NO_CONFIGURADO', mensaje);
  }
}

/** Un servicio externo (n8n, Evolution) falló o respondió con error. */
export class ServicioExternoError extends ApplicationError {
  constructor(mensaje) {
    super('SERVICIO_EXTERNO', mensaje);
  }
}
