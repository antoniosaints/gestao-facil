import { Request, Response } from "express";
import Decimal from "decimal.js";
import dayjs from "dayjs";
import { formatarToRealValue } from "../../utils/formatters";
import { prisma } from "../../utils/prisma";

export const gerarCupomNaoFiscal = async (req: Request, res: Response): Promise<any> => {
  const vendaId = parseInt(req.params.id);

  const venda = await prisma.vendas.findUnique({
    where: { id: vendaId },
    include: {
      Contas: true,
      cliente: true,
      vendedor: true,
      ItensVendas: { include: { produto: true } },
      PagamentoVendas: true,
    },
  });

  if (!venda) {
    return res.status(404).json({ message: "Venda não encontrada" });
  }

  const linha = (texto = "", tamanho = 40) =>
    texto.padEnd(tamanho, " ").substring(0, tamanho);

  let cupom = "";

  // ======== ESC/POS base ========
  cupom += "\x1B\x40";       // Reset
  cupom += "\x1B\x61\x01";   // Centraliza
  cupom += `${venda.Contas.nome}\n`;
  cupom += `${venda.Contas.documento || "Sem documento"}\n`;
  cupom += "\n";

  cupom += "\x1B\x61\x00";   // Alinha à esquerda
  cupom += linha(`Data: ${dayjs(venda.data).format("DD/MM/YYYY HH:mm")}`) + "\n";
  cupom += linha(`Venda #${venda.Uid}`) + "\n";

  if (venda.cliente) {
    cupom += linha(`Cliente: ${venda.cliente.nome}`) + "\n";
  }
  if (venda.vendedor) {
    cupom += linha(`Vendedor: ${venda.vendedor.nome}`) + "\n";
  }
  if (venda.observacoes) {
    cupom += linha(`Observações: ${venda.observacoes}`) + "\n";
  }

  cupom += "-".repeat(40) + "\n";
  cupom += linha("ITEM              QTD  VL.UN  TOTAL") + "\n";
  cupom += "-".repeat(40) + "\n";

  venda.ItensVendas.forEach((item: any) => {
    const total = new Decimal(item.valor).times(item.quantidade);
    const nome = item.produto.nome.substring(0, 16);

    const linhaItem =
      nome.padEnd(16) +
      String(item.quantidade).padStart(4) + " " +
      formatarToRealValue(item.valor).padStart(8) +
      formatarToRealValue(total).padStart(10);

    cupom += linhaItem + "\n";
  });

  cupom += "-".repeat(40) + "\n";

  cupom += linha(`TOTAL: ${formatarToRealValue(venda.valor).padStart(30)}`) + "\n";

  if (venda.PagamentoVendas) {
    cupom += linha(`Pagamento: ${venda.PagamentoVendas.metodo}`) + "\n";
  }

  cupom += "-".repeat(40) + "\n";
  cupom += "OBRIGADO PELA PREFERÊNCIA!\n\n";

  // ======== Finalização ESC/POS ========
  cupom += "\x1B\x64\x03";    // Alimenta 3 linhas
  cupom += "\x1D\x56\x00";    // CORTA TOTAL

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.send(cupom);
};
