import { randomUUID } from "node:crypto";
import { prisma } from "../../utils/prisma";
import { contaHasActiveModule } from "../contas/storeModulesService";
import { WApiClient } from "../whatsapp/wApiClient";
import {
  buildClienteWhatsappMessage,
  resolveClienteWhatsappPhone,
} from "./clienteWhatsappPolicy";

export type ClienteWhatsappSendInput =
  | {
      tipo: "COBRANCA";
      cobrancaId: number;
    }
  | {
      tipo: "MENSAGEM";
      mensagem: string;
    }
  | {
      tipo: "LANCAMENTO";
      lancamentoId: number;
    }
  | {
      tipo: "ORCAMENTO_VENDA";
      vendaId: number;
    }
  | {
      tipo: "COMPROVANTE_VENDA";
      vendaId: number;
      telefone?: string;
    };

function hasChargeClienteVinculo(
  cobranca: Awaited<ReturnType<typeof getCobrancaForMessage>>,
  clienteId: number,
) {
  if (!cobranca) return false;

  return (
    cobranca.Venda?.clienteId === clienteId ||
    cobranca.LancamentoParcela?.lancamento?.clienteId === clienteId ||
    cobranca.Ordemservico?.clienteId === clienteId
  );
}

async function getCobrancaForMessage(contaId: number, cobrancaId: number) {
  return prisma.cobrancasFinanceiras.findFirst({
    where: {
      id: cobrancaId,
      contaId,
    },
    include: {
      Venda: {
        select: {
          id: true,
          clienteId: true,
          Uid: true,
        },
      },
      LancamentoParcela: {
        include: {
          lancamento: {
            select: {
              id: true,
              clienteId: true,
              descricao: true,
            },
          },
        },
      },
      Ordemservico: {
        select: {
          id: true,
          clienteId: true,
          Uid: true,
        },
      },
    },
  });
}

async function getVendaForMessage(
  contaId: number,
  clienteId: number,
  vendaId: number,
  allowUnlinkedSale = false,
) {
  return prisma.vendas.findFirst({
    where: {
      id: vendaId,
      contaId,
      OR: allowUnlinkedSale
        ? [{ clienteId }, { clienteId: null }]
        : [{ clienteId }],
    },
    include: {
      PagamentoVendas: true,
    },
  });
}

async function resolveConfiguredInstance(contaId: number) {
  const moduleActive = await contaHasActiveModule(contaId, "whatsapp");
  if (!moduleActive) {
    throw new Error("O modulo WhatsApp precisa estar ativo para enviar mensagens.");
  }

  const parametros = await prisma.parametrosConta.findUnique({
    where: { contaId },
    select: {
      whatsappNotificacoesInstanciaId: true,
    },
  });

  if (!parametros?.whatsappNotificacoesInstanciaId) {
    throw new Error("Configure a instancia principal de WhatsApp nas notificacoes.");
  }

  const instance = await prisma.whatsAppInstancia.findFirst({
    where: {
      id: parametros.whatsappNotificacoesInstanciaId,
      contaId,
      ativo: true,
    },
  });

  if (!instance) {
    throw new Error("Instancia principal de WhatsApp nao encontrada.");
  }

  if (instance.status !== "CONECTADA") {
    throw new Error("A instancia principal de WhatsApp precisa estar conectada.");
  }

  return instance;
}

function getVendaTotal(venda: { valor: any; desconto?: any | null }) {
  return Math.max(0, Number(venda.valor || 0) - Number(venda.desconto || 0));
}

export async function sendClienteWhatsappMessage(
  contaId: number,
  clienteId: number,
  input: ClienteWhatsappSendInput,
) {
  const cliente = await prisma.clientesFornecedores.findFirst({
    where: {
      id: clienteId,
      contaId,
    },
  });

  if (!cliente) {
    throw new Error("Cliente nao encontrado.");
  }

  const telefoneInformado = input.tipo === "COMPROVANTE_VENDA"
    ? input.telefone
    : undefined;
  const phone = resolveClienteWhatsappPhone(
    telefoneInformado,
    cliente.whastapp,
    cliente.telefone,
  );
  if (!phone) {
    throw new Error("Informe um telefone ou WhatsApp valido para o envio.");
  }

  let message = "";

  if (input.tipo === "MENSAGEM") {
    if (!input.mensagem.trim()) {
      throw new Error("Informe a mensagem para envio.");
    }

    message = buildClienteWhatsappMessage({
      tipo: "MENSAGEM",
      clienteNome: cliente.nome,
      mensagem: input.mensagem,
    });
  }

  if (input.tipo === "COBRANCA") {
    const cobranca = await getCobrancaForMessage(contaId, input.cobrancaId);
    if (!cobranca || !hasChargeClienteVinculo(cobranca, clienteId)) {
      throw new Error("Cobranca nao encontrada para este cliente.");
    }

    message = buildClienteWhatsappMessage({
      tipo: "COBRANCA",
      clienteNome: cliente.nome,
      cobrancaUid: cobranca.Uid || cobranca.idCobranca,
      valor: Number(cobranca.valor || 0),
      vencimento: cobranca.dataVencimento,
      linkPagamento: cobranca.externalLink,
    });
  }

  if (input.tipo === "LANCAMENTO") {
    const lancamento = await prisma.lancamentoFinanceiro.findFirst({
      where: {
        id: input.lancamentoId,
        contaId,
        clienteId,
        tipo: "RECEITA",
      },
      include: {
        parcelas: {
          where: {
            pago: false,
          },
          orderBy: {
            numero: "asc",
          },
        },
      },
    });

    if (!lancamento) {
      throw new Error("Lançamento de receita não encontrado para este cliente.");
    }

    if (lancamento.status === "PAGO" || !lancamento.parcelas.length) {
      throw new Error("Este lançamento não possui parcelas pendentes.");
    }

    const valorPendente = lancamento.parcelas.reduce(
      (acc, parcela) => acc + Number(parcela.valor || 0),
      0,
    );

    message = buildClienteWhatsappMessage({
      tipo: "LANCAMENTO",
      clienteNome: cliente.nome,
      lancamentoUid: lancamento.Uid,
      descricao: lancamento.descricao,
      valorPendente,
      parcelasPendentes: lancamento.parcelas.map((parcela) => ({
        numero: parcela.numero,
        vencimento: parcela.vencimento,
        valor: Number(parcela.valor || 0),
      })),
    });
  }

  if (input.tipo === "ORCAMENTO_VENDA" || input.tipo === "COMPROVANTE_VENDA") {
    const venda = await getVendaForMessage(
      contaId,
      clienteId,
      input.vendaId,
      input.tipo === "COMPROVANTE_VENDA",
    );
    if (!venda) {
      throw new Error("Venda nao encontrada para este cliente.");
    }

    if (input.tipo === "ORCAMENTO_VENDA") {
      message = buildClienteWhatsappMessage({
        tipo: "ORCAMENTO_VENDA",
        clienteNome: cliente.nome,
        vendaUid: venda.Uid,
        valor: getVendaTotal(venda),
      });
    } else {
      message = buildClienteWhatsappMessage({
        tipo: "COMPROVANTE_VENDA",
        clienteNome: cliente.nome,
        vendaUid: venda.Uid,
        valor: getVendaTotal(venda),
        formaPagamento: venda.PagamentoVendas?.metodo || null,
      });
    }
  }

  const instance = await resolveConfiguredInstance(contaId);
  const result = await new WApiClient(instance.instanceId, instance.token).send("text", {
    phone,
    message,
    messageId: `cliente-${clienteId}-${randomUUID()}`,
  });

  return {
    phone,
    message,
    result,
  };
}
