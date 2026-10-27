import { Prisma, PrismaClient } from "../../../generated";
import { criarProdutoBase } from "../../services/produtos/produtoCadastroService";
import { registrarReposicao, registrarDescarte } from "../../services/produtos/produtoEstoqueOperations";
import { executarUmaVez } from "../idempotencia";
import { ModoFacilError } from "../errors";
import { criarProdutoSchema, editarProdutoSchema, situacaoProdutoSchema, reposicaoSchema, descarteSchema } from "./schemas";
import { z } from "zod";

async function categoriaNome(tx: Prisma.TransactionClient, contaId: number, id: number | null) {
  if (id === null) return null;
  const row = await tx.produtoCategoria.findFirst({ where: { id, contaId }, select: { nome: true } });
  if (!row) throw new ModoFacilError(404, "category_not_found", "Categoria não encontrada nesta conta.");
  return row.nome;
}

export async function criarProduto(db: PrismaClient, contaId: number, input: unknown) {
  const { chaveOperacao, ...data } = criarProdutoSchema.parse(input);
  return executarUmaVez(db, contaId, chaveOperacao, { operacao: "criarProduto", ...data }, async tx => {
    await categoriaNome(tx, contaId, data.categoriaId);
    const produto = await criarProdutoBase(tx, contaId, {
      ...data,
      precoCompra: data.precoCompra ?? undefined,
      entradas: true, saidas: true, controlaEstoque: true,
    });
    return { produtoBaseId: produto.id, varianteId: produto.variantes[0].id, produto };
  });
}

// A closed field map: never copy a loaded product or a request object into data.
// Omitted values and explicit null retain distinct meanings.
export function basicPatch(data: z.output<typeof editarProdutoSchema>) {
  const base: Prisma.ProdutoBaseUncheckedUpdateManyInput = {};
  const common: Prisma.ProdutoUpdateManyMutationInput = {};
  const variante: Prisma.ProdutoUpdateManyMutationInput = {};
  if (data.nome !== undefined) base.nome = common.nome = data.nome;
  if (data.descricao !== undefined) base.descricao = common.descricao = data.descricao;
  if (data.categoriaId !== undefined) base.categoriaId = data.categoriaId;
  if (data.unidade !== undefined) variante.unidade = data.unidade;
  if (data.preco !== undefined) variante.preco = data.preco;
  if (data.precoCompra !== undefined) variante.precoCompra = data.precoCompra;
  if (data.minimo !== undefined) variante.minimo = data.minimo;
  return { base, common, variante };
}

export async function editarProduto(db: PrismaClient, contaId: number, produtoBaseId: number, varianteId: number, input: unknown) {
  const data = editarProdutoSchema.parse(input);
  return db.$transaction(async tx => {
    // Consistent base lock order also serializes edits to denormalized common
    // fields. Stock operations touch only stock; this write never overwrites it.
    await tx.$queryRaw`SELECT id FROM ProdutoBase WHERE id = ${produtoBaseId} AND contaId = ${contaId} FOR UPDATE`;
    const variant = await tx.produto.findFirst({ where: { id: varianteId, contaId, produtoBaseId }, select: { id: true } });
    if (!variant) throw new ModoFacilError(404, "product_not_found", "Produto/variante não encontrado nesta conta.");
    const patch = basicPatch(data);
    if (data.categoriaId !== undefined) patch.common.categoria = await categoriaNome(tx, contaId, data.categoriaId);
    if (Object.keys(patch.base).length) await tx.produtoBase.updateMany({ where: { id: produtoBaseId, contaId }, data: patch.base });
    if (Object.keys(patch.common).length) await tx.produto.updateMany({ where: { produtoBaseId, contaId }, data: patch.common });
    if (Object.keys(patch.variante).length) await tx.produto.updateMany({ where: { id: varianteId, produtoBaseId, contaId }, data: patch.variante });
    const produto = await tx.produtoBase.findFirstOrThrow({ where: { id: produtoBaseId, contaId }, include: { Categoria: true, variantes: { orderBy: [{ ehPadrao: "desc" }, { id: "asc" }] } } });
    return { produtoBaseId, varianteId, produto };
  });
}

export async function alterarSituacaoProduto(db: PrismaClient, contaId: number, produtoBaseId: number, input: unknown) {
  const { status } = situacaoProdutoSchema.parse(input);
  return db.$transaction(async tx => {
    // Same lock order as basic edits; only status changes, never stock/prices.
    await tx.$queryRaw`SELECT id FROM ProdutoBase WHERE id = ${produtoBaseId} AND contaId = ${contaId} FOR UPDATE`;
    const base = await tx.produtoBase.findFirst({ where: { id: produtoBaseId, contaId }, select: { id: true } });
    if (!base) throw new ModoFacilError(404, "product_not_found", "Produto não encontrado nesta conta.");
    await tx.produtoBase.updateMany({ where: { id: produtoBaseId, contaId }, data: { status } });
    // Product status is shared by its variants, as in syncVariantBaseFields.
    await tx.produto.updateMany({ where: { produtoBaseId, contaId }, data: { status } });
    return { id: produtoBaseId, status };
  });
}

export async function reporEstoque(db: PrismaClient, contaId: number, input: unknown) {
  const data = reposicaoSchema.parse(input);
  return db.$transaction(async tx => {
    if (data.fornecedor) {
      const supplier = await tx.clientesFornecedores.findFirst({ where: { id: data.fornecedor, contaId }, select: { id: true } });
      if (!supplier) throw new ModoFacilError(404, "supplier_not_found", "Fornecedor não encontrado nesta conta.");
    }
    return registrarReposicao(tx, contaId, data);
  });
}

export async function descartarEstoque(db: PrismaClient, contaId: number, input: unknown) {
  const data = descarteSchema.parse(input);
  return db.$transaction(tx => registrarDescarte(tx, contaId, data));
}
