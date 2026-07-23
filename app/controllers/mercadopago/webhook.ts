import { Request, Response } from "express";
import { getSaasMercadoPagoService, mercadoPagoPayment } from "../../utils/mercadoPago";
import { prisma } from "../../utils/prisma";
import {
  MetodoPagamento,
  StatusFatura,
  StatusPagamento,
} from "../../../generated";
import { addDays, addHours, isBefore } from "date-fns";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import { MercadoPagoService } from "../../services/financeiro/mercadoPagoService";
import { tryGetTenantMercadoPagoService } from "../../services/financeiro/tenantMercadoPagoService";
import { atualizarStatusLancamentos } from "../financeiro/hooks";
import { processarPosPagamentoRecorrencia } from "../../services/financeiro/lancamentoRecorrenciaService";
import { sendUpdateTable } from "../../hooks/vendas/socket";
import { redisConnecion } from "../../utils/redis";
import { clearCacheAccount } from "../administracao/contas";
import { recalculateComandaStatus } from "../vendas/comandas";
import {
  activateStoreModuleFromCharge,
  consumirCreditoIndicacaoNoPagamento,
  reconcileStoreModulesAfterPayment,
  releaseStoreModuleCharge,
} from "../../services/contas/storeModulesService";
import { concederRecompensaIndicador } from "../../services/contas/indicacaoService";
import { syncCycleStatusFromCharge } from "../../services/assinaturas/recorrenciaService";
import { sendFinanceiroUpdated } from "../../hooks/financeiro/socket";
import { applyStorePaymentEvent } from "../../services/loja/lojaOrderService";
import { faturarOrdemServicoPorPagamento } from "../../services/servicos/faturarOrdemServicoService";

function extractChargeUidFromExternalReference(externalReference?: string | null) {
  if (!externalReference) return null;
  const match = externalReference.match(/cobranca:([^|]+)/i);
  return match?.[1] || null;
}

function extractContaIdFromExternalReference(externalReference?: string | null) {
  const match = externalReference?.match(/conta:(\d+)/i);
  return match ? Number(match[1]) : null;
}

export async function getPaymentMercadoPago(req: Request, res: Response) {
  try {
    const { id } = req.query;
    const payment = await mercadoPagoPayment.get({ id: Number(id) });
    res.status(200).json(payment);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
export async function webhookMercadoPago(
  req: Request,
  res: Response
): Promise<any> {
  try {
    const { type, id, data } = req.body || {};
    if (type !== "payment" || !id) return res.sendStatus(204);

    const payment = await mercadoPagoPayment.get({ id: Number(data.id) });
    const { status, external_reference, transaction_amount } = payment;

    if (!external_reference) return res.sendStatus(204);
    const contaId = Number(external_reference);

    const conta = await prisma.contas.findUniqueOrThrow({
      where: { id: contaId },
    });

    const vencimentoConta = conta.vencimento;
    const hoje = new Date();

    const vencimentoNovo = isBefore(vencimentoConta, hoje)
      ? addDays(hoje, 30)
      : addDays(vencimentoConta, 30);

    let statusFatura: StatusFatura = "PENDENTE";
    if (["approved", "authorized"].includes(status as string))
      statusFatura = "PAGO";
    if (["cancelled", "refunded"].includes(status as string))
      statusFatura = "CANCELADO";

    const faturaExistente = await prisma.faturasContas.findFirst({
      where: {
        contaId,
        asaasPaymentId: String(payment.id),
      },
    });

    let link_pagamento: string = "";
    if (payment.payment_type_id === "ticket") {
      link_pagamento = payment.transaction_details
        ?.external_resource_url as string;
    } else {
      link_pagamento = payment.point_of_interaction?.transaction_data
        ?.ticket_url as string;
    }

    if (!faturaExistente) {
      // O checkout já cria uma fatura pendente (chaveada pelo id da preferência).
      // Adota essa fatura para o pagamento em vez de criar uma duplicada.
      const pendente = await prisma.faturasContas.findFirst({
        where: {
          contaId,
          status: { in: ["PENDENTE", "ATRASADO"] },
        },
        orderBy: { criadoEm: "desc" },
      });

      if (pendente) {
        await prisma.faturasContas.update({
          where: { id: pendente.id },
          data: {
            asaasPaymentId: String(payment.id),
            urlPagamento: link_pagamento || pendente.urlPagamento,
            valor: transaction_amount ?? pendente.valor,
          },
        });
      } else {
        await prisma.faturasContas.create({
          data: {
            Uid: gerarIdUnicoComMetaFinal("INV"),
            asaasPaymentId: String(payment.id),
            urlPagamento: link_pagamento,
            valor: transaction_amount || 0,
            vencimento: addHours(hoje, 24),
            status: statusFatura,
            contaId,
          },
        });
      }
    }

    await prisma.faturasContas.updateMany({
      where: {
        contaId,
        asaasPaymentId: String(payment.id),
      },
      data: {
        status: statusFatura,
      },
    });

    if (statusFatura === "PAGO") {
      await prisma.contas.update({
        where: { id: contaId },
        data: {
          status: "ATIVO",
          vencimento: vencimentoNovo,
        },
      });
      await reconcileStoreModulesAfterPayment(contaId, vencimentoConta, vencimentoNovo);

      // Indicação: consome crédito próprio usado neste pagamento e, se esta conta foi
      // indicada, credita a recompensa (1ª vez) ao indicador.
      await consumirCreditoIndicacaoNoPagamento(contaId, transaction_amount || 0).catch((e) =>
        console.error("[indicacao] consumo de crédito falhou:", e),
      );
      await concederRecompensaIndicador({
        contaPaganteId: contaId,
        valorPago: transaction_amount || 0,
      }).catch((e) => console.error("[indicacao] recompensa ao indicador falhou:", e));

      await clearCacheAccount(conta.id);
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("Erro no webhook Mercado Pago:", err);
    return res.sendStatus(500);
  }
}
export async function webhookMercadoPagoCobrancas(
  req: Request,
  res: Response
): Promise<any> {
  try {
    const { type, data } = req.body || {};
    const paymentId = Number(data?.id);

    if (type !== "payment" || !paymentId) {
      return res.sendStatus(204);
    }

    const tenantHint = Number(req.query.contaId);
    let candidate = Number.isInteger(tenantHint) && tenantHint > 0
      ? await prisma.cobrancasFinanceiras.findFirst({ where: { contaId: tenantHint, gateway: "mercadopago", idCobranca: String(paymentId) } })
      : null;
    if (!candidate && !tenantHint) {
      // Compatibilidade para cobranças antigas, anteriores à URL de webhook tenant-scoped.
      const legacyCandidates = await prisma.cobrancasFinanceiras.findMany({ where: { gateway: "mercadopago", idCobranca: String(paymentId) }, take: 2 });
      if (legacyCandidates.length === 1) candidate = legacyCandidates[0];
    }
    const resolvedTenantId = tenantHint || candidate?.contaId;
    if (!resolvedTenantId) return res.sendStatus(204);

    const moduleCharge = await prisma.moduloOnConta.findFirst({
      where: {
        ...(candidate ? { cobrancaAtualId: candidate.id } : { contaId: resolvedTenantId, cobrancaAtualId: { not: null } }),
      },
      select: {
        id: true,
      },
    });

    let mp: MercadoPagoService;

    if (moduleCharge) {
      mp = getSaasMercadoPagoService();
    } else {
      const parametros = await prisma.parametrosConta.findUniqueOrThrow({
        where: { contaId: resolvedTenantId },
      });

      const tenantMp = await tryGetTenantMercadoPagoService(resolvedTenantId, parametros);

      if (!tenantMp) {
        console.warn(`Conta ${resolvedTenantId} sem credencial do Mercado Pago`);
        return res.sendStatus(204);
      }

      mp = tenantMp;
    }

    const payment = await mp.payment.get({ id: paymentId });
    const chargeUid = extractChargeUidFromExternalReference(payment.external_reference as string | undefined);
    const authoritativeTenantId = extractContaIdFromExternalReference(payment.external_reference as string | undefined);
    if (!chargeUid || authoritativeTenantId !== resolvedTenantId) return res.sendStatus(204);
    let cobranca = await prisma.cobrancasFinanceiras.findFirst({
      include: { cobrancasOnAgendamentos: true },
      where: { contaId: resolvedTenantId, Uid: chargeUid, gateway: "mercadopago" },
    });
    if (!cobranca) return res.sendStatus(204);
    if (cobranca.idCobranca !== String(paymentId)) {
      cobranca = await prisma.cobrancasFinanceiras.update({ where: { id: cobranca.id }, data: { idCobranca: String(paymentId) }, include: { cobrancasOnAgendamentos: true } });
    }

    const statusMap: Record<string, StatusPagamento> = {
      approved: "EFETIVADO",
      authorized: "EFETIVADO",
      cancelled: "CANCELADO",
      refunded: "ESTORNADO",
    };
    const paymentMethodMap: Record<string, MetodoPagamento> = {
      ticket: "BOLETO",
      bank_transfer: "PIX",
      atm: "OUTRO",
    };

    const statusNovo = statusMap[payment.status as string] ?? "PENDENTE";
    const metodoPago =
      paymentMethodMap[payment.payment_type_id as string] ?? "OUTRO";

    await prisma.cobrancasFinanceiras.update({
      where: { id: cobranca.id, contaId: cobranca.contaId },
      data: { status: statusNovo },
    });

    if (cobranca.pedidoLojaId) {
      await applyStorePaymentEvent({
        contaId: cobranca.contaId,
        pedidoId: cobranca.pedidoLojaId,
        provider: "MERCADOPAGO",
        eventId: `payment:${paymentId}:${statusNovo}`,
        paid: statusNovo === "EFETIVADO",
        refunded: ["CANCELADO", "ESTORNADO"].includes(statusNovo),
        payload: { paymentId, status: payment.status },
      });
      sendUpdateTable(cobranca.contaId, { reason: "loja-pagamento", pedidoId: cobranca.pedidoLojaId });
    }

    if (statusNovo === "EFETIVADO") {
      await syncCycleStatusFromCharge(cobranca.id, "PAGO");
    } else if (["CANCELADO", "ESTORNADO"].includes(statusNovo)) {
      await syncCycleStatusFromCharge(cobranca.id, "CANCELADO");
    }

    if (statusNovo === "EFETIVADO") {
      const moduloAtivado = await activateStoreModuleFromCharge(cobranca.id);
      if (moduloAtivado) {
        return res.sendStatus(200);
      }
    }

    if (["CANCELADO", "ESTORNADO"].includes(statusNovo)) {
      const moduloLiberado = await releaseStoreModuleCharge(cobranca.id);
      if (moduloLiberado) {
        return res.sendStatus(200);
      }
    }

    if (
      cobranca.cobrancasOnAgendamentos &&
      cobranca.cobrancasOnAgendamentos.length > 0 &&
      statusNovo === "EFETIVADO"
    ) {
      const promises = cobranca.cobrancasOnAgendamentos.map(async (reserva) => {
        const agendamento = await prisma.arenaAgendamentos.update({
          where: {
            id: reserva.agendamentoId,
            Quadra: { contaId: cobranca.contaId },
          },
          data: {
            status: "CONFIRMADA",
          },
        });
        return await prisma.arenaAgendamentosPagamentos.create({
          data: {
            agendamentoId: agendamento.id,
            valor: cobranca.valor,
            metodoPagamento: metodoPago,
            dataPagamento: new Date(),
            tipo: cobranca.valor < agendamento.valor ? "PARCIAL" : "TOTAL",
          },
        });
      });

      await Promise.all(promises);
    }

    if (cobranca.lancamentoId && statusNovo === "EFETIVADO") {
      const parcelaLiquidada = await prisma.parcelaFinanceiro.update({
        where: { id: cobranca.lancamentoId },
        data: {
          pago: true,
          dataPagamento: new Date(),
          formaPagamento: metodoPago,
        },
        select: { lancamentoId: true },
      });
      await prisma.$transaction((tx) => processarPosPagamentoRecorrencia(tx, parcelaLiquidada.lancamentoId));
      await atualizarStatusLancamentos(cobranca.contaId);
      sendFinanceiroUpdated(cobranca.contaId, {
        reason: "cobranca-liquidada-webhook",
        parcelaId: cobranca.lancamentoId,
      });
    }
    if (cobranca.reservaId && statusNovo === "EFETIVADO") {
      const pagamentoReserva = await prisma.arenaAgendamentos.update({
        where: {
          id: cobranca.reservaId,
          Quadra: { contaId: cobranca.contaId },
        },
        data: {
          status: "CONFIRMADA",
        },
      });
      await prisma.arenaAgendamentosPagamentos.create({
        data: {
          agendamentoId: pagamentoReserva.id,
          valor: cobranca.valor,
          metodoPagamento: metodoPago,
          dataPagamento: new Date(),
          tipo: cobranca.valor < pagamentoReserva.valor ? "PARCIAL" : "TOTAL",
        },
      });
    }
    if (cobranca.vendaId && statusNovo === "EFETIVADO") {
      const venda = await prisma.vendas.findUniqueOrThrow({
        where: { id: cobranca.vendaId, contaId: cobranca.contaId },
      });
      await prisma.vendas.update({
        where: { id: cobranca.vendaId },
        data: {
          faturado: true,
          status: "FATURADO",
          PagamentoVendas: {
            upsert: {
              where: { vendaId: cobranca.vendaId },
              create: {
                valor: venda.valor,
                data: new Date(),
                metodo: metodoPago,
                status: "EFETIVADO",
              },
              update: {
                metodo: metodoPago,
                data: new Date(),
                status: "EFETIVADO",
              },
            },
          },
        },
      });

      await sendUpdateTable(cobranca.contaId, {
        message: `A venda ${venda.Uid} foi efetivada`,
      });

      if (venda.comandaId) {
        await recalculateComandaStatus(prisma, venda.comandaId, cobranca.contaId);
      }
    }

    // Ordem de serviço: pagamento da cobrança fatura a OS automaticamente.
    if (cobranca.ordemServicoId && statusNovo === "EFETIVADO") {
      await faturarOrdemServicoPorPagamento(cobranca.ordemServicoId, cobranca.contaId);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Erro no webhook Mercado Pago:", err);
    res.sendStatus(500);
  }
}
