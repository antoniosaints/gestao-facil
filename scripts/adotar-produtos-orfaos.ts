/**
 * Correção pontual: "adota" produtos órfãos — variantes (Produto) sem ProdutoBase, criadas pela
 * versão antiga da tool de IA `createProdutoNovo`. Como a tela de Produtos (modo "base") agrupa
 * por ProdutoBase, esses produtos não apareciam. Aqui criamos um ProdutoBase para cada órfão e o
 * vinculamos, mantendo nome/descrição/dados fiscais.
 *
 * Uso (dentro de /api):  npx tsx scripts/adotar-produtos-orfaos.ts
 * É seguro rodar mais de uma vez (só age sobre quem ainda está sem base).
 */
import { PrismaClient } from "../generated/client";
import { gerarIdUnicoComMetaFinal } from "../app/helpers/generateUUID";

const prisma = new PrismaClient();

async function main() {
  const orfaos = await prisma.produto.findMany({
    where: { produtoBaseId: null },
    select: {
      id: true,
      contaId: true,
      nome: true,
      descricao: true,
      ncm: true,
      cest: true,
      cfop: true,
      origem: true,
      aliquotaIcms: true,
      aliquotaIpi: true,
      aliquotaPis: true,
      aliquotaCofins: true,
      codigoProduto: true,
      issAliquota: true,
    },
  });

  if (!orfaos.length) {
    console.log("Nenhum produto órfão encontrado. Nada a fazer.");
    return;
  }

  console.log(`Encontrados ${orfaos.length} produto(s) órfão(s). Adotando...`);
  let ok = 0;

  for (const p of orfaos) {
    try {
      await prisma.$transaction(async (tx) => {
        const base = await tx.produtoBase.create({
          data: {
            Uid: gerarIdUnicoComMetaFinal("PB"),
            contaId: p.contaId,
            nome: p.nome,
            descricao: p.descricao ?? undefined,
            ncm: p.ncm ?? undefined,
            cest: p.cest ?? undefined,
            cfop: p.cfop ?? undefined,
            origem: p.origem ?? undefined,
            aliquotaIcms: p.aliquotaIcms ?? undefined,
            aliquotaIpi: p.aliquotaIpi ?? undefined,
            aliquotaPis: p.aliquotaPis ?? undefined,
            aliquotaCofins: p.aliquotaCofins ?? undefined,
            codigoProduto: p.codigoProduto ?? undefined,
            issAliquota: p.issAliquota ?? undefined,
          },
        });
        await tx.produto.update({
          where: { id: p.id },
          data: { produtoBaseId: base.id, ehPadrao: true },
        });
      });
      ok++;
      console.log(`  ✓ Produto #${p.id} "${p.nome}" adotado.`);
    } catch (err) {
      console.error(`  ✗ Falha ao adotar o produto #${p.id}:`, err);
    }
  }

  console.log(`Concluído: ${ok}/${orfaos.length} adotado(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
