import Decimal from "decimal.js";
import { z } from "zod";
import { Prisma } from "../../../generated";
import { ReposicaoEstoqueSchema, DescarteEstoqueSchema, ReposicaoLoteSchema } from "../../schemas/produtos";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import { canDiscardProdutoStock } from "./estoqueService";
import { assertAvailableAndDecrement } from "../loja/lojaInventoryService";

export async function registrarReposicao(tx: Prisma.TransactionClient, contaId: number, data: z.output<typeof ReposicaoEstoqueSchema> & { data?: Date }) {
      const produtoExistente = await tx.produto.findFirst({
        where: {
          contaId: contaId,
          id: data.produtoId,
          entradas: true,
        },
      });

      if (!produtoExistente) {
        throw new Error(
          "Produto não permite entradas de estoque, altere isso antes de continuar."
        );
      }

      await tx.produto.update({
        where: { id: data.produtoId, contaId: contaId },
        data: { estoque: { increment: data.quantidade } },
      });

      const movimentacao = await tx.movimentacoesEstoque.create({
        data: {
          Uid: gerarIdUnicoComMetaFinal("MOV"),
          produtoId: data.produtoId as number,
          tipo: "ENTRADA",
          status: "CONCLUIDO",
          quantidade: data.quantidade || 0,
          custo: data.custo || 0,
          contaId: contaId,
          clienteFornecedor: data.fornecedor,
          notaFiscal: data.notaFiscal,
          desconto: data.desconto,
          frete: data.frete,
          ...(data.data ? { data: data.data } : {}),

        },
      });

      const produto = await tx.produto.findFirstOrThrow({
        where: {
          id: data.produtoId,
          contaId: contaId,
        },
        select: {
          id: true,
          nome: true,
          nomeVariante: true,
          unidade: true,
        },
      });

      return { movimentacao, produto };
}

export async function registrarDescarte(tx: Prisma.TransactionClient, contaId: number, data: z.output<typeof DescarteEstoqueSchema>) {
  const { produtoId, quantidade } = data;
  if (!produtoId || !quantidade) throw new Error("Produto e quantidade são obrigatórios");
      const produtoExistente = await tx.produto.findFirst({
        where: {
          contaId: contaId,
          id: produtoId,
        },
        select: {
          id: true,
          nome: true,
          nomeVariante: true,
          estoque: true,
          unidade: true,
          controlaEstoque: true,
        },
      });

      if (!produtoExistente) {
        throw new Error("Produto nao encontrado.");
      }

      if (produtoExistente.controlaEstoque === false) {
        throw new Error("Produto nao controla estoque.");
      }

      if (!canDiscardProdutoStock(Number(produtoExistente.estoque), quantidade)) {
        throw new Error(
          `Estoque insuficiente para descarte. Disponivel: ${produtoExistente.estoque}.`
        );
      }

      await assertAvailableAndDecrement(tx, contaId, produtoId, quantidade);
      await tx.movimentacoesEstoque.create({
        data: {
          Uid: gerarIdUnicoComMetaFinal("MOV"),
          contaId: contaId,
          produtoId,
          quantidade,
          custo: 0,
          tipo: "DESCARTE",
          status: "CONCLUIDO",
          notaFiscal: data.motivo || null,
        },
      });
      return tx.produto.findFirstOrThrow({
        where: { id: produtoId, contaId: contaId },
        select: {
          id: true,
          nome: true,
          nomeVariante: true,
          estoque: true,
          unidade: true,
        },
      });
}


export async function registrarReposicaoLote(tx: Prisma.TransactionClient, contaId: number, data: z.output<typeof ReposicaoLoteSchema>) {
    // Rateio de frete e desconto proporcional ao subtotal (custo * quantidade)
    // de cada item. O resíduo de arredondamento vai para o último item.
    const freteTotal = new Decimal(data.frete || 0);
    const descontoTotal = new Decimal(data.desconto || 0);
    const totalBase = data.itens.reduce(
      (acc, item) =>
        acc.plus(new Decimal(Number(item.custo)).times(Number(item.quantidade))),
      new Decimal(0)
    );

      const movimentacoes = [];
      let freteAcumulado = new Decimal(0);
      let descontoAcumulado = new Decimal(0);

      for (let i = 0; i < data.itens.length; i++) {
        const item = data.itens[i];
        const produtoId = Number(item.produtoId);
        const quantidade = Number(item.quantidade);
        const custo = Number(item.custo);
        const isUltimo = i === data.itens.length - 1;

        const produtoExistente = await tx.produto.findFirst({
          where: {
            contaId: contaId,
            id: produtoId,
          },
          select: {
            id: true,
            nome: true,
            nomeVariante: true,
            unidade: true,
            entradas: true,
          },
        });

        if (!produtoExistente) {
          throw new Error(`Produto #${produtoId} não encontrado.`);
        }

        if (produtoExistente.entradas === false) {
          throw new Error(
            `O produto ${produtoExistente.nome} não permite entradas de estoque, altere isso antes de continuar.`
          );
        }

        const base = new Decimal(custo).times(quantidade);
        const peso = totalBase.gt(0)
          ? base.div(totalBase)
          : new Decimal(1).div(data.itens.length);

        const freteItem = isUltimo
          ? freteTotal.minus(freteAcumulado)
          : freteTotal.times(peso).toDecimalPlaces(2);
        const descontoItem = isUltimo
          ? descontoTotal.minus(descontoAcumulado)
          : descontoTotal.times(peso).toDecimalPlaces(2);

        freteAcumulado = freteAcumulado.plus(freteItem);
        descontoAcumulado = descontoAcumulado.plus(descontoItem);

        await tx.produto.update({
          where: { id: produtoId, contaId: contaId },
          data: { estoque: { increment: quantidade } },
        });

        const movimentacao = await tx.movimentacoesEstoque.create({
          data: {
            Uid: gerarIdUnicoComMetaFinal("MOV"),
            produtoId: produtoId,
            tipo: "ENTRADA",
            status: "CONCLUIDO",
            quantidade: quantidade,
            custo: custo,
            contaId: contaId,
            clienteFornecedor: data.fornecedor ?? null,
            notaFiscal: data.notaFiscal ?? null,
            frete: freteItem.toNumber(),
            desconto: descontoItem.toNumber(),
            ...(data.data ? { data: data.data } : {}),
          },
        });

        movimentacoes.push({ movimentacao, produto: produtoExistente });
      }

      return movimentacoes;
}
