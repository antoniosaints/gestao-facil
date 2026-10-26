import Decimal from "decimal.js";
import { addHours } from "date-fns";
import type { z } from "zod";
import type { Prisma, ItensOrdensServico } from "../../../generated";
import type { CustomData } from "../../helpers/getCustomRequest";
import type { saveOrdemServicoSchema } from "../../schemas/ordemservico";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import { assertAvailableAndDecrement } from "../loja/lojaInventoryService";

type StockOperations = {
 restoreComboOrdemStock: typeof import("../combos/comboService").restoreComboOrdemStock;
 createComboOrdemSaidas: typeof import("../combos/comboService").createComboOrdemSaidas;
};

// Same edit operation used by Normal and Fácil. Lock before observing status.
export async function atualizarOrdemTx(tx: Prisma.TransactionClient, osId: number, data: z.output<typeof saveOrdemServicoSchema>, customData: CustomData, stock: StockOperations) {
  const { restoreComboOrdemStock, createComboOrdemSaidas } = stock;
  await tx.$queryRaw`SELECT id FROM OrdensServico WHERE id = ${osId} AND contaId = ${customData.contaId} FOR UPDATE`;
    const ordemEncontrada = await tx.ordensServico.findUnique({
      where: {
        id: osId,
        contaId: customData.contaId,
      },
      include: {
        ItensOrdensServico: true,
      },
    });

    if (!ordemEncontrada) {
      throw new Error("OS nao encontrada");
    }

    if (ordemEncontrada.status === "FATURADA") {
      throw new Error("OS faturada não pode ser editada.");
    }

    const itensOSOriginal = ordemEncontrada.ItensOrdensServico || [];
    const comboMovements = await tx.comboSaidaComponente.findMany({
      where: { contaId: customData.contaId, ComboSaida: { ordemServicoId: ordemEncontrada.id }, movimentacaoId: { not: null } },
      select: { movimentacaoId: true },
    });
    await restoreComboOrdemStock(tx, customData.contaId, ordemEncontrada.id);
    await tx.comboSaida.deleteMany({ where: { contaId: customData.contaId, ordemServicoId: ordemEncontrada.id } });
    await tx.movimentacoesEstoque.deleteMany({
      where: { id: { in: comboMovements.flatMap((item) => item.movimentacaoId ? [item.movimentacaoId] : []) } },
    });

    // Remove itens e movimentações antigas
    await tx.itensOrdensServico.deleteMany({
      where: { ordemId: ordemEncontrada.id },
    });

    await Promise.all(
      itensOSOriginal.map(async (item) => {
        if (item.tipo === "PRODUTO") {
          await tx.movimentacoesEstoque.deleteMany({
            where: {
              ordemId: ordemEncontrada.id,
              produtoId: item.produtoId!,
            },
          });
          await tx.produto.update({
            where: {
              id: item.produtoId!,
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
    const itensOrdemServico = data.itens.filter((item) => item.tipo !== "COMBO").map(
      (item): Omit<ItensOrdensServico, "id" | "createdAt" | "updatedAt"> => ({
        ordemId: ordemEncontrada.id,
        itemName: item.nome,
        tipo: item.tipo === "PRODUTO" ? "PRODUTO" : "SERVICO",
        produtoId: item.tipo === "PRODUTO" ? item.id : null,
        servicoId: item.tipo === "SERVICO" ? item.id : null,
        quantidade: item.quantidade,
        valor: new Decimal(item.valor),
      })
    );

    await tx.itensOrdensServico.createMany({
      data: itensOrdemServico,
    });

    const descontoTotal = data.desconto
      ? new Decimal(data.desconto)
      : new Decimal(0);

    await Promise.all(
      itensOrdemServico.map(async (item) => {
        if (item.tipo === "PRODUTO") {
          await assertAvailableAndDecrement(tx, customData.contaId, item.produtoId!, item.quantidade);
          await tx.movimentacoesEstoque.create({
            data: {
              Uid: gerarIdUnicoComMetaFinal("MOV"),
              ordemId: ordemEncontrada.id,
              produtoId: item.produtoId!,
              quantidade: item.quantidade,
              status: "CONCLUIDO",
              tipo: "SAIDA",
              clienteFornecedor: data.clienteId,
              contaId: customData.contaId,
              custo: new Decimal(item.valor),
            },
          });
        }
      })
    );
    await createComboOrdemSaidas(tx, {
      contaId: customData.contaId,
      ordemServicoId: ordemEncontrada.id,
      clienteId: data.clienteId,
      lines: data.itens.filter((item) => item.tipo === "COMBO").map((item) => ({ id: item.id, quantidade: item.quantidade })),
    });

    await tx.ordensServico.update({
      where: {
        id: ordemEncontrada.id,
        contaId: customData.contaId,
      },
      data: {
        clienteId: data.clienteId,
        descricao: data.descricao,
        descricaoCliente: data.descricaoCliente,
        operadorId: data.vendedorId,
        contaId: customData.contaId,
        data: addHours(data.data, 3),
        status: data.status,
        garantia: String(data.garantia),
        desconto: descontoTotal,
      },
    });

    // Retorna venda atualizada
    return await tx.ordensServico.findUnique({
      where: { id: ordemEncontrada.id, contaId: customData.contaId },
      include: { ItensOrdensServico: true, ComboSaidas: { include: { componentes: true } } },
    });
}
