import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { PrismaDataTableBuilder } from "../../services/prismaDatatables";
import {
  LancamentoFinanceiro,
  MetodoPagamento,
  StatusPagamentoFinanceiro,
  TipoLancamentoFinanceiro,
} from "../../../generated";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { acoes } from "./acoes";
import {
  formatCurrencyBR,
  formatDateToPtBR,
  formatLabel,
  formatToCapitalize,
} from "../../helpers/formatters";
import Decimal from "decimal.js";
import { isAccountOverdue } from "../../routers/web";

const formateStatus = (status: StatusPagamentoFinanceiro) => {
  const statusFormated = formatToCapitalize(status);
  switch (status) {
    case "PAGO":
      return `<span class="px-2 py-0.5 flex border-2 flex-nowrap w-max text-green-800 border-green-400 dark:border-green-900 dark:text-green-300 rounded-xl">${statusFormated}</span>`;
    case "PARCIAL":
      return `<span class="px-2 py-0.5 flex border-2 flex-nowrap w-max text-blue-800 border-blue-400 dark:border-blue-900 dark:text-blue-300 rounded-xl">${statusFormated}</span>`;
    case "PENDENTE":
      return `<span class="px-2 py-0.5 flex border-2 flex-nowrap w-max text-yellow-800 border-yellow-400 dark:border-yellow-900 dark:text-yellow-300 rounded-xl">${statusFormated}</span>`;
    case "ATRASADO":
      return `<span class="px-2 py-0.5 flex border-2 flex-nowrap w-max text-red-800 border-red-400 dark:border-red-900 dark:text-red-300 rounded-xl">${statusFormated}</span>`;
    default:
      return `<span class="px-2 py-0.5 flex border-2 flex-nowrap w-max text-primary border-primary/20 rounded-xl">${statusFormated}</span>`;
  }
};
const formateTipo = (tipo: TipoLancamentoFinanceiro) => {
  const formatted = formatToCapitalize(tipo);
  switch (tipo) {
    case "RECEITA":
      return `<span class="px-2 py-0.5 flex items-center gap-1 border-2 flex-nowrap w-max text-green-800 border-green-400 dark:border-green-900 dark:text-green-300 rounded-xl">
      <i class="fa-solid fa-caret-up text-base"></i> ${formatted}</span>`;
    case "DESPESA":
      return `<span class="px-2 py-0.5 flex items-center gap-1 border-2 flex-nowrap w-max text-red-800 border-red-400 dark:border-red-900 dark:text-red-300 rounded-xl">
      <i class="fa-solid fa-caret-down text-base"></i> ${formatted}</span>`;
  }
};
const formateTipoPagamento = (tipo: MetodoPagamento) => {
  const formatted = formatToCapitalize(tipo);
  const baseClasses = `inline-flex items-center gap-1 px-2 py-0.5 border-2 rounded-xl w-max text-sm`;

  switch (tipo) {
    case "BOLETO":
    case "CHEQUE":
      return `<span class="${baseClasses} text-gray-800 border-gray-400 dark:border-gray-900 dark:text-gray-300">
        <i class="fa-regular fa-file-lines text-base"></i>
        <span>${formatted}</span>
      </span>`;
    case "CREDITO":
    case "DEBITO":
    case "CARTAO":
      return `<span class="${baseClasses} text-violet-800 border-violet-400 dark:border-violet-900 dark:text-violet-300">
        <i class="fa-solid fa-credit-card text-base"></i>
        <span>${formatted}</span>
      </span>`;
    case "DINHEIRO":
      return `<span class="${baseClasses} text-green-800 border-green-400 dark:border-green-900 dark:text-green-300">
        <i class="fa-solid fa-money-bill text-base"></i>
        <span>${formatted}</span>
      </span>`;
    case "PIX":
      return `<span class="${baseClasses} text-emerald-800 border-emerald-400 dark:border-emerald-900 dark:text-emerald-300">
        <i class="fa-brands fa-pix text-base"></i>
        <span>${formatted}</span>
      </span>`;
    case "TRANSFERENCIA":
      return `<span class="${baseClasses} text-blue-800 border-blue-400 dark:border-blue-900 dark:text-blue-300">
        <i class="fa-solid fa-money-bill-transfer text-base"></i>
        <span>${formatted}</span>
      </span>`;
    case "GATEWAY":
      return `<span class="${baseClasses} text-purple-800 border-purple-400 dark:border-purple-900 dark:text-purple-300">
        <i class="fa-solid fa-link text-base"></i>
        <span>${formatted}</span>
      </span>`;
    default:
      return `<span class="${baseClasses} text-slate-800 border-slate-400 dark:border-slate-900 dark:text-slate-300">
        <i class="fa-solid fa-dollar-sign text-base"></i>
        <span>${formatted}</span>
      </span>`;
  }
};

const formatLabelId = (row: LancamentoFinanceiro) => {
  let color = "text-yellow-500";
  let label = "";
  if (row.status === "PAGO") color = "text-green-500";
  let icon = `<i class="fa-solid ${color} fa-dollar-sign"></i>`;
  if (row.vendaId) {
    icon = `<i class="fa-solid ${color} fa-tag"></i>`
    label = "Vinculado a uma venda";
  };
  return `<span title="${label}" class="px-2 py-1 flex flex-nowrap justify-center items-center gap-2 w-max border border-gray-700 text-gray-900 bg-gray-100 dark:border-gray-500 dark:bg-gray-950 dark:text-gray-100 rounded-md">
    ${icon}${row.Uid}
  </span>`;
};

export const tableLancamentos = async (
  req: Request,
  res: Response
): Promise<any> => {
  const customData = getCustomRequest(req).customData;
  if (await isAccountOverdue(req)) {
    return res.status(404).json({
      message: "Conta inativa ou bloqueada, verifique seu plano",
    });
  }
  const builder = new PrismaDataTableBuilder<LancamentoFinanceiro>(
    prisma.lancamentoFinanceiro
  )
    .where({
      contaId: customData.contaId,
      tipo: req.query?.tipo || undefined,
      contasFinanceiroId: Number(req.query?.conta) || undefined,
      status: req.query?.status || undefined,
      categoriaId: Number(req.query?.categoria) || undefined,
      formaPagamento: req.query?.pagamento || undefined,
      clienteId: Number(req.query?.cliente) || undefined,
      valorTotal:
        req.query?.valorMinimo && req.query?.valorMaximo
          ? {
              gte: new Decimal(parseFloat(req.query?.valorMinimo as string)),
              lte: new Decimal(parseFloat(req.query?.valorMaximo as string)),
            }
          : undefined,
    })
    .search({
      id: "number",
      descricao: "string",
      valorTotal: "decimal",
    })
    .edit("Uid", function (row) {
      return formatLabelId(row);
    })
    .format("status", function (status) {
      return formateStatus(status);
    })
    .format("tipo", function (tipo) {
      return formateTipo(tipo);
    })
    .format("valorTotal", function (row) {
      return formatCurrencyBR(row);
    })
    .format("formaPagamento", function (valor) {
      return formateTipoPagamento(valor);
    })
    .format("dataLancamento", function (data) {
      return formatDateToPtBR(data);
    })
    .format("descricao", function (id) {
      return `<span class="px-2 py-1 flex max-w-48 truncate flex-nowrap w-max rounded-md">${id}</span>`;
    })
    .addColumn("forma", async (row) => {
      const parcelas = await prisma.parcelaFinanceiro.findMany({
        where: {
          lancamentoId: row.id,
        },
      });

      if (parcelas.length <= 1 ) {
        return formatLabel("à vista", "green", "fa-solid fa-money-bill");
      }

      return formatLabel(`${parcelas.length} vezes`, "blue", "fa-solid fa-receipt");
    })
    .addColumn("acoes", (row) => {
      return acoes(row);
    });
  const data = await builder.toJson(req.query);
  return res.json(data);
};
