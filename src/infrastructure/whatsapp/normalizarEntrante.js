/**
 * Convierte lo que manda Evolution API (evento messages.upsert) a { contacto, nombre, texto }.
 * También acepta la forma simple { contacto, nombre, texto } para probar con curl o desde otro n8n.
 * Devuelve { ignorar: 'motivo' } para lo que el bot no debe contestar (grupos, mensajes propios, estados).
 */
export function normalizarEntrante(cuerpo) {
  if (!cuerpo || typeof cuerpo !== 'object') return { ignorar: 'cuerpo vacío' };
  if (typeof cuerpo.texto === 'string' && cuerpo.contacto) {
    return { contacto: soloDigitos(cuerpo.contacto), nombre: cuerpo.nombre ?? '', texto: cuerpo.texto };
  }

  const evento = String(cuerpo.event ?? '').toLowerCase().replace(/_/g, '.');
  if (evento && evento !== 'messages.upsert') return { ignorar: `evento ${cuerpo.event}` };
  const data = Array.isArray(cuerpo.data) ? cuerpo.data[0] : cuerpo.data;
  const key = data?.key;
  if (!key) return { ignorar: 'sin key' };
  if (key.fromMe) return { ignorar: 'mensaje propio' };

  // Con @lid el número real viene en remoteJidAlt (Evolution 2.3+)
  const jid = [key.remoteJid, key.remoteJidAlt].find((j) => typeof j === 'string' && j.endsWith('@s.whatsapp.net'));
  if (!jid) return { ignorar: key.remoteJid?.endsWith('@g.us') ? 'grupo' : 'sin número' };

  const texto = textoDelMensaje(data.message ?? {});
  if (texto == null) return { ignorar: `tipo ${data.messageType ?? 'desconocido'}` };
  return { contacto: soloDigitos(jid.split('@')[0]), nombre: data.pushName ?? '', texto };
}

function textoDelMensaje(m) {
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.buttonsResponseMessage?.selectedDisplayText ??
    m.listResponseMessage?.title ??
    m.templateButtonReplyMessage?.selectedDisplayText ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    null
  );
}

const soloDigitos = (t) => String(t).replace(/\D/g, '');
