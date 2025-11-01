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

    fs.createReadStream(arquivoPath)
      .pipe(csvParser({ separator: ";" }))
      .on("data", (row: ProdutoCSV) => resultados.push(row))
      .on("end", async () => {
        try {
          // 🔍 Validação completa antes de qualquer tentativa de insert
          const produtosValidos: Omit<Produto, "id">[] = [];

          resultados.forEach((produto, index) => {
            const linha = index + 2;

            // Validação básica
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
              return;
            }

            const preco = parseFloat(produto.preco);
            const estoque = parseInt(produto.estoque);
            const minimo = parseInt(produto.minimo);

            if (isNaN(preco) || preco < 0) {
              erros.push({ linha, erro: "Preço inválido" });
              return;
            }

            if (isNaN(estoque) || estoque < 0) {
              erros.push({ linha, erro: "Estoque inválido" });
              return;
            }

            if (isNaN(minimo) || minimo < 0) {
              erros.push({ linha, erro: "Mínimo inválido" });
              return;
            }

            produtosValidos.push({
              contaId,
              Uid: gerarIdUnicoComMetaFinal("PRO"),
              nome: produto.nome.trim(),
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
                  ? ["sim", "true", "1"].includes(produto.saidas.toLowerCase())
                  : true,
              unidade: produto.unidade?.trim() || null,
              estoque,
              minimo,
              codigo: produto.codigo?.trim() || null,
              status: "ATIVO",
              aliquotaCofins: null,
              aliquotaIcms: null,
              aliquotaIpi: null,
              aliquotaPis: null,
              categoria: null,
              cest: null,
              cfop: null,
              codigoProduto: null,
              ncm: null,
              origem: null,
              issAliquota: null,
              producaoLocal: false,
              controlaEstoque: false,
              custoMedioProducao: null,
            });
          });

          fs.unlinkSync(arquivoPath);

          // ❌ Se houver qualquer erro, encerra sem tentar inserir
          if (erros.length > 0 || produtosValidos.length === 0) {
            resolve({ inseridos: 0, erros });
            return;
          }

          // 🔎 Elimina duplicados dentro do CSV (por código)
          const codigosUnicos = new Set<string>();
          const semDuplicados = produtosValidos.filter((p) => {
            if (!p.codigo) return true;
            if (codigosUnicos.has(p.codigo)) return false;
            codigosUnicos.add(p.codigo);
            return true;
          });

          // 🔎 Busca duplicados no banco
          const codigos = semDuplicados
            .map((p) => p.codigo)
            .filter((c): c is string => !!c);

          const existentes = await prisma.produto.findMany({
            where: { codigo: { in: codigos }, contaId },
            select: { codigo: true },
          });

          const codigosExistentes = new Set(existentes.map((e) => e.codigo));
          const novos = semDuplicados.filter(
            (p) => !p.codigo || !codigosExistentes.has(p.codigo)
          );

          // ✅ Só agora insere os que passaram em todas as verificações
          if (novos.length > 0) {
            await prisma.produto.createMany({
              data: novos,
              skipDuplicates: false,
            });
          }

          resolve({ inseridos: novos.length, erros });
        } catch (error) {
          if (fs.existsSync(arquivoPath)) fs.unlinkSync(arquivoPath);
          reject(error);
        }
      })
      .on("error", reject);
  });
}
