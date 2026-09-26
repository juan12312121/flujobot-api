import { conectarMongo, desconectarMongo } from '../infrastructure/database/mongo.js';
import * as Repos from '../infrastructure/persistence/repositories/index.js';
import { BcryptPasswordHasher, JwtTokenService, CryptoGenerador } from '../infrastructure/security/index.js';
import { Cifrador, firmaValida } from '../infrastructure/security/Cifrador.js';
import { FetchClienteWebhook } from '../infrastructure/http/FetchClienteWebhook.js';
import { N8nPublicador } from '../infrastructure/n8n/N8nPublicador.js';
import { construirTarea } from '../infrastructure/n8n/construirTarea.js';
import { EvolutionCliente } from '../infrastructure/whatsapp/EvolutionCliente.js';
import { normalizarEntrante } from '../infrastructure/whatsapp/normalizarEntrante.js';
import { TelegramCliente, normalizarTelegram } from '../infrastructure/telegram/TelegramCliente.js';
import { MetaCliente, normalizarMeta } from '../infrastructure/meta/MetaCliente.js';
import { MercadoPagoCliente, StripeCliente, eventoStripe, pagoIdMercadoPago } from '../infrastructure/pagos/pasarelas.js';
import { OpenRouterCliente } from '../infrastructure/ia/OpenRouterCliente.js';
import { GroqTranscriptor } from '../infrastructure/ia/GroqTranscriptor.js';
import { CloudinaryAlmacen } from '../infrastructure/storage/CloudinaryAlmacen.js';

import { MotorDeFlujo } from '../application/services/MotorDeFlujo.js';
import { AtenderMensaje } from '../application/services/AtenderMensaje.js';
import { RespondedorIA } from '../application/services/RespondedorIA.js';
import { Mensajero } from '../application/services/Mensajero.js';
import { Programador } from '../application/services/Programador.js';
import { Avisos } from '../application/services/Avisos.js';
import { Bitacora } from '../application/services/Bitacora.js';
import { Cobros } from '../application/services/Cobros.js';
import { Campanas } from '../application/services/Campanas.js';
import { Seguimientos } from '../application/services/Seguimientos.js';
import { Voz } from '../application/services/Voz.js';
import { RegistrarEmpresa } from '../application/use-cases/auth/RegistrarEmpresa.js';
import { IniciarSesion } from '../application/use-cases/auth/IniciarSesion.js';
import { ObtenerPerfil } from '../application/use-cases/auth/ObtenerPerfil.js';
import * as usuariosUC from '../application/use-cases/usuarios/index.js';
import * as productosUC from '../application/use-cases/productos/index.js';
import * as botsUC from '../application/use-cases/bots/index.js';
import * as conversacionesUC from '../application/use-cases/conversaciones/index.js';
import * as pedidosUC from '../application/use-cases/pedidos/index.js';
import * as empresaUC from '../application/use-cases/empresa/index.js';
import * as citasUC from '../application/use-cases/citas/index.js';
import * as webUC from '../application/use-cases/web/index.js';
import * as campanasUC from '../application/use-cases/campanas/index.js';
import * as gestionUC from '../application/use-cases/gestion/index.js';
import * as canalesUC from '../application/use-cases/canales/index.js';
import * as plataformaUC from '../application/use-cases/plataforma/index.js';
import { ProcesarMensajeEntrante } from '../application/use-cases/motor/ProcesarMensajeEntrante.js';
import { ObtenerResumen } from '../application/use-cases/tablero/ObtenerResumen.js';
import { FirmarSubidaImagen } from '../application/use-cases/archivos/FirmarSubidaImagen.js';
import { ObtenerResultados } from '../application/use-cases/bots/ObtenerResultados.js';
import { GenerarFlujoConIA } from '../application/use-cases/asistente/GenerarFlujoConIA.js';
import { GenerarTareaN8n, PublicarTareaN8n } from '../application/use-cases/asistente/tareas.js';

import * as C from '../presentation/http/controllers/index.js';
import * as R from '../presentation/http/routers/index.js';
import { autenticar, soloSuperadmin, limiteAuth, limiteGeneral, limiteMotor, limiteIA, limiteChatPublico, limiteEntradas } from '../presentation/http/middlewares.js';

/** Clase → instancia con la llave en camelCase: ListarBots → listarBots. */
const instanciar = (modulo, deps) =>
  Object.fromEntries(
    Object.entries(modulo)
      .filter(([, Clase]) => typeof Clase === 'function')
      .map(([nombre, Clase]) => [nombre[0].toLowerCase() + nombre.slice(1), new Clase(deps)]),
  );

/** Raíz de composición: el único lugar que conoce las clases concretas de todas las capas. */
export async function crearContenedor(config) {
  await conectarMongo(config.MONGO_URI);

  const repos = {
    empresas: new Repos.EmpresaRepository(),
    usuarios: new Repos.UsuarioRepository(),
    productos: new Repos.ProductoRepository(),
    bots: new Repos.BotRepository(),
    conversaciones: new Repos.ConversacionRepository(),
    pedidos: new Repos.PedidoRepository(),
    citas: new Repos.CitaRepository(),
    estadisticas: new Repos.EstadisticaRepository(),
    trabajos: new Repos.TrabajoRepository(),
    contactos: new Repos.ContactoRepository(),
    campanas: new Repos.CampanaRepository(),
    encuestas: new Repos.EncuestaRepository(),
    versiones: new Repos.VersionRepository(),
    actividad: new Repos.ActividadRepository(),
  };
  const tokens = new JwtTokenService(config.JWT_SECRET, config.JWT_EXPIRA);
  const mercadopago = new MercadoPagoCliente();
  const servicios = {
    hasher: new BcryptPasswordHasher(),
    tokens,
    generador: new CryptoGenerador(),
    cifrador: new Cifrador(config.CIFRADO_LLAVE ?? config.JWT_SECRET),
    evolution: new EvolutionCliente({ url: config.EVOLUTION_URL, apiKey: config.EVOLUTION_API_KEY }),
    telegram: new TelegramCliente(),
    meta: new MetaCliente(),
    mercadopago,
    stripe: new StripeCliente(),
    publicador: new N8nPublicador({
      n8nUrl: config.N8N_URL,
      apiKey: config.N8N_API_KEY,
      apiUrl: config.API_URL_PUBLICA,
      evolutionUrl: config.EVOLUTION_URL,
      credencialEvolutionId: config.N8N_EVOLUTION_CREDENCIAL_ID,
    }),
    normalizar: normalizarEntrante,
    normalizarTelegram,
    normalizarMeta,
    eventoStripe,
    pagoIdMercadoPago,
    verificarFirmaMeta: (crudo, firma) => firmaValida(config.META_APP_SECRET, crudo, String(firma ?? '').replace(/^sha256=/, '')),
    construirTarea,
    almacen: new CloudinaryAlmacen({ cloudName: config.CLOUDINARY_CLOUD_NAME, apiKey: config.CLOUDINARY_API_KEY, apiSecret: config.CLOUDINARY_API_SECRET }),
    ia: new OpenRouterCliente({ apiKey: config.OPENROUTER_API_KEY, modelos: config.OPENROUTER_MODELOS, maxTokens: config.OPENROUTER_MAX_TOKENS, urlSitio: config.URL_FRONTEND }),
    voz: new Voz({ transcriptor: new GroqTranscriptor({ apiKey: config.GROQ_API_KEY }) }),
    apiUrl: config.API_URL_PUBLICA,
    urlFrontend: config.URL_FRONTEND,
    superadmins: config.SUPERADMINS,
    cronSecreto: config.CRON_SECRETO,
    metaConfigurada: Boolean(config.META_APP_SECRET && config.META_VERIFY_TOKEN),
  };

  // Servicios de aplicación (el orden importa: unos usan a otros)
  const base = { ...repos, ...servicios };
  const bitacora = new Bitacora(base);
  const programador = new Programador(base);
  const mensajero = new Mensajero(base);
  const avisos = new Avisos({ ...base, mensajero, programador });
  const cobros = new Cobros({ ...base, avisos });
  const respondedor = new RespondedorIA({ ia: servicios.ia, productos: repos.productos });
  const motor = new MotorDeFlujo({ productos: repos.productos, pedidos: repos.pedidos, citas: repos.citas, clienteWebhook: new FetchClienteWebhook(), respondedor, cobros });
  const atender = new AtenderMensaje({ ...base, motor, programador, avisos });
  const campanasServicio = new Campanas({ ...base, mensajero });
  const seguimientos = new Seguimientos({ ...base, motor, atender, mensajero });

  programador
    .manejar('recordatorio_cita', (d) => avisos.enviarRecordatorio(d))
    .manejar('reanudar_espera', (d) => seguimientos.reanudarEspera(d))
    .barrido('campanas', () => campanasServicio.atender())
    .barrido('carritos', () => seguimientos.carritosAbandonados());

  const deps = { ...base, bitacora, programador, mensajero, avisos, cobros, atender, campanasServicio };

  const casos = {
    registrarEmpresa: new RegistrarEmpresa(deps),
    iniciarSesion: new IniciarSesion(deps),
    obtenerPerfil: new ObtenerPerfil(deps),
    procesarMensajeEntrante: new ProcesarMensajeEntrante(deps),
    obtenerResumen: new ObtenerResumen(deps),
    generarFlujoConIA: new GenerarFlujoConIA(deps),
    obtenerResultados: new ObtenerResultados(deps),
    firmarSubidaImagen: new FirmarSubidaImagen(deps),
    generarTareaN8n: new GenerarTareaN8n(deps),
    publicarTareaN8n: new PublicarTareaN8n(deps),
    ...instanciar(usuariosUC, deps),
    ...instanciar(productosUC, deps),
    ...instanciar(botsUC, deps),
    ...instanciar(conversacionesUC, deps),
    ...instanciar(pedidosUC, deps),
    ...instanciar(empresaUC, deps),
    ...instanciar(citasUC, deps),
    ...instanciar(webUC, deps),
    ...instanciar(campanasUC, deps),
    ...instanciar(gestionUC, deps),
    ...instanciar(canalesUC, deps),
    ...instanciar(plataformaUC, deps),
    verificarTokenMeta: (token) => Boolean(config.META_VERIFY_TOKEN) && servicios.generador.iguales(token, config.META_VERIFY_TOKEN),
  };

  const sesion = autenticar(tokens);
  const conSesion = { middlewares: [limiteGeneral, sesion] };
  const rutas = [
    ['/auth', new R.AuthRouter(new C.AuthController(casos), { autenticar: sesion, limiteAuth }).registrar()],
    ['/usuarios', new R.UsuarioRouter(new C.UsuarioController(casos), conSesion).registrar()],
    ['/productos', new R.ProductoRouter(new C.ProductoController(casos), conSesion).registrar()],
    ['/bots', new R.BotRouter(new C.BotController(casos), conSesion).registrar()],
    ['/conversaciones', new R.ConversacionRouter(new C.ConversacionController(casos), conSesion).registrar()],
    ['/pedidos', new R.PedidoRouter(new C.PedidoController(casos), conSesion).registrar()],
    ['/giros', new R.GiroRouter(new C.EmpresaController(casos)).registrar()],
    ['/empresa', new R.EmpresaRouter(new C.EmpresaController(casos), conSesion).registrar()],
    ['/citas', new R.CitaRouter(new C.CitaController(casos), conSesion).registrar()],
    ['/campanas', new R.CampanaRouter(new C.CampanaController(casos), conSesion).registrar()],
    ['/gestion', new R.GestionRouter(new C.GestionController(casos), conSesion).registrar()],
    ['/admin', new R.AdminRouter(new C.AdminController(casos), { middlewares: [limiteGeneral, sesion, soloSuperadmin(config.SUPERADMINS)] }).registrar()],
    ['/asistente', new R.AsistenteRouter(new C.AsistenteController(casos), { middlewares: [limiteIA, sesion] }).registrar()],
    ['/archivos', new R.ArchivoRouter(new C.ArchivoController(casos), conSesion).registrar()],
    ['/tablero', new R.TableroRouter(new C.TableroController(casos), conSesion).registrar()],
    ['/motor', new R.MotorRouter(new C.MotorController(casos), { middlewares: [limiteMotor] }).registrar()],
    ['/interno', new R.InternoRouter(new C.EntradaController(casos)).registrar()],
  ];

  const rutasPublicas = [
    ['/publico/chat', new R.ChatPublicoRouter(new C.ChatWebController(casos), { middlewares: [limiteChatPublico] }).registrar()],
    ['/publico', new R.EntradaRouter(new C.EntradaController(casos), { middlewares: [limiteEntradas] }).registrar()],
  ];

  return {
    rutas,
    rutasPublicas,
    config,
    programador,
    integraciones: {
      n8n: servicios.publicador.configurado,
      evolution: servicios.evolution.configurado,
      ia: servicios.ia.configurado,
      voz: servicios.voz.disponible,
      meta: servicios.metaConfigurada,
    },
    cerrar: desconectarMongo,
  };
}
