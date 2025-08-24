import fs from "fs";
import csvParser from "csv-parser";
import { parse as jsonToCsv } from "json2csv";
import { ImportResult, ProdutoCSV } from "../../types/produtos";
import { prisma } from "../../utils/prisma";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import { Produto } from "../../../generated";
import Decimal from "decimal.js";

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

  const exemplo = [
    {
      nome: "Produto Exemplo",
      descricao: "Descrição do produto",
      preco: "100.00",
      precoCompra: "80.00",
      entradas: "Sim",
      saidas: "Sim",
      unidade: "UN",
      estoque: "10",
      minimo: "2",
      codigo: "COD123",
    },
  ];

  return jsonToCsv(exemplo, { fields: campos, delimiter: ";" });
}

export async function importarProdutos(
  arquivoPath: string,
  contaId: number
): Promise<ImportResult> {
  return new Promise((resolve, reject) => {
    const resultados: ProdutoCSV[] = [];
    const erros: ImportResult["erros"] = [];
    const produtosValidos: Omit<Produto, "id">[] = [];

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
              Uid: gerarIdUnicoComMetaFinal("PRO"),
              nome: produto.nome.trim(),
              descricao: produto.descricao?.trim() || null,
              preco: new Decimal(parseFloat(produto.preco)),
              precoCompra: produto.precoCompra
                ? new Decimal(parseFloat(produto.precoCompra))
                : null,
              entradas:
                produto.entradas !== undefined
                  ? ["sim", "true", "1"].includes(
                      produto.entradas.toLowerCase()
                    )
                  : true,
              saidas:
                produto.saidas !== undefined
                  ? ["sim", "true", "1"].includes(produto.saidas.toLowerCase())
                  : true,
              unidade: produto.unidade?.trim() || null,
              estoque: parseInt(produto.estoque),
              minimo: parseInt(produto.minimo),
              codigo: produto.codigo?.trim() || null,
              status: "ATIVO",
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
          fs.unlinkSync(arquivoPath);
          reject(error);
        }
      })
      .on("error", reject);
  });
}
