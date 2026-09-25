import { UseCase } from '../../shared/UseCase.js';
import { existe } from '../../services/permisos.js';

/** Catálogo de la empresa: lo que el bloque "Catálogo" muestra por WhatsApp. */

export class ListarProductos extends UseCase {
  constructor({ productos }) {
    super();
    this.productos = productos;
  }

  ejecutar({ actor, texto, categoria, activos }) {
    return this.productos.buscar(actor.empresaId, { texto, categoria, soloActivos: activos });
  }
}

export class ListarCategorias extends UseCase {
  constructor({ productos }) {
    super();
    this.productos = productos;
  }

  ejecutar({ actor }) {
    return this.productos.categorias(actor.empresaId);
  }
}

export class CrearProducto extends UseCase {
  constructor({ productos }) {
    super();
    this.productos = productos;
  }

  ejecutar({ actor, ...datos }) {
    return this.productos.crear(actor.empresaId, datos);
  }
}

export class EditarProducto extends UseCase {
  constructor({ productos }) {
    super();
    this.productos = productos;
  }

  async ejecutar({ actor, productoId, ...cambios }) {
    return existe(await this.productos.actualizar(actor.empresaId, productoId, cambios), 'Producto no encontrado');
  }
}

export class BorrarProducto extends UseCase {
  constructor({ productos }) {
    super();
    this.productos = productos;
  }

  async ejecutar({ actor, productoId }) {
    existe(await this.productos.borrar(actor.empresaId, productoId), 'Producto no encontrado');
  }
}
