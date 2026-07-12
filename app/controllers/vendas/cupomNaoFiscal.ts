import { Request, Response } from "express";
import Decimal from "decimal.js";
import dayjs from "dayjs";
import { formatarToRealValue } from "../../utils/formatters";
import { prisma } from "../../utils/prisma";

export const gerarCupomNaoFiscal = async (req: Request, res: Response): Promise<any> => {
  const vendaId = parseInt(req.params.id);

  // Largura do papel em colunas: 40 = 80mm (padrao), 32 = 58mm.
  // Enviada pelo front conforme a impressora configurada; limitada a uma faixa segura.
  const colsParam = parseInt(String(req.query.cols ?? ""), 10);
  const W = Number.isFinite(colsParam) ? Math.min(Math.max(colsParam, 24), 64) : 40;
  // Layout compacto (nome do item em linha propria) quando o papel e estreito.
  const compacto = W < 40;

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

  // Ajusta o texto a exatamente `n` colunas (preenche ou corta).
  const linha = (texto = "", n = W) => texto.padEnd(n, " ").substring(0, n);
  // Centraliza dentro da largura (o ESC/POS ja centraliza, isto e so um fallback visual).
  const centro = (texto = "", n = W) => {
    const t = texto.substring(0, n);
    const pad = Math.max(0, Math.floor((n - t.length) / 2));
    return " ".repeat(pad) + t;
  };
  // Rotulo a esquerda, valor a direita, ocupando a largura toda.
  const esqDir = (esq: string, dir: string, n = W) => {
    esq = String(esq);
    dir = String(dir);
    if (esq.length + dir.length + 1 > n) esq = esq.substring(0, Math.max(0, n - dir.length - 1));
    const espaco = Math.max(1, n - esq.length - dir.length);
    return esq + " ".repeat(espaco) + dir;
  };

  let cupom = "";

  // ======== ESC/POS base ========
  cupom += "\x1B\x40"; // Reset
  cupom += "\x1B\x61\x01"; // Centraliza
  cupom += `${venda.Contas.nome}\n`;
  cupom += `${venda.Contas.documento || "Sem documento"}\n`;
  cupom += "\n";

  cupom += "\x1B\x61\x00"; // Alinha à esquerda
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

  cupom += "-".repeat(W) + "\n";

  if (compacto) {
    // ----- Layout 58mm: cada item em duas linhas -----
    venda.ItensVendas.forEach((item: any) => {
      const total = new Decimal(item.valor).times(item.quantidade);
      cupom += linha(item.produto.nome) + "\n";
      cupom +=
        esqDir(
          `${item.quantidade} x ${formatarToRealValue(item.valor)}`,
          formatarToRealValue(total),
        ) + "\n";
    });
  } else {
    // ----- Layout 80mm: item em coluna unica (comportamento original) -----
    cupom += linha("ITEM              QTD  VL.UN  TOTAL") + "\n";
    cupom += "-".repeat(W) + "\n";

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
  }

  cupom += "-".repeat(W) + "\n";

  if (compacto) {
    cupom += esqDir("TOTAL:", formatarToRealValue(venda.valor)) + "\n";
    if (venda.PagamentoVendas) {
      cupom += esqDir("Pagamento:", venda.PagamentoVendas.metodo) + "\n";
    }
  } else {
    cupom += linha(`TOTAL: ${formatarToRealValue(venda.valor).padStart(30)}`) + "\n";
    if (venda.PagamentoVendas) {
      cupom += linha(`Pagamento: ${venda.PagamentoVendas.metodo}`) + "\n";
    }
  }

  cupom += "-".repeat(W) + "\n";
  // "OBRIGADO PELA PREFERÊNCIA!" tem 26 caracteres, cabe em ambas as larguras (32/40).
  cupom += (compacto ? centro("OBRIGADO PELA PREFERÊNCIA!") : "OBRIGADO PELA PREFERÊNCIA!") + "\n\n";

  // ======== Finalização ESC/POS ========
  cupom += "\x1B\x64\x03"; // Alimenta 3 linhas
  cupom += "\x1D\x56\x00"; // CORTA TOTAL

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.send(cupom);
};
