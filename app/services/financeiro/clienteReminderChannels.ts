import { sendClienteWhatsappMessage } from "../clientes/clienteWhatsappService";
import type { CanalLembreteInadimplencia } from "./inadimplenciaLembretePolicy";

/**
 * Dispatcher de canais dos lembretes de inadimplência. Hoje só o WhatsApp entrega de
 * fato; EMAIL e SMS existem como "casca" (assinatura pronta) para implementação futura.
 * Quem chama já filtra por canais implementados (isChannelImplemented), então os stubs
 * abaixo não são acionados no fluxo automático — ficam prontos para quando o canal existir.
 */

export class CanalNaoImplementadoError extends Error {
  constructor(public canal: CanalLembreteInadimplencia) {
    super(`Canal de lembrete "${canal}" ainda não está implementado.`);
    this.name = "CanalNaoImplementadoError";
  }
}

export type DispatchReminderArgs = {
  contaId: number;
  clienteId: number;
  mensagem: string;
};

async function sendViaWhatsapp(args: DispatchReminderArgs): Promise<void> {
  await sendClienteWhatsappMessage(args.contaId, args.clienteId, {
    tipo: "MENSAGEM",
    mensagem: args.mensagem,
  });
}

// --- Casca: implementar quando houver infraestrutura de envio ao cliente ---
async function sendViaEmail(_args: DispatchReminderArgs): Promise<void> {
  throw new CanalNaoImplementadoError("EMAIL");
}

async function sendViaSms(_args: DispatchReminderArgs): Promise<void> {
  throw new CanalNaoImplementadoError("SMS");
}

export async function dispatchClienteReminder(
  canal: CanalLembreteInadimplencia,
  args: DispatchReminderArgs,
): Promise<void> {
  switch (canal) {
    case "WHATSAPP":
      return sendViaWhatsapp(args);
    case "EMAIL":
      return sendViaEmail(args);
    case "SMS":
      return sendViaSms(args);
    default:
      throw new CanalNaoImplementadoError(canal);
  }
}
