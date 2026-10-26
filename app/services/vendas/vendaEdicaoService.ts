import Decimal from "decimal.js";
import { addHours } from "date-fns";
import type { z } from "zod";
import type { Prisma, ItensOrdensServico } from "../../../generated";
import type { CustomData } from "../../helpers/getCustomRequest";
import type { vendaSchema } from "../../schemas/vendas";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import { assertAvailableAndDecrement } from "../loja/lojaInventoryService";

type StockOperations = {
 restoreComboVendaStock: typeof import("../combos/comboService").restoreComboVendaStock;
 createComboVendaSaidas: typeof import("../combos/comboService").createComboVendaSaidas;
};

// Same edit operation used by Normal and Fácil. Lock before observing status.
export async function atualizarVendaTx(tx: Prisma.TransactionClient, vendaId: number, data: z.output<typeof vendaSchema>, customData: CustomData, stock: StockOperations) {
  const { restoreComboVendaStock, createComboVendaSaidas } = stock;
  await tx.$queryRaw`SELECT id FROM Vendas WHERE id = ${vendaId} AND contaId = ${customData.contaId} FOR UPDATE`;
    const venda = await tx.vendas.findUnique({
      where: {
        id: vendaId,
        contaId: customData.contaId,
      },
      include: {
        ItensVendas: true,
      },
    });

    if (!venda) {
      throw new Error("Venda nao encontrada");
    }

    // Reescrever itens de uma venda faturada devolveria/baixaria estoque de algo
    // já efetivado no financeiro. O fluxo correto é estornar antes de editar.
    if (venda.status === "FATURADO") {
      throw new Error("Venda faturada não pode ser editada. Estorne o faturamento antes.");
    }

    const itensVendaOriginal = venda.ItensVendas || [];
    const comboMovements = await tx.comboSaidaComponente.findMany({
      where: { contaId: customData.contaId, ComboSaida: { vendaId: venda.id }, movimentacaoId: { not: null } },
      select: { movimentacaoId: true },
    });
    await restoreComboVendaStock(tx, customData.contaId, venda.id);
    await tx.comboSaida.deleteMany({ where: { contaId: customData.contaId, vendaId: venda.id } });
    await tx.movimentacoesEstoque.deleteMany({
      where: { id: { in: comboMovements.flatMap((item) => item.movimentacaoId ? [item.movimentacaoId] : []) } },
    });

    // Remove itens e movimentações antigas
    await tx.itensVendas.deleteMany({
      where: { vendaId: venda.id },
    });

    await Promise.all(
      itensVendaOriginal.map(async (item) => {
        if (item.produtoId) {
          await tx.movimentacoesEstoque.deleteMany({
            where: {
              vendaId: venda.id,
              produtoId: item.produtoId,
            },
          });
          await tx.produto.update({
            where: {
              id: item.produtoId,
              contaId: customData.contaId,
            },
            data: {
              estoque: { increment: item.quantidade },
            },
          });
        }
      })
    );

    // Novo conjunto de itens
    const itensVenda = data.itens.filter((item) => item.tipo !== "COMBO").map((item) => ({
      vendaId: venda.id,
      itemName: item.nome,
      produtoId: item.tipo === "PRODUTO" ? item.id : null,
      servicoId: item.tipo === "SERVICO" ? item.id : null,
      quantidade: item.quantidade,
      valor: new Decimal(item.preco),
    }));

    await tx.itensVendas.createMany({
      data: itensVenda,
    });

    const descontoTotal = data.desconto
      ? new Decimal(data.desconto)
      : new Decimal(0);

    await Promise.all(
      itensVenda.map(async (item) => {
        if (item.produtoId) {
          await assertAvailableAndDecrement(tx, customData.contaId, item.produtoId, item.quantidade);
          await tx.movimentacoesEstoque.create({
            data: {
              Uid: gerarIdUnicoComMetaFinal("MOV"),
              vendaId: venda.id,
              produtoId: item.produtoId,
              quantidade: item.quantidade,
              status: "CONCLUIDO",
              tipo: "SAIDA",
              clienteFornecedor: data.clienteId,
              contaId: customData.contaId,
              custo: new Decimal(item.valor), // aqui assumindo que o valor = preço de venda
            },
          });
        }
      })
    );

    const comboLines = data.itens
      .filter((item) => item.tipo === "COMBO")
      .map((item) => ({ id: item.id, quantidade: item.quantidade }));
    await createComboVendaSaidas(tx, {
      contaId: customData.contaId,
      vendaId: venda.id,
      canal: "VENDA",
      clienteId: data.clienteId,
      lines: comboLines,
    });

    // Calcula totais
    const comboPrices = comboLines.length
      ? new Map((await tx.combo.findMany({
          where: { contaId: customData.contaId, id: { in: comboLines.map((item) => item.id) } },
          select: { id: true, preco: true },
        })).map((item) => [item.id, item.preco]))
      : new Map<number, Decimal>();
    const valorTotal = data.itens.reduce((total, item) => total.add(
      new Decimal(item.quantidade).mul(item.tipo === "COMBO" ? comboPrices.get(item.id) || 0 : item.preco)
    ), new Decimal(0));

    await tx.vendas.update({
      where: {
        id: venda.id,
        contaId: customData.contaId,
      },
      data: {
        valor: valorTotal.minus(descontoTotal),
        clienteId: data.clienteId,
        observacoes: data.observacoes,
        comandaId: data.comandaId,
        vendedorId: data.vendedorId || customData.userId,
        contaId: customData.contaId,
        data: addHours(data.data, 3),
        status: data.status,
        garantia: data.garantia,
        desconto: descontoTotal,
      },
    });

    // Retorna venda atualizada
    return await tx.vendas.findUnique({
      where: { id: venda.id, contaId: customData.contaId },
      include: { ItensVendas: true },
    });
}
