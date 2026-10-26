import { z } from "zod";
import { Prisma } from "../../../generated";
import type { prisma } from "../../utils/prisma";
import { ProdutoSchema } from "../../schemas/produtos";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";

/**
 * Normaliza um trecho de texto para compor o SKU:
 * remove acentos, mantém apenas letras/números e converte para maiúsculas.
 */
function normalizarParteSku(texto: string | null | undefined, max: number): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, max);
}

type PrismaClientLike = Prisma.TransactionClient | typeof prisma;

/**
 * Gera um SKU único para a conta com base no nome do produto e da variante.
 * Ex.: "Camiseta Básica" + "Azul M" => "CAMISE-AZULM-4F7A".
 */
export async function gerarSkuUnico(
  client: PrismaClientLike,
  contaId: number,
  nome: string,
  nomeVariante?: string | null
): Promise<string> {
  const parteNome = normalizarParteSku(nome, 6);
  const parteVariante =
    nomeVariante && nomeVariante !== "Padrão"
      ? normalizarParteSku(nomeVariante, 4)
      : "";
  const prefixo = [parteNome, parteVariante].filter(Boolean).join("-") || "SKU";

  for (let tentativa = 0; tentativa < 25; tentativa++) {
    const sufixo = Math.random().toString(36).slice(2, 6).toUpperCase();
    const codigo = `${prefixo}-${sufixo}`;
    const existente = await client.produto.findFirst({
      where: { contaId, codigo },
      select: { id: true },
    });
    if (!existente) return codigo;
  }

  return `${prefixo}-${Date.now().toString(36).toUpperCase()}`;
}


// Shared by Normal and Fácil; callers own input validation.
export async function criarProdutoBase(
  tx: Prisma.TransactionClient,
  contaId: number,
  data: z.output<typeof ProdutoSchema>,
  fiscalData: Partial<Pick<Prisma.ProdutoUncheckedCreateInput, "ncm" | "cest" | "cfop" | "origem" | "codigoProduto" | "ean" | "tipoItem" | "icmsCsosn" | "icmsCst" | "icmsModBcSt" | "icmsMva" | "icmsReducaoBcSt" | "icmsAliquotaSt" | "fcpAliquota" | "fcpStAliquota" | "icmsDesoneradoValor" | "icmsDesoneradoMotivo" | "icmsCreditoAliquota" | "ipiCst" | "ipiCodigoEnquadramento" | "difalAliquotaInterna" | "difalFcpAliquota" | "pisCst" | "cofinsCst" | "aliquotaIcms" | "aliquotaIpi" | "aliquotaPis" | "aliquotaCofins" | "issAliquota">> = {},
) {
      const categoriaNome = await getCategoriaNome(
        tx,
        contaId,
        data.categoriaId
      );

      const produtoBase = await tx.produtoBase.create({
        data: {
          Uid: gerarIdUnicoComMetaFinal("PB"),
          contaId: contaId,
          nome: data.nome,
          descricao: data.descricao,
          categoriaId: data.categoriaId ?? null,
          ...fiscalData,
        },
      });

      const codigoFinal =
        data.codigo?.trim() ||
        (await gerarSkuUnico(
          tx,
          contaId,
          data.nome,
          data.nomeVariante
        ));

      await tx.produto.create({
        data: {
          Uid: gerarIdUnicoComMetaFinal("PRO"),
          contaId: contaId,
          produtoBaseId: produtoBase.id,
          estoque: data.estoque as number,
          nome: data.nome,
          nomeVariante: data.nomeVariante || "Padrão",
          ehPadrao: true,
          preco: data.preco as number,
          descricao: data.descricao,
          precoCompra: data.precoCompra,
          unidade: data.unidade,
          codigo: codigoFinal,
          minimo: data.minimo as number,
          entradas: data.entradas,
          saidas: data.saidas,
          controlaEstoque: data.controlaEstoque,
          producaoLocal: data.producaoLocal,
          mostrarNoPdv: data.mostrarNoPdv,
          mostrarNoCatalogo: data.mostrarNoCatalogo ?? undefined,
          materiaPrima: data.materiaPrima,
          custoMedioProducao: data.custoMedioProducao,
          categoria: categoriaNome,
          ...fiscalData,
        },
      });

      return tx.produtoBase.findUniqueOrThrow({
        where: { id: produtoBase.id },
        include: { Categoria: true, variantes: { orderBy: [{ ehPadrao: "desc" }, { id: "asc" }] } },
      });
}

export async function getCategoriaNome(
  tx: Prisma.TransactionClient,
  contaId: number,
  categoriaId?: number | null
) {
  if (!categoriaId) return null;
  const categoria = await tx.produtoCategoria.findFirst({
    where: { id: categoriaId, contaId },
    select: { nome: true },
  });
  return categoria?.nome ?? null;
}


export async function criarProdutoVariante(
 tx: Prisma.TransactionClient, contaId: number,
 data: z.output<typeof ProdutoSchema> & { produtoBaseId: number },
 fiscalData: Parameters<typeof criarProdutoBase>[3] = {},
) {
      const base = await tx.produtoBase.findFirst({
        where: {
          id: data.produtoBaseId,
          contaId: contaId,
        },
        include: {
          Categoria: true,
        },
      });

      if (!base) {
        throw new Error("Produto base não encontrado");
      }

      const categoriaNome = base.Categoria?.nome ?? null;
      const codigoFinal =
        data.codigo?.trim() ||
        (await gerarSkuUnico(
          tx,
          contaId,
          base.nome,
          data.nomeVariante
        ));

      return tx.produto.create({
        data: {
          Uid: gerarIdUnicoComMetaFinal("PRO"),
          contaId: contaId,
          produtoBaseId: base.id,
          nome: base.nome,
          descricao: base.descricao,
          status: base.status,
          categoria: categoriaNome,
          nomeVariante: data.nomeVariante || "Padrão",
          preco: data.preco || 0,
          precoPromocional: data.precoPromocional ?? null,
          precoCompra: data.precoCompra,
          entradas: data.entradas,
          saidas: data.saidas,
          unidade: data.unidade,
          estoque: data.estoque || 0,
          minimo: data.minimo || 0,
          codigo: codigoFinal,
          controlaEstoque: data.controlaEstoque,
          producaoLocal: data.producaoLocal,
          mostrarNoPdv: data.mostrarNoPdv,
          mostrarNoCatalogo: data.mostrarNoCatalogo ?? undefined,
          materiaPrima: data.materiaPrima,
          custoMedioProducao: data.custoMedioProducao,
          ehPadrao: false,
          ...fiscalData,
        },
      });
}
