import fs from "fs";
import csvParser from "csv-parser";
import { parse as jsonToCsv } from "json2csv";
import { ImportResult, ProdutoCreate, ProdutoCSV } from "../../types/produtos";
import { prisma } from "../../utils/prisma";

export function gerarCsvBase(): string {
  const campos = [
    "nome",
    "descricao",
    "preco",
    "precoCompra",
    "entradas",
    "saidas",
    "unidade",
    "estoque",
    "minimo",
    "codigo",
  ];
  return jsonToCsv([], { fields: campos, delimiter: ";" });
}

export async function importarProdutos(
  arquivoPath: string,
  contaId: number
): Promise<ImportResult> {
  return new Promise((resolve, reject) => {
    const resultados: ProdutoCSV[] = [];
    const erros: ImportResult["erros"] = [];
    const produtosValidos: ProdutoCreate[] = [];

    fs.createReadStream(arquivoPath)
      .pipe(csvParser({ separator: ";" }))
      .on("data", (row: ProdutoCSV) => resultados.push(row))
      .on("end", async () => {
        try {
          resultados.forEach((produto, index) => {
            const linha = index + 2;

            if (
              !produto.nome ||
              !produto.preco ||
              !produto.estoque ||
              !produto.minimo
            ) {
              erros.push({
                linha,
                erro: "Campos obrigatórios ausentes: nome, preco, estoque, minimo",
              });
              return;
            }

            produtosValidos.push({
              contaId,
              nome: produto.nome.trim(),
              descricao: produto.descricao?.trim() || null,
              preco: parseFloat(produto.preco),
              precoCompra: produto.precoCompra
                ? parseFloat(produto.precoCompra)
                : null,
              entradas:
                produto.entradas !== undefined
                  ? produto.entradas.toLowerCase() === "true"
                  : true,
              saidas:
                produto.saidas !== undefined
                  ? produto.saidas.toLowerCase() === "true"
                  : true,
              unidade: produto.unidade?.trim() || null,
              estoque: parseInt(produto.estoque),
              minimo: parseInt(produto.minimo),
              codigo: produto.codigo?.trim() || null,
            });
          });

          fs.unlinkSync(arquivoPath);

          if (produtosValidos.length > 0) {
            await prisma.produto.createMany({
              data: produtosValidos,
              skipDuplicates: true,
            });
          }

          resolve({ inseridos: produtosValidos.length, erros });
        } catch (error) {
          reject(error);
        }
      })
      .on("error", reject);
  });
}
