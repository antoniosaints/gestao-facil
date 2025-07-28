import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { PrismaDataTableBuilder } from "../../services/prismaDatatables";
import {
  FormaPagamentoFinanceiro,
  LancamentoFinanceiro,
  StatusPagamentoFinanceiro,
  TipoLancamentoFinanceiro,
} from "../../../generated";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { acoes } from "./acoes";
import {
  formatCurrencyBR,
  formatDateToPtBR,
  formatToCapitalize,
} from "../../helpers/formatters";
import Decimal from "decimal.js";

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
      return `<span class="px-2 py-0.5 flex border-2 flex-nowrap w-max text-green-800 border-green-400 dark:border-green-900 dark:text-green-300 rounded-xl">${formatted}</span>`;
    case "DESPESA":
      return `<span class="px-2 py-0.5 flex border-2 flex-nowrap w-max text-red-800 border-red-400 dark:border-red-900 dark:text-red-300 rounded-xl">${formatted}</span>`;
  }
};
const formateTipoPagamento = (tipo: FormaPagamentoFinanceiro) => {
  const formatted = formatToCapitalize(tipo);
  const baseClasses = `inline-flex items-center gap-1 px-2 py-0.5 border-2 rounded-xl w-max text-sm`;

  switch (tipo) {
    case "BOLETO":
      return `<span class="${baseClasses} text-gray-800 border-gray-400 dark:border-gray-900 dark:text-gray-300">
        <i class="fa-regular fa-file-lines text-base"></i>
        <span>${formatted}</span>
      </span>`;
    case "CREDITO":
    case "DEBITO":
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
  }
};

export const tableLancamentos = async (
  req: Request,
  res: Response
): Promise<any> => {
  const customData = getCustomRequest(req).customData;
  if (customData.contaStatus !== "ATIVO")
    return res.status(404).json({
      message: "Conta inativa ou bloqueada, verifique seu plano",
    });
  const builder = new PrismaDataTableBuilder<LancamentoFinanceiro>(
    prisma.lancamentoFinanceiro
  )
    .where({
      OR: [
        {
          contaId: customData.contaId,
        },
      ],
    })
    .search({
      id: "number",
      descricao: "string",
      valorTotal: "decimal",
    })
    .format("Uid", function (id) {
      return `<span class="px-2 py-1 flex flex-nowrap w-max border border-gray-700 text-gray-900 bg-gray-100 dark:border-gray-500 dark:bg-gray-950 dark:text-gray-100 rounded-md">#${id}</span>`;
    })
    .format("status", function (status) {
      return formateStatus(status);
    })
    .format("tipo", function (tipo) {
      return formateTipo(tipo);
    })
    .edit("valorTotal", function (row) {
      const valorAtual = new Decimal(row.valorTotal);
      const desconto = new Decimal(row.desconto);
      const valor = valorAtual.sub(desconto);
      return formatCurrencyBR(valor.toNumber());
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
    .addColumn("acoes", (row) => {
      return acoes(row);
    });
  const data = await builder.toJson(req.query);
  return res.json(data);
};
