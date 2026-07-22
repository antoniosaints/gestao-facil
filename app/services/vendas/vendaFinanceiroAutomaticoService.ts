import Decimal from "decimal.js";
import type { Prisma, PrismaClient } from "../../../generated/client";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import { requireContaFinanceiraPadrao } from "../financeiro/contaFinanceiraPadraoService";

type DbClient = Prisma.TransactionClient | PrismaClient;

export type ParametrosLancamentoVenda = {
  vendaLancamentoAutomatico?: boolean | null;
  vendaCategoriaFinanceiraId?: number | null;
  vendaContaFinanceiraId?: number | null;
};

/// Decide se a venda deve gerar lançamento financeiro automático.
/// - Crediário tem fluxo próprio (parcelas a receber) e nunca entra aqui.
/// - Com o parâmetro da conta ativo, lança sempre — é a garantia que o ajuste promete.
/// - Sem o parâmetro, vale a escolha feita no modal de faturamento.
export function deveLancarFinanceiroVenda(args: {
  parametroAtivo?: boolean | null;
  lancamentoManual?: boolean | null;
  isCrediario?: boolean;
}) {
  if (args.isCrediario) return false;
  if (args.parametroAtivo) return true;
  return !args.lancamentoManual;
}

export async function getParametrosLancamentoVenda(
  db: DbClient,
  contaId: number,
): Promise<ParametrosLancamentoVenda> {
  const parametros = await db.parametrosConta.findUnique({
    where: { contaId },
    select: {
      vendaLancamentoAutomatico: true,
      vendaCategoriaFinanceiraId: true,
      vendaContaFinanceiraId: true,
    },
  });

  return parametros ?? {};
}

/// Cria o lançamento de receita já quitado de uma venda faturada.
/// A categoria vem das configurações; `categoriaFallback` cobre chamadas antigas
/// da API que ainda enviam a categoria no corpo da requisição.
export async function criarLancamentoVendaFaturada(
  db: DbClient,
  args: {
    contaId: number;
    vendaId: number;
    vendaUid: string;
    clienteId?: number | null;
    valorTotal: Decimal.Value;
    desconto?: Decimal.Value | null;
    dataPagamento: Date;
    formaPagamento: any;
    parametros: ParametrosLancamentoVenda;
    categoriaFallback?: number | null;
    contaFallback?: number | null;
  },
) {
  const categoriaId = args.parametros.vendaCategoriaFinanceiraId ?? args.categoriaFallback ?? null;

  if (!categoriaId) {
    throw new Error(
      "Defina a categoria financeira padrão das vendas em Configurações > Vendas para lançar o financeiro automaticamente.",
    );
  }

  const contaFinanceiraId = await requireContaFinanceiraPadrao(
    db,
    args.contaId,
    args.parametros.vendaContaFinanceiraId ?? args.contaFallback,
  );

  const valorTotal = new Decimal(args.valorTotal);
  const desconto = new Decimal(args.desconto || 0);

  return db.lancamentoFinanceiro.create({
    data: {
      Uid: gerarIdUnicoComMetaFinal("FIN"),
      contaId: args.contaId,
      vendaId: args.vendaId,
      clienteId: args.clienteId || null,
      valorBruto: valorTotal.plus(desconto),
      valorTotal,
      desconto,
      recorrente: false,
      dataLancamento: args.dataPagamento,
      descricao: `Venda ${args.vendaUid}`,
      status: "PAGO",
      categoriaId,
      contasFinanceiroId: contaFinanceiraId,
      formaPagamento: args.formaPagamento,
      tipo: "RECEITA",
      parcelas: {
        create: {
          Uid: gerarIdUnicoComMetaFinal("PAR"),
          numero: 1,
          valor: valorTotal,
          valorPago: valorTotal,
          vencimento: args.dataPagamento,
          dataPagamento: args.dataPagamento,
          formaPagamento: args.formaPagamento,
          pago: true,
          contaFinanceira: contaFinanceiraId,
        },
      },
    },
  });
}
