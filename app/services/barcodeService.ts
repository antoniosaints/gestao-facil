import PDFDocument from 'pdfkit';
import { generateBarcodeImage } from '../utils/barcode';
import { PassThrough } from 'stream';
import { prisma } from '../utils/prisma';


export async function generateBarcodesStream(productId: number, quantity?: number): Promise<PassThrough> {
  const product = await prisma.produto.findUnique({
    where: { id: productId },
  });

  if (!product || product.codigo === null) {
    throw new Error('Produto não encontrado');
  }

  const doc = new PDFDocument({ size: 'A4', margin: 30 });
  const stream = new PassThrough();
  doc.pipe(stream);

  doc.fontSize(14).text(`Produto: ${product.nome}`, { align: 'center' });
  doc.moveDown(2);

  const quantidade = quantity || product.estoque;
  const barcodesPerRow = 3;
  const barcodeWidth = 150;
  const barcodeHeight = 60;
  let x = 50;
  let y = 70;
  let count = 0;

  for (let i = 0; i < quantidade; i++) {
    const barcodeBuffer = await generateBarcodeImage(product.codigo);
    doc.image(barcodeBuffer, x, y, { width: barcodeWidth, height: barcodeHeight });

    count++;
    if (count % barcodesPerRow === 0) {
      x = 50;
      y += barcodeHeight + 20;
      if (y + barcodeHeight > doc.page.height - 50) {
        doc.addPage();
        y = 50;
      }
    } else {
      x += barcodeWidth + 20;
    }
  }

  doc.end();
  return stream;
}
