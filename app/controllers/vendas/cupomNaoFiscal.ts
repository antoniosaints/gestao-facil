import { Request, Response } from "express";
import Decimal from "decimal.js";
import dayjs from "dayjs";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { getNomeItemVenda } from "../../helpers/nomeItemVenda";
import { formatarToRealValue } from "../../utils/formatters";
import { prisma } from "../../utils/prisma";

// Caracteres sem acento que o NFD não decompõe e que precisam de equivalente ASCII.
const SUBSTITUICOES_ASCII: Record<string, string> = {
  "º": "o", "ª": "a", "°": "o", "–": "-", "—": "-",
  "“": '"', "”": '"', "‘": "'", "’": "'", "′": "'", "″": '"',
  "€": "EUR", "…": "...", "×": "x", "·": ".", "•": "*",
};

const REGEX_SUBSTITUICOES = new RegExp(`[${Object.keys(SUBSTITUICOES_ASCII).join("")}]`, "g");
const DIACRITICOS = /[̀-ͯ]/g; // marcas de acento separadas pelo NFD
const NAO_ASCII = /[^\x00-\x7f]/g;

/**
 * Reduz o texto a ASCII puro (ç→c, ã→a, Ê→E).
 *
 * Impressora térmica não recebe UTF-8: ela interpreta os bytes segundo a codepage
 * dela (CP437/CP850). Um "Ê" em UTF-8 são dois bytes (C3 8A) e sairiam como dois
 * caracteres errados no papel. Como a codepage varia por modelo, ASCII é o único
 * denominador comum que imprime certo em qualquer impressora.
 *
 * Os comandos ESC/POS são todos < 0x80, então atravessam esta função intactos.
 */
const toAscii = (texto: string) =>
  texto
    .replace(REGEX_SUBSTITUICOES, (c) => SUBSTITUICOES_ASCII[c])
    .normalize("NFD")
    .replace(DIACRITICOS, "")
    .replace(NAO_ASCII, "?");

export const gerarCupomNaoFiscal = async (req: Request, res: Response): Promise<any> => {
  const vendaId = parseInt(req.params.id);
  const customData = getCustomRequest(req).customData;

  // Largura do papel em colunas: 40 = 80mm (padrao), 32 = 58mm.
  // Enviada pelo front conforme a impressora configurada; limitada a uma faixa segura.
  const colsParam = parseInt(String(req.query.cols ?? ""), 10);
  const W = Number.isFinite(colsParam) ? Math.min(Math.max(colsParam, 24), 64) : 40;
  // Layout compacto (nome do item em linha propria) quando o papel e estreito.
  const compacto = W < 40;

  // contaId no where: sem ele qualquer usuario logado imprime o cupom de qualquer
  // venda do sistema trocando o id da URL.
  const venda = await prisma.vendas.findFirst({
    where: {
      id: vendaId,
      contaId: customData.contaId,
    },
    include: {
      Contas: true,
      cliente: true,
      vendedor: true,
      // servico junto: o item pode ser um serviço ou ter perdido o produto (SetNull).
      ItensVendas: { include: { produto: true, servico: true } },
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
      cupom += linha(getNomeItemVenda(item)) + "\n";
      cupom +=
        esqDir(
          `${item.quantidade} x ${formatarToRealValue(item.valor)}`,
          formatarToRealValue(total),
        ) + "\n";
    });
  } else {
    // ----- Layout 80mm: item em linha unica -----
    // Larguras derivadas de W (nao hardcoded): antes a linha somava 39 colunas fixas
    // com valores de largura variavel, e qualquer item >= R$ 1.000 estourava as 40
    // colunas e quebrava na impressora. Cabecalho e dados saem dos mesmos widths,
    // entao as colunas ficam alinhadas por construcao.
    const qtdW = 3;
    const valW = 9;   // comporta ate 999999.99
    const totW = 10;  // comporta ate 9999999.99
    const nameW = Math.max(8, W - qtdW - valW - totW - 2);
    // Sem o prefixo "R$ " nas colunas de item: e redundante num cupom em reais e
    // custa 3 colunas por valor, que fazem falta no papel estreito.
    const num = (v: Decimal | number) => new Decimal(v).toFixed(2);

    const colunas = (nome: string, qtd: string, val: string, tot: string) =>
      linha(
        nome.substring(0, nameW).padEnd(nameW) + " " +
        qtd.padStart(qtdW) + " " +
        val.padStart(valW) +
        tot.padStart(totW),
      );

    cupom += colunas("ITEM", "QTD", "VL.UN", "TOTAL") + "\n";
    cupom += "-".repeat(W) + "\n";

    venda.ItensVendas.forEach((item: any) => {
      const total = new Decimal(item.valor).times(item.quantidade);
      cupom +=
        colunas(
          getNomeItemVenda(item),
          String(item.quantidade),
          num(item.valor),
          num(total),
        ) + "\n";
    });
  }

  cupom += "-".repeat(W) + "\n";

  // Desconto so aparecia no PDF e no ticket da tela; sem ele o cupom impresso nao
  // explica por que o total difere da soma dos itens.
  const desconto = new Decimal(venda.desconto ?? 0);
  if (desconto.greaterThan(0)) {
    // Vendas.valor ja e liquido (valorBruto - desconto), entao o bruto se reconstroi somando.
    const subtotal = new Decimal(venda.valor).plus(desconto);
    cupom += esqDir("Subtotal:", formatarToRealValue(subtotal)) + "\n";
    cupom += esqDir("Desconto:", `-${formatarToRealValue(desconto)}`) + "\n";
  }

  cupom += esqDir("TOTAL:", formatarToRealValue(venda.valor)) + "\n";
  if (venda.PagamentoVendas) {
    cupom += esqDir("Pagamento:", venda.PagamentoVendas.metodo) + "\n";
  }

  cupom += "-".repeat(W) + "\n";
  cupom += centro("OBRIGADO PELA PREFERÊNCIA!") + "\n\n";

  // ======== Finalização ESC/POS ========
  cupom += "\x1B\x64\x03"; // Alimenta 3 linhas
  cupom += "\x1D\x56\x00"; // CORTA TOTAL

  // Um unico ponto de conversao: tudo que foi montado acima pode conter acento
  // (nome da empresa, produto, cliente, observacoes).
  res.setHeader("Content-Type", "text/plain; charset=us-ascii");
  res.send(toAscii(cupom));
};
