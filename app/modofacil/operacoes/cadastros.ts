import type { Prisma, PrismaClient } from "../../../generated";
import Decimal from "decimal.js";
import { criarProdutoVariante } from "../../services/produtos/produtoCadastroService";
import { registrarReposicaoLote } from "../../services/produtos/produtoEstoqueOperations";
import { executarUmaVez } from "../idempotencia";
import { ModoFacilError } from "../errors";
import { baseAvancadoSchema, varianteAvancadoSchema, criarVarianteSchema, loteSchema, pessoaAvancadoSchema, servicoAvancadoSchema, servicoBasicoSchema, contaPatchSchema, parametrosSchema, parametrosFields, empresaSchema } from "./schemas";
import { updateContaSchema } from "../../schemas/contas";

export async function criarVariante(db: PrismaClient, contaId: number, produtoBaseId: number, input: unknown) {
  const { chaveOperacao, ...data } = criarVarianteSchema.parse(input);
  return executarUmaVez(db, contaId, chaveOperacao, { operacao: "criarVariante", produtoBaseId, ...data }, async tx => {
    const base = await tx.produtoBase.findFirst({ where: { id: produtoBaseId, contaId }, select: { id: true, nome: true } });
    if (!base) throw new ModoFacilError(404, "product_not_found", "Produto base não encontrado.");
    const variante = await criarProdutoVariante(tx, contaId, { ...data, produtoBaseId, nome: base.nome, precoCompra: data.precoCompra ?? undefined, controlaEstoque: true, entradas: true, saidas: true });
    return { produtoBaseId, varianteId: variante.id, variante };
  });
}

export async function reporLote(db: PrismaClient, contaId: number, input: unknown) {
  const { chaveOperacao, ...data } = loteSchema.parse(input);
  return executarUmaVez(db, contaId, chaveOperacao, { operacao: "reporLote", ...data }, async tx => {
    if (data.fornecedor && !(await tx.clientesFornecedores.findFirst({ where: { id: data.fornecedor, contaId }, select: { id: true } }))) throw new ModoFacilError(404, "supplier_not_found", "Fornecedor não encontrado.");
    const rows = await registrarReposicaoLote(tx, contaId, { ...data, ...(data.data ? { data: new Date(data.data) } : { data: undefined }) });
    return { totalItens: rows.length, totalUnidades: rows.reduce((sum, item) => sum.plus(item.movimentacao.quantidade), new Decimal(0)).toNumber(), movimentacoes: rows.map(item => ({ ...item.movimentacao, Produto: item.produto })) };
  });
}

export async function editarAvancado(db: PrismaClient, contaId: number, produtoBaseId: number, varianteId: number | null, input: unknown) {
  const data = varianteId === null ? baseAvancadoSchema.parse(input) : varianteAvancadoSchema.parse(input);
  return db.$transaction(async tx => {
    const base = await tx.produtoBase.findFirst({ where: { id: produtoBaseId, contaId }, select: { id: true } });
    if (!base) throw new ModoFacilError(404, "product_not_found", "Produto base não encontrado.");
    const result = varianteId === null
      ? await tx.produtoBase.updateMany({ where: { id: produtoBaseId, contaId }, data })
      : await tx.produto.updateMany({ where: { id: varianteId, produtoBaseId, contaId }, data });
    if (result.count !== 1) throw new ModoFacilError(404, "product_not_found", "Variante não encontrada neste produto.");
    return { produtoBaseId, varianteId };
  });
}

export async function editarPessoaAvancado(db: PrismaClient, contaId: number, id: number, input: unknown) {
  const data = pessoaAvancadoSchema.parse(input);
  const result = await db.clientesFornecedores.updateMany({ where: { id, contaId }, data });
  if (!result.count) throw new ModoFacilError(404, "person_not_found", "Pessoa não encontrada.");
  return db.clientesFornecedores.findFirst({ where: { id, contaId } });
}

export async function editarServicoAvancado(db: PrismaClient, contaId: number, id: number, input: unknown) {
  const data = servicoAvancadoSchema.parse(input);
  const result = await db.servicos.updateMany({ where: { id, contaId }, data });
  if (!result.count) throw new ModoFacilError(404, "service_not_found", "Serviço não encontrado.");
  return db.servicos.findFirst({ where: { id, contaId } });
}

export async function editarServicoBasico(db: PrismaClient, contaId: number, id: number, input: unknown) {
  const data = servicoBasicoSchema.parse(input);
  const result = await db.servicos.updateMany({ where: { id, contaId }, data });
  if (!result.count) throw new ModoFacilError(404, "service_not_found", "Serviço não encontrado.");
  return db.servicos.findFirst({ where: { id, contaId } });
}

export async function editarContaFinanceira(db: PrismaClient, contaId: number, id: number, input: unknown) {
  const data = contaPatchSchema.parse(input);
  const result = await db.contasFinanceiro.updateMany({ where: { id, contaId }, data });
  if (!result.count) throw new ModoFacilError(404, "account_not_found", "Conta financeira não encontrada.");
  return db.contasFinanceiro.findFirst({ where: { id, contaId } });
}

// This projection is intentionally separate from the legacy parameters DTO,
// which contains gateway keys/tokens and triggers webhook synchronization.
export const parametrosSelect = Object.fromEntries(Object.keys(parametrosFields).map(key => [key, true])) as { [K in keyof typeof parametrosFields]: true };
export async function getParametrosOperacionais(db: Pick<PrismaClient, "parametrosConta">, contaId: number) {
  return await db.parametrosConta.findUnique({ where: { contaId }, select: parametrosSelect }) ?? {
    contaFinanceiraPadraoId: null, vendaLancamentoAutomatico: false, vendaCategoriaFinanceiraId: null, vendaContaFinanceiraId: null,
    osLancamentoAutomatico: false, osCategoriaFinanceiraId: null, osContaFinanceiraId: null, osOcultarAssinatura: false, modeloPdv: "BASICO",
    permitirLancamentoRetroativo: true, permitirEfetivacaoFutura: true, permitirTransferenciaContaFinanceira: true, permitirCriacaoCobranca: true,
    eventoVendaConcluida: true, eventoProdutoAlterado: true, eventoEstoqueBaixo: true, eventoSangria: false,
  };
}
export async function editarParametrosOperacionais(db: PrismaClient, contaId: number, input: unknown) {
  const data = parametrosSchema.parse(input);
  return db.$transaction(async tx => {
    for (const key of ["contaFinanceiraPadraoId", "vendaContaFinanceiraId", "osContaFinanceiraId"] as const) {
      const id = data[key];
      if (id && !(await tx.contasFinanceiro.findFirst({ where: { id, contaId }, select: { id: true } }))) throw new ModoFacilError(404, "account_not_found", "Conta financeira de outra conta ou inexistente.");
    }
    for (const key of ["vendaCategoriaFinanceiraId", "osCategoriaFinanceiraId"] as const) {
      const id = data[key];
      if (id && !(await tx.categoriaFinanceiro.findFirst({ where: { id, contaId }, select: { id: true } }))) throw new ModoFacilError(404, "category_not_found", "Categoria financeira de outra conta ou inexistente.");
    }
    await tx.parametrosConta.upsert({ where: { contaId }, create: { contaId, ...data }, update: data, select: { contaId: true } });
    return tx.parametrosConta.findUnique({ where: { contaId }, select: parametrosSelect });
  });
}

const empresaSelect = Object.fromEntries(["id", "profile", ...Object.keys(updateContaSchema.shape)].map(key => [key, true])) as Prisma.ContasSelect;
export async function getEmpresa(db: Pick<PrismaClient, "contas">, contaId: number) {
  const data = await db.contas.findUnique({ where: { id: contaId }, select: empresaSelect });
  if (!data) throw new ModoFacilError(404, "account_not_found", "Conta não encontrada.");
  return data;
}
export async function editarEmpresa(db: Pick<PrismaClient, "contas">, contaId: number, input: unknown) {
  const data = empresaSchema.parse(input);
  return db.contas.update({ where: { id: contaId }, data, select: empresaSelect });
}
