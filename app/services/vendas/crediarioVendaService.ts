import Decimal from "decimal.js";
import { addMonths, startOfDay } from "date-fns";
import type { Prisma } from "../../../generated";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import { requireContaFinanceiraPadrao } from "../financeiro/contaFinanceiraPadraoService";

type PrismaTransaction = Prisma.TransactionClient;

// Divide o valor total em N parcelas, jogando eventuais centavos residuais na
// ultima parcela para o somatorio bater exatamente com o total.
function dividirValorEmParcelas(total: Decimal, parcelas: number) {
  const quantidade = Math.max(1, parcelas);
  const base = total.dividedBy(quantidade).toDecimalPlaces(2);
  const valores = Array.from({ length: quantidade }, () => base);
  const diferenca = total.minus(base.times(quantidade));

  if (!diferenca.isZero()) {
    valores[valores.length - 1] = valores[valores.length - 1].plus(diferenca);
  }

  return valores;
}

async function getOrCreateCategoriaVendas(
  tx: PrismaTransaction,
  contaId: number
) {
  const nome = "Vendas PDV";
  const categoria = await tx.categoriaFinanceiro.findFirst({
    where: {
      contaId,
      nome,
    },
    select: {
      id: true,
    },
  });

  if (categoria) return categoria.id;

  const novaCategoria = await tx.categoriaFinanceiro.create({
    data: {
      contaId,
      nome,
      Uid: gerarIdUnicoComMetaFinal("CAT"),
    },
    select: {
      id: true,
    },
  });

  return novaCategoria.id;
}

// Cria o lancamento financeiro parcelado (crediario) de uma venda, com as
// parcelas pendentes. Mesma logica usada na finalizacao do PDV PRO, para que a
// venda ja gere o financeiro parcelado a receber.
export async function criarLancamentoCrediarioVenda(
  tx: PrismaTransaction,
  params: {
    contaId: number;
    vendaId: number;
    vendaUid: string;
    clienteId?: number | null;
    dataVenda: Date;
    valorBruto: Decimal;
    valorTotal: Decimal;
    desconto: Decimal;
    parcelas: number;
    primeiroVencimento: Date;
  }
) {
  const categoriaId = await getOrCreateCategoriaVendas(tx, params.contaId);
  const contaFinanceiraId = await requireContaFinanceiraPadrao(tx, params.contaId);
  const valoresParcelas = dividirValorEmParcelas(params.valorTotal, params.parcelas);

  const lancamento = await tx.lancamentoFinanceiro.create({
    data: {
      Uid: gerarIdUnicoComMetaFinal("FIN"),
      contaId: params.contaId,
      vendaId: params.vendaId,
      clienteId: params.clienteId || null,
      categoriaId,
      descricao: `Crediario venda ${params.vendaUid}`,
      valorBruto: params.valorBruto,
      valorTotal: params.valorTotal,
      desconto: params.desconto,
      valorEntrada: new Decimal(0),
      tipo: "RECEITA",
      formaPagamento: "CREDIARIO" as any,
      status: "PENDENTE",
      recorrente: params.parcelas > 1,
      origemSistema: "MANUAL",
      contasFinanceiroId: contaFinanceiraId,
      dataLancamento: startOfDay(params.dataVenda),
      parcelas: {
        create: valoresParcelas.map((valor, index) => ({
          Uid: gerarIdUnicoComMetaFinal("PAR"),
          numero: index + 1,
          valor,
          vencimento: startOfDay(addMonths(params.primeiroVencimento, index)),
          pago: false,
          valorPago: null,
          dataPagamento: null,
          formaPagamento: null,
          contaFinanceira: contaFinanceiraId,
          descricao: `Parcela ${index + 1}/${params.parcelas} - Venda ${params.vendaUid}`,
        })),
      },
    },
  });

  return lancamento;
}
