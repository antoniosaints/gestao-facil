import type { CustomData } from "../../helpers/getCustomRequest";
import { vendaSchema } from "../../schemas/vendas";
import { z } from "zod";
import Decimal from "decimal.js";
import { addHours } from "date-fns";
import { prisma } from "../../utils/prisma";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import { assertAvailableAndDecrement } from "../loja/lojaInventoryService";
import { criarLancamentoCrediarioVenda } from "./crediarioVendaService";
import { createComboVendaSaidas } from "../combos/comboService";
import {
  createFiscalIntentForSale,
  validateFiscalSalePreflight,
} from "../notasFiscais/fiscalSaleService";
import { enqueueFiscalEmission } from "../../queues/fiscalEmissionQueue";
import { enqueuePushNotificationByPreference } from "../notifications/notificationPreferenceService";
import { enqueueWhatsAppNotificationByPreference } from "../notifications/whatsappNotificationQueueService";
import { checkLowStockAndNotify } from "../notifications/lowStockNotificationService";
import { formatCurrency } from "../../utils/formatters";

// Shared by the regular form and Core IA. Inventory mutations remain transactional.
export async function criarVendaInternal(
  data: z.output<typeof vendaSchema>,
  customData: CustomData,
) {
  if (
    !data.itens.length ||
    data.itens.some(
      (item) =>
        !Number.isFinite(item.quantidade) ||
        item.quantidade <= 0 ||
        !Number.isFinite(item.preco) ||
        item.preco < 0,
    )
  )
    throw new Error("Informe itens com quantidade positiva e preço válido.");
  if (data.itens.some((item) => !Number.isInteger(item.quantidade)))
    throw new Error("A quantidade dos itens da venda deve ser inteira.");
  if (
    data.desconto != null &&
    (!Number.isFinite(data.desconto) || data.desconto < 0)
  )
    throw new Error("Desconto inválido.");
  if (data.tipoDocumentoFiscal !== "NENHUM") {
    await validateFiscalSalePreflight(customData.contaId, data.itens);
  }

  const comboItems = data.itens.filter((item) => item.tipo === "COMBO");
  const comboPrices = comboItems.length
    ? new Map(
        (
          await prisma.combo.findMany({
            where: {
              contaId: customData.contaId,
              ativo: true,
              id: { in: comboItems.map((item) => item.id) },
            },
            select: { id: true, preco: true },
          })
        ).map((item) => [item.id, item.preco]),
      )
    : new Map<number, Decimal>();
  if (comboPrices.size !== new Set(comboItems.map((item) => item.id)).size) {
    throw new Error("Um ou mais combos não estão disponíveis.");
  }
  const valorTotal = data.itens.reduce(
    (total, item) =>
      total.add(
        new Decimal(item.quantidade).mul(
          item.tipo === "COMBO" ? comboPrices.get(item.id) || 0 : item.preco,
        ),
      ),
    new Decimal(0),
  );

  const descontoTotal = data.desconto
    ? new Decimal(data.desconto)
    : new Decimal(0);

  if (descontoTotal.gt(valorTotal))
    throw new Error("O desconto não pode superar o valor da venda.");

  let notaFiscalId: number | null = null;
  const resultado = await prisma.$transaction(async (tx) => {
    if (
      data.clienteId &&
      !(await tx.clientesFornecedores.findFirst({
        where: { id: data.clienteId, contaId: customData.contaId },
        select: { id: true },
      }))
    )
      throw new Error("Cliente não encontrado nesta conta.");
    const venda = await tx.vendas.create({
      data: {
        Uid: gerarIdUnicoComMetaFinal("VEN"),
        valor: valorTotal.minus(descontoTotal),
        clienteId: data.clienteId,
        observacoes: data.observacoes,
        vendedorId: data.vendedorId || customData.userId,
        contaId: customData.contaId,
        comandaId: data.comandaId,
        data: addHours(data.data, 3),
        status: data.status,
        garantia: data.garantia,
        desconto: descontoTotal,
        PagamentoVendas: {
          create: {
            valor: 0,
            metodo: data.pagamento || "OUTRO",
            status: "PENDENTE",
          },
        },
      },
    });

    for (const item of data.itens) {
      if (item.tipo === "COMBO") continue;
      let itemName = item.nome || "Item";
      if (item.tipo === "PRODUTO") {
        const produto = await tx.produto.findUniqueOrThrow({
          where: { id: item.id, contaId: customData.contaId },
        });
        if (!produto) {
          throw new Error(`Produto ${item.id} não encontrado`);
        }
        if (produto.saidas === false) {
          throw new Error(
            `Produto ${produto.nome} não permite saídas, altere isso antes de continuar`,
          );
        }
        if (Number(produto.estoque) < item.quantidade) {
          throw new Error(
            `Produto ${produto.nome} não possui estoque suficiente (disponível: ${produto.estoque})`,
          );
        }
      }
      if (item.tipo === "SERVICO") {
        const servico = await tx.servicos.findUniqueOrThrow({
          where: { id: item.id, contaId: customData.contaId },
        });
        if (!servico) {
          throw new Error(`Serviço ${item.id} não encontrado`);
        }
      }

      await tx.itensVendas.create({
        data: {
          vendaId: venda.id,
          itemName,
          produtoId: item.tipo === "PRODUTO" ? item.id : null,
          servicoId: item.tipo === "SERVICO" ? item.id : null,
          quantidade: item.quantidade,
          valor: new Decimal(item.preco),
        },
      });

      if (item.tipo === "PRODUTO") {
        await assertAvailableAndDecrement(
          tx,
          customData.contaId,
          item.id,
          item.quantidade,
        );
        await tx.movimentacoesEstoque.create({
          data: {
            Uid: gerarIdUnicoComMetaFinal("MOV"),
            vendaId: venda.id,
            produtoId: item.id,
            quantidade: item.quantidade,
            status: "CONCLUIDO",
            tipo: "SAIDA",
            clienteFornecedor: data.clienteId,
            contaId: customData.contaId,
            custo: new Decimal(item.preco),
          },
        });
      }
    }

    await createComboVendaSaidas(tx, {
      contaId: customData.contaId,
      vendaId: venda.id,
      canal: "VENDA",
      clienteId: data.clienteId,
      lines: comboItems.map((item) => ({
        id: item.id,
        quantidade: item.quantidade,
      })),
    });

    if (data.tipoDocumentoFiscal !== "NENHUM") {
      const nota = await createFiscalIntentForSale(tx, {
        contaId: customData.contaId,
        vendaId: venda.id,
        tipo: data.tipoDocumentoFiscal,
      });
      notaFiscalId = nota.id;
    }

    // Crediario: gera o financeiro parcelado a receber da venda (mesma logica do PDV PRO).
    if (data.pagamento === "CREDIARIO") {
      await criarLancamentoCrediarioVenda(tx, {
        contaId: customData.contaId,
        vendaId: venda.id,
        vendaUid: venda.Uid,
        clienteId: data.clienteId || null,
        dataVenda: data.data,
        valorBruto: valorTotal,
        valorTotal: valorTotal.minus(descontoTotal),
        desconto: descontoTotal,
        parcelas: data.crediarioParcelas || 1,
        primeiroVencimento: new Date(
          data.crediarioPrimeiroVencimento as string,
        ),
      });
    }

    return venda;
  });

  // Each post-commit integration runs independently; failure cannot undo a committed sale.
  const notifications = await Promise.allSettled([
    ...(notaFiscalId ? [enqueueFiscalEmission(notaFiscalId)] : []),
    enqueuePushNotificationByPreference(
      "VENDA_CONCLUIDA",
      {
        title: "Opa! 🏷️Nova venda.",
        body: `Uma nova venda no valor de ${formatCurrency(valorTotal.minus(descontoTotal))} foi realizada!`,
      },
      customData.contaId,
    ),
    enqueueWhatsAppNotificationByPreference(
      "NOVA_VENDA",
      {
        title: "🏷️Nova venda.",
        body: `Venda _*${resultado.Uid}*_ no valor de *${formatCurrency(valorTotal.minus(descontoTotal))}*.`,
      },
      customData.contaId,
    ),
    checkLowStockAndNotify(
      customData.contaId,
      data.itens
        .filter((item) => item.tipo === "PRODUTO")
        .map((item) => item.id),
    ),
  ]);
  for (const result of notifications)
    if (result.status === "rejected")
      console.warn("[vendas] integração pós-cadastro falhou");
  return resultado;
}
