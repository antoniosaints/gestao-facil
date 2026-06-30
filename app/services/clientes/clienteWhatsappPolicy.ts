import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { formatCurrency } from "../../utils/formatters";

export type ClienteWhatsappMessageInput =
  | {
      tipo: "COBRANCA";
      clienteNome: string;
      cobrancaUid?: string | null;
      valor: number | string;
      vencimento?: Date | string | null;
      linkPagamento?: string | null;
    }
  | {
      tipo: "MENSAGEM";
      clienteNome: string;
      mensagem: string;
    }
  | {
      tipo: "ORCAMENTO_VENDA";
      clienteNome: string;
      vendaUid?: string | null;
      valor: number | string;
    }
  | {
      tipo: "COMPROVANTE_VENDA";
      clienteNome: string;
      vendaUid?: string | null;
      valor: number | string;
      formaPagamento?: string | null;
    };

export function normalizeClienteWhatsappPhone(value?: string | null) {
  const clean = String(value || "")
    .replace(/@.*/, "")
    .replace(/\D/g, "");

  if (clean.length < 10) {
    return "";
  }

  return clean.startsWith("55") ? clean : `55${clean}`;
}

function formatDate(value?: Date | string | null) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return format(date, "dd/MM/yyyy", { locale: ptBR });
}

function getClienteName(value: string) {
  return value?.trim() || "cliente";
}

function getVendaUid(value?: string | null) {
  return value?.trim() || "selecionada";
}

export function buildClienteWhatsappMessage(input: ClienteWhatsappMessageInput) {
  const greeting = `Olá, ${getClienteName(input.clienteNome)}!`;

  if (input.tipo === "MENSAGEM") {
    return `${input.mensagem.trim()}`;
  }

  if (input.tipo === "COBRANCA") {
    const vencimento = formatDate(input.vencimento);
    const dueText = vencimento ? ` com vencimento em ${vencimento}` : "";
    const linkText = input.linkPagamento ? `\n\nLink para pagamento: ${input.linkPagamento}` : "";
    return `${greeting}\nLembrete de cobranca ${input.cobrancaUid || "pendente"} no valor de *${formatCurrency(input.valor)}${dueText}.${linkText}*`;
  }

  if (input.tipo === "ORCAMENTO_VENDA") {
    return `${greeting}\nSegue o orcamento da venda *${getVendaUid(input.vendaUid)}* no valor de *${formatCurrency(input.valor)}*.`;
  }

  const paymentText = input.formaPagamento ? `\nForma de pagamento: ${input.formaPagamento}.` : "";
  return `${greeting}\nSegue o comprovante da venda *${getVendaUid(input.vendaUid)}* no valor de *${formatCurrency(input.valor)}.${paymentText}*`;
}
