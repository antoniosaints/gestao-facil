import PDFDocument from 'pdfkit';
import { generateBarcodeImage } from '../utils/barcode';
import { PassThrough } from 'stream';
import { prisma } from '../utils/prisma';
import { formatCurrency } from '../utils/formatters';

export interface BarcodeLabelOptions {
  quantity?: number;
  mostrarNome?: boolean;
  mostrarPreco?: boolean;
}

const BARCODE_WIDTH = 150;
const BARCODE_HEIGHT = 42;
const LABEL_PADDING = 4;
const LABELS_PER_ROW = 3;
const LABEL_GAP = 10;
const NAME_FONT_SIZE = 6.5;
const PRICE_FONT_SIZE = 8;

function buildProdutoDisplayName(product: { nome: string; nomeVariante?: string | null }) {
  return product.nomeVariante && product.nomeVariante !== 'Padrão'
    ? `${product.nome} / ${product.nomeVariante}`
    : product.nome;
}

export async function generateBarcodesStream(
  productId: number,
  options: BarcodeLabelOptions = {},
): Promise<PassThrough> {
  const product = await prisma.produto.findUnique({
    where: { id: productId },
  });

  if (!product || product.codigo === null) {
    throw new Error('Produto não encontrado');
  }

  const mostrarNome = Boolean(options.mostrarNome);
  const mostrarPreco = Boolean(options.mostrarPreco);

  const doc = new PDFDocument({ size: 'A4', margin: 30 });
  const stream = new PassThrough();
  doc.pipe(stream);

  const nome = buildProdutoDisplayName(product);
  const preco = formatCurrency(product.preco);

  // Altura de cada bloco da etiqueta (layout compacto para corte)
  const nameHeight = mostrarNome ? NAME_FONT_SIZE + 3 : 0;
  const priceHeight = mostrarPreco ? PRICE_FONT_SIZE + 3 : 0;
  const labelWidth = BARCODE_WIDTH + LABEL_PADDING * 2;
  const labelHeight = LABEL_PADDING * 2 + nameHeight + BARCODE_HEIGHT + priceHeight;

  const startX = 30;
  const startY = 30;
  const quantidade = options.quantity || product.estoque;

  // O codigo e o mesmo em todas as etiquetas: gera a imagem uma unica vez.
  const barcodeBuffer = await generateBarcodeImage(product.codigo);

  let x = startX;
  let y = startY;
  let count = 0;

  for (let i = 0; i < quantidade; i++) {
    // Borda pontilhada leve para facilitar o corte
    doc
      .save()
      .dash(2, { space: 2 })
      .lineWidth(0.5)
      .strokeColor('#C7CBD1')
      .rect(x, y, labelWidth, labelHeight)
      .stroke()
      .undash()
      .restore();

    let cursorY = y + LABEL_PADDING;

    if (mostrarNome) {
      // Nome limitado a largura do codigo de barras (trunca com reticencias)
      doc
        .font('Helvetica-Bold')
        .fontSize(NAME_FONT_SIZE)
        .fillColor('#111111')
        .text(nome, x + LABEL_PADDING, cursorY, {
          width: BARCODE_WIDTH,
          height: NAME_FONT_SIZE + 2,
          align: 'center',
          ellipsis: true,
          lineBreak: false,
        });
      cursorY += nameHeight;
    }

    doc.image(barcodeBuffer, x + LABEL_PADDING, cursorY, {
      width: BARCODE_WIDTH,
      height: BARCODE_HEIGHT,
    });
    cursorY += BARCODE_HEIGHT;

    if (mostrarPreco) {
      doc
        .font('Helvetica-Bold')
        .fontSize(PRICE_FONT_SIZE)
        .fillColor('#111111')
        .text(preco, x + LABEL_PADDING, cursorY + 1, {
          width: BARCODE_WIDTH,
          height: PRICE_FONT_SIZE + 2,
          align: 'center',
          lineBreak: false,
        });
    }

    count++;
    if (count % LABELS_PER_ROW === 0) {
      x = startX;
      y += labelHeight + LABEL_GAP;
      if (y + labelHeight > doc.page.height - 30) {
        doc.addPage();
        y = startY;
      }
    } else {
      x += labelWidth + LABEL_GAP;
    }
  }

  doc.end();
  return stream;
}
