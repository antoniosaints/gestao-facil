import PDFDocument from "pdfkit";
import { PassThrough } from "stream";
import { generateBarcodeImage, BarcodeSymbology } from "../utils/barcode";
import { prisma } from "../utils/prisma";
import { formatCurrency } from "../utils/formatters";

// 1mm em pontos PDF (PDFKit trabalha em pt: 72pt = 1 polegada = 25.4mm).
const MM = 2.834645669;

export interface EtiquetaModelo {
  id: string;
  nome: string;
  papel: "A4" | "A5" | "Letter" | "CUSTOM";
  larguraPapelMm?: number | null;
  alturaPapelMm?: number | null;
  margemTopoMm: number;
  margemEsquerdaMm: number;
  colunas: number;
  linhas: number;
  larguraEtiquetaMm: number;
  alturaEtiquetaMm: number;
  espacamentoHorizontalMm: number;
  espacamentoVerticalMm: number;
  paddingMm: number;
  mostrarNome: boolean;
  mostrarPreco: boolean;
  mostrarCodigoTexto: boolean;
  mostrarBorda: boolean;
  fonteNomePt: number;
  fontePrecoPt: number;
  simbologia: BarcodeSymbology;
}

export interface LabelSheetItem {
  produtoId: number;
  quantidade: number;
}

export interface GenerateLabelSheetParams {
  contaId: number;
  modelo: EtiquetaModelo;
  itens: LabelSheetItem[];
  posicaoInicial?: number; // 1-based; deixa em branco as posicoes anteriores da 1a folha
}

function buildProdutoDisplayName(product: {
  nome: string;
  nomeVariante?: string | null;
}) {
  return product.nomeVariante && product.nomeVariante !== "Padrão"
    ? `${product.nome} / ${product.nomeVariante}`
    : product.nome;
}

function resolvePageSize(modelo: EtiquetaModelo): string | [number, number] {
  switch (modelo.papel) {
    case "A5":
      return "A5";
    case "Letter":
      return "LETTER";
    case "CUSTOM":
      return [
        (modelo.larguraPapelMm || 210) * MM,
        (modelo.alturaPapelMm || 297) * MM,
      ];
    case "A4":
    default:
      return "A4";
  }
}

export async function generateLabelSheetStream(
  params: GenerateLabelSheetParams
): Promise<PassThrough> {
  const { contaId, modelo, itens } = params;

  const perPage = modelo.colunas * modelo.linhas;
  const posicaoInicial = Math.min(
    Math.max(1, Math.floor(params.posicaoInicial || 1)),
    perPage
  );

  const ids = Array.from(
    new Set(itens.map((i) => i.produtoId).filter((id) => Number.isFinite(id)))
  );

  const produtos = await prisma.produto.findMany({
    where: { id: { in: ids }, contaId },
    select: { id: true, nome: true, nomeVariante: true, preco: true, codigo: true },
  });

  const produtoMap = new Map(produtos.map((p) => [p.id, p]));

  // Fila plana de etiquetas: cada produto repetido pela sua quantidade, ignorando
  // produtos inexistentes/de outra conta ou sem codigo de barras.
  const fila: { produtoId: number }[] = [];
  for (const item of itens) {
    const produto = produtoMap.get(item.produtoId);
    if (!produto || produto.codigo === null) continue;
    const qtd = Math.max(0, Math.floor(item.quantidade || 0));
    for (let i = 0; i < qtd; i++) fila.push({ produtoId: item.produtoId });
  }

  if (fila.length === 0) {
    throw new Error(
      "Nenhuma etiqueta para gerar. Verifique se os produtos possuem codigo de barras."
    );
  }

  // Um barcode por codigo distinto (reaproveitado em todas as etiquetas do mesmo produto).
  const barcodeCache = new Map<string, Buffer>();
  for (const id of produtoMap.keys()) {
    const produto = produtoMap.get(id)!;
    if (produto.codigo === null || barcodeCache.has(produto.codigo)) continue;
    barcodeCache.set(
      produto.codigo,
      await generateBarcodeImage(produto.codigo, {
        symbology: modelo.simbologia,
        includetext: modelo.mostrarCodigoTexto,
      })
    );
  }

  const sizeOption = resolvePageSize(modelo);
  const doc = new PDFDocument({ size: sizeOption, margin: 0 });
  const stream = new PassThrough();
  doc.pipe(stream);

  doc.registerFont("Roboto", "./public/fonts/Roboto-Regular.ttf");
  doc.registerFont("Roboto-Bold", "./public/fonts/Roboto-Bold.ttf");

  // Medidas fixas do modelo em pt.
  const labelW = modelo.larguraEtiquetaMm * MM;
  const labelH = modelo.alturaEtiquetaMm * MM;
  const padding = modelo.paddingMm * MM;
  const stepX = (modelo.larguraEtiquetaMm + modelo.espacamentoHorizontalMm) * MM;
  const stepY = (modelo.alturaEtiquetaMm + modelo.espacamentoVerticalMm) * MM;
  const marginLeft = modelo.margemEsquerdaMm * MM;
  const marginTop = modelo.margemTopoMm * MM;

  const nameHeight = modelo.mostrarNome ? modelo.fonteNomePt + 2 : 0;
  const priceHeight = modelo.mostrarPreco ? modelo.fontePrecoPt + 2 : 0;

  const offset = posicaoInicial - 1;
  let renderedPages = 1; // o documento ja comeca com 1 pagina

  fila.forEach((etiqueta, j) => {
    const produto = produtoMap.get(etiqueta.produtoId)!;
    const absPos = offset + j;
    const pageIndex = Math.floor(absPos / perPage);
    const posInPage = absPos % perPage;
    const col = posInPage % modelo.colunas;
    const row = Math.floor(posInPage / modelo.colunas);

    while (renderedPages <= pageIndex) {
      doc.addPage({ size: sizeOption, margin: 0 });
      renderedPages++;
    }

    const x = marginLeft + col * stepX;
    const y = marginTop + row * stepY;

    if (modelo.mostrarBorda) {
      doc
        .save()
        .dash(2, { space: 2 })
        .lineWidth(0.5)
        .strokeColor("#C7CBD1")
        .rect(x, y, labelW, labelH)
        .stroke()
        .undash()
        .restore();
    }

    const boxX = x + padding;
    const boxW = labelW - padding * 2;
    const boxTop = y + padding;
    const boxH = labelH - padding * 2;

    let cursorY = boxTop;

    if (modelo.mostrarNome) {
      doc
        .font("Roboto-Bold")
        .fontSize(modelo.fonteNomePt)
        .fillColor("#111111")
        .text(buildProdutoDisplayName(produto), boxX, cursorY, {
          width: boxW,
          height: nameHeight,
          align: "center",
          ellipsis: true,
          lineBreak: false,
        });
      cursorY += nameHeight;
    }

    // Barcode ocupa o espaco vertical restante entre nome e preco, mantendo proporcao.
    const barcodeH = Math.max(0, boxH - nameHeight - priceHeight);
    if (produto.codigo && barcodeH > 0) {
      const buffer = barcodeCache.get(produto.codigo);
      if (buffer) {
        doc.image(buffer, boxX, cursorY, {
          fit: [boxW, barcodeH],
          align: "center",
          valign: "center",
        });
      }
    }

    if (modelo.mostrarPreco) {
      doc
        .font("Roboto-Bold")
        .fontSize(modelo.fontePrecoPt)
        .fillColor("#111111")
        .text(formatCurrency(produto.preco), boxX, boxTop + boxH - priceHeight, {
          width: boxW,
          height: priceHeight,
          align: "center",
          lineBreak: false,
        });
    }
  });

  doc.end();
  return stream;
}
