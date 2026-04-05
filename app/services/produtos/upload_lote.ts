import fs from "fs";
import csvParser from "csv-parser";
import { parse as jsonToCsv } from "json2csv";
import Decimal from "decimal.js";
import { ImportResult, ProdutoCSV } from "../../types/produtos";
import { prisma } from "../../utils/prisma";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";

export function gerarCsvBase(): string {
  const campos = [
    "nome",
    "categoria",
    "nomeVariante",
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
      categoria: "Bebidas",
      nomeVariante: "Padrão",
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

    fs.createReadStream(arquivoPath)
      .pipe(csvParser({ separator: ";" }))
      .on("data", (row: ProdutoCSV) => resultados.push(row))
      .on("end", async () => {
        try {
          const produtosValidos = resultados
            .map((produto, index) => {
              const linha = index + 2;

              if (
                !produto.nome ||
                !produto.preco ||
                !produto.estoque ||
                !produto.minimo
              ) {
                erros.push({
                  linha,
                  erro:
                    "Campos obrigatórios ausentes: nome, preco, estoque, minimo",
                });
                return null;
              }

              const preco = parseFloat(produto.preco);
              const estoque = parseInt(produto.estoque);
              const minimo = parseInt(produto.minimo);

              if (isNaN(preco) || preco < 0) {
                erros.push({ linha, erro: "Preço inválido" });
                return null;
              }

              if (isNaN(estoque) || estoque < 0) {
                erros.push({ linha, erro: "Estoque inválido" });
                return null;
              }

              if (isNaN(minimo) || minimo < 0) {
                erros.push({ linha, erro: "Mínimo inválido" });
                return null;
              }

              return {
                nome: produto.nome.trim(),
                categoria: produto.categoria?.trim() || null,
                nomeVariante: produto.nomeVariante?.trim() || "Padrão",
                descricao: produto.descricao?.trim() || null,
                preco: new Decimal(preco),
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
                    ? ["sim", "true", "1"].includes(
                        produto.saidas.toLowerCase()
                      )
                    : true,
                unidade: produto.unidade?.trim() || null,
                estoque,
                minimo,
                codigo: produto.codigo?.trim() || null,
              };
            })
            .filter((item) => item !== null);

          fs.unlinkSync(arquivoPath);

          if (erros.length > 0 || produtosValidos.length === 0) {
            resolve({ inseridos: 0, erros });
            return;
          }

          const codigos = produtosValidos
            .map((p) => p.codigo)
            .filter((codigo): codigo is string => !!codigo);

          const existentes = await prisma.produto.findMany({
            where: {
              codigo: { in: codigos },
              contaId,
            },
            select: { codigo: true },
          });

          const codigosExistentes = new Set(existentes.map((e) => e.codigo));
          const novos = produtosValidos.filter(
            (p) => !p.codigo || !codigosExistentes.has(p.codigo)
          );

          if (!novos.length) {
            resolve({ inseridos: 0, erros });
            return;
          }

          await prisma.$transaction(async (tx) => {
            for (const produto of novos) {
              let categoriaId: number | null = null;

              if (produto.categoria) {
                const categoria = await tx.produtoCategoria.upsert({
                  where: {
                    contaId_nome: {
                      contaId,
                      nome: produto.categoria,
                    },
                  },
                  create: {
                    Uid: gerarIdUnicoComMetaFinal("PCAT"),
                    contaId,
                    nome: produto.categoria,
                    status: "ATIVO",
                  },
                  update: {},
                });
                categoriaId = categoria.id;
              }

              const produtoBase = await tx.produtoBase.create({
                data: {
                  Uid: gerarIdUnicoComMetaFinal("PB"),
                  contaId,
                  categoriaId,
                  nome: produto.nome,
                  descricao: produto.descricao,
                },
              });

              await tx.produto.create({
                data: {
                  contaId,
                  produtoBaseId: produtoBase.id,
                  Uid: gerarIdUnicoComMetaFinal("PRO"),
                  nome: produto.nome,
                  nomeVariante: produto.nomeVariante,
                  ehPadrao: true,
                  descricao: produto.descricao,
                  preco: produto.preco,
                  precoCompra: produto.precoCompra,
                  entradas: produto.entradas,
                  saidas: produto.saidas,
                  unidade: produto.unidade,
                  estoque: produto.estoque,
                  minimo: produto.minimo,
                  codigo: produto.codigo,
                  status: "ATIVO",
                  categoria: produto.categoria,
                  producaoLocal: false,
                  controlaEstoque: false,
                  mostrarNoPdv: true,
                  materiaPrima: false,
                  custoMedioProducao: null,
                },
              });
            }
          });

          resolve({ inseridos: novos.length, erros });
        } catch (error) {
          if (fs.existsSync(arquivoPath)) fs.unlinkSync(arquivoPath);
          reject(error);
        }
      })
      .on("error", reject);
  });
}
