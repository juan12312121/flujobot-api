import { BaseRouter } from '../BaseRouter.js';

export class AuthRouter extends BaseRouter {
  constructor(controller, { autenticar, limiteAuth }) {
    super(controller);
    this.autenticar = autenticar;
    this.limiteAuth = limiteAuth;
  }

  rutas() {
    this.post('/registro', this.limiteAuth, 'registrar');
    this.post('/login', this.limiteAuth, 'login');
    this.get('/perfil', this.autenticar, 'perfil');
  }
}

export class UsuarioRouter extends BaseRouter {
  rutas() {
    this.crud(':usuarioId', ['listar', 'crear', 'borrar']);
  }
}

export class ProductoRouter extends BaseRouter {
  rutas() {
    this.get('/categorias', 'categorias');
    this.crud(':productoId');
  }
}

export class BotRouter extends BaseRouter {
  rutas() {
    this.put('/:botId/flujo', 'guardarFlujo');
    this.put('/:botId/web', 'configurarWeb');
    this.get('/:botId/resultados', 'resultados');
    this.post('/:botId/publicar', 'publicar');
    this.get('/:botId/workflow-n8n', 'exportar');
    this.post('/:botId/whatsapp/conectar', 'conectar');
    this.get('/:botId/whatsapp', 'estadoWhatsApp');
    this.post('/:botId/whatsapp/desconectar', 'desconectar');
    this.post('/:botId/simulador', 'simular');
    this.delete('/:botId/simulador', 'reiniciarSimulador');
    this.crud(':botId');
  }
}

export class ConversacionRouter extends BaseRouter {
  rutas() {
    this.post('/:conversacionId/devolver-al-bot', 'devolver');
    this.crud(':conversacionId', ['listar', 'obtener']);
  }
}

export class PedidoRouter extends BaseRouter {
  rutas() {
    this.patch('/:pedidoId/estado', 'cambiarEstado');
    this.crud(':pedidoId', ['listar']);
  }
}

export class TableroRouter extends BaseRouter {
  rutas() {
    this.get('/resumen', 'resumen');
  }
}

export class MotorRouter extends BaseRouter {
  rutas() {
    this.post('/bots/:botId/mensajes', 'mensaje');
  }
}

/** /giros es público (lo necesita el registro); /empresa es la empresa de quien tiene la sesión. */
export class GiroRouter extends BaseRouter {
  rutas() {
    this.get('/', 'giros');
  }
}

export class EmpresaRouter extends BaseRouter {
  rutas() {
    this.get('/', 'obtener');
    this.patch('/', 'editar');
  }
}

export class CitaRouter extends BaseRouter {
  rutas() {
    this.crud(':citaId', ['listar', 'crear', 'editar']);
  }
}

export class AsistenteRouter extends BaseRouter {
  rutas() {
    this.post('/flujos', 'generar');
    this.post('/tareas', 'tarea');
    this.post('/tareas/publicar', 'publicarTarea');
  }
}

/** Chat web público (sin sesión): lo llama el globito desde la página de cada negocio. */
export class ChatPublicoRouter extends BaseRouter {
  rutas() {
    this.get('/:clave', 'publico');
    this.post('/:clave/mensajes', 'mensaje');
  }
}
