import { z } from "zod";
import { decimalField, money, quantity } from "../produtos/schemas";
import { validarCpfCnpj } from "../../helpers/formatters";
import { updateContaSchema } from "../../schemas/contas";

export const idSchema = z.number().int().positive();
export const dateSchema = z.string().datetime({ offset: true });
export const nonempty = z.string().trim().min(1).max(191);
const text = z.string().max(191).nullable();
const notEmpty = (data: object) => Object.keys(data).length > 0;
export const servicoFields = { nome: z.string().trim().min(2).max(191), preco: money.refine(n => n > 0, "O contrato atual exige preço maior que zero."), descricao: text.optional() };
export const servicoBasicoSchema = z.object(servicoFields).partial().strict().refine(notEmpty, "Informe campos para alterar.");
export const fiscalFields = {
  ncm: text, cest: text, cfop: text, origem: z.number().int().min(0).max(8).nullable(),
  codigoProduto: text, ean: z.string().max(14).nullable(), tipoItem: z.string().max(2).nullable(),
  icmsCsosn: z.string().max(3).nullable(), icmsCst: z.string().max(3).nullable(),
  pisCst: z.string().max(2).nullable(), cofinsCst: z.string().max(2).nullable(),
  icmsModBcSt: z.string().max(1).nullable(), icmsMva: decimalField(4, 3).nullable(),
  icmsReducaoBcSt: decimalField(4, 3).nullable(), icmsAliquotaSt: decimalField(4, 3).nullable(),
  fcpAliquota: decimalField(4, 3).nullable(), fcpStAliquota: decimalField(4, 3).nullable(),
  icmsDesoneradoValor: decimalField(2, 10).nullable(), icmsDesoneradoMotivo: z.string().max(2).nullable(),
  icmsCreditoAliquota: decimalField(4, 3).nullable(), ipiCst: z.string().max(2).nullable(),
  ipiCodigoEnquadramento: z.string().max(3).nullable(), difalAliquotaInterna: decimalField(4, 3).nullable(),
  difalFcpAliquota: decimalField(4, 3).nullable(),
  aliquotaIcms: decimalField(2, 3).nullable(), aliquotaIpi: decimalField(2, 3).nullable(),
  aliquotaPis: decimalField(2, 3).nullable(), aliquotaCofins: decimalField(2, 3).nullable(), issAliquota: decimalField(2, 3).nullable(),
};
export const baseAvancadoSchema = z.object(fiscalFields).partial().strict().refine(notEmpty, "Informe campos para alterar.");
export const varianteAvancadoSchema = z.object({
  ...fiscalFields, nomeVariante: nonempty, codigo: text, precoPromocional: money.nullable(),
  entradas: z.boolean(), saidas: z.boolean(), controlaEstoque: z.boolean(), producaoLocal: z.boolean(),
  mostrarNoPdv: z.boolean(), mostrarNoCatalogo: z.boolean(), materiaPrima: z.boolean(), custoMedioProducao: money.nullable(),
}).partial().strict().refine(notEmpty, "Informe campos para alterar.");
export const criarVarianteSchema = z.object({
  chaveOperacao: z.string().uuid(), nomeVariante: nonempty,
  unidade: nonempty, preco: money, precoCompra: money.nullable().default(null),
  estoque: quantity, minimo: quantity,
}).strict();
export const loteSchema = z.object({
  chaveOperacao: z.string().uuid(), data: dateSchema.optional(), fornecedor: idSchema.nullable().optional(),
  notaFiscal: text.optional(), frete: money.optional(), desconto: money.optional(),
  itens: z.array(z.object({ produtoId: idSchema, quantidade: decimalField(3, 9, true), custo: money }).strict()).min(1).max(200),
}).strict();

const itemVenda = z.object({ id: idSchema, tipo: z.enum(["PRODUTO", "SERVICO", "COMBO"]), nome: z.string().max(191).optional(), preco: money, quantidade: z.number().int().positive() }).strict();
const itemOs = z.object({ id: idSchema, tipo: z.enum(["PRODUTO", "SERVICO", "COMBO"]), nome: nonempty, valor: money, quantidade: z.number().int().positive() }).strict();
const revision = z.string().regex(/^[a-f0-9]{64}$/);
export const vendaPatchSchema = z.object({
  revisao: revision, data: dateSchema.optional(), clienteId: idSchema.nullable().optional(),
  vendedorId: idSchema.nullable().optional(), observacoes: z.string().max(65535).nullable().optional(),
  garantia: z.number().int().min(0).nullable().optional(), desconto: money.optional(),
  status: z.enum(["ORCAMENTO", "ANDAMENTO", "FINALIZADO", "PENDENTE", "CANCELADO"]).optional(),
  itens: z.array(itemVenda).min(1).max(200).optional(),
}).strict().refine(data => Object.keys(data).length > 1, "Informe campos para alterar.");
export const ordemPatchSchema = z.object({
  revisao: revision, data: dateSchema.optional(), clienteId: idSchema.optional(),
  vendedorId: idSchema.optional(), descricao: text.optional(), descricaoCliente: text.optional(),
  garantia: z.number().int().min(0).optional(), desconto: money.optional(),
  status: z.enum(["ABERTA", "ORCAMENTO", "APROVADA", "ANDAMENTO", "CANCELADA"]).optional(),
  itens: z.array(itemOs).min(1).max(200).optional(),
}).strict().refine(data => Object.keys(data).length > 1, "Informe campos para alterar.");

export const pessoaAvancadoSchema = z.object({
  documento: z.string().refine(s => s.trim() === "" || /\d/.test(s), "CPF/CNPJ inválido.").transform(s => s.replace(/\D/g, "")).refine(s => s === "" || validarCpfCnpj(s), "CPF/CNPJ inválido.").nullable(),
  cep: z.string().refine(s => s.trim() === "" || /\d/.test(s), "CEP inválido.").transform(s => s.replace(/\D/g, "")).refine(s => s === "" || s.length === 8, "CEP inválido.").nullable(),
  endereco: text, bairro: text, numero: text, cidade: text, estado: z.string().max(2).nullable(),
  ie: text, im: text, municipio: text, observacaos: text,
  tipo: z.enum(["CLIENTE", "FORNECEDOR"]), status: z.enum(["ATIVO", "INATIVO", "BLOQUEADO"]),
}).partial().strict().refine(notEmpty, "Informe campos para alterar.");
export const servicoAvancadoSchema = z.object({
  ncm: text, cest: text, cfop: text, origem: fiscalFields.origem,
  aliquotaIcms: fiscalFields.aliquotaIcms, aliquotaIpi: fiscalFields.aliquotaIpi,
  aliquotaPis: fiscalFields.aliquotaPis, aliquotaCofins: fiscalFields.aliquotaCofins,
  codigoProduto: text, issAliquota: fiscalFields.issAliquota, status: z.boolean(),
}).partial().strict().refine(notEmpty, "Informe campos para alterar.");

export const metodoFinanceiro = z.enum(["DINHEIRO", "DEBITO", "CREDITO", "BOLETO", "DEPOSITO", "TRANSFERENCIA", "CHEQUE", "PIX"]);
export const recorrenciaSchema = z.object({
  frequencia: z.enum(["DIARIO", "SEMANAL", "QUINZENAL", "MENSAL", "TRIMESTRAL", "SEMESTRAL", "ANUAL", "PERSONALIZADO"]),
  intervaloDias: z.number().int().positive().nullable(), dataInicio: dateSchema, dataFim: dateSchema.nullable(),
  minimoGerado: z.number().int().min(1).max(24), maximoEmAberto: z.number().int().min(1).max(60),
  geracaoAutomatica: z.boolean(), diasAntecedencia: z.number().int().min(0).max(365), valorParcela: money.refine(n => n > 0),
}).strict();
export const pagamentoSchema = z.object({
  metodoPagamento: metodoFinanceiro, dataPagamento: dateSchema,
  contaPagamento: idSchema.nullable().optional(), valorRecebido: money.refine(n => n > 0).optional(),
  criarSaldoPendente: z.boolean().optional(), novoVencimento: dateSchema.optional(),
}).strict().refine(data => !data.criarSaldoPendente || !!data.novoVencimento, "Informe o vencimento do saldo pendente.");
export const parcelaSchema = z.object({ valor: money.refine(n => n > 0), vencimento: dateSchema,
  descricao: text.optional(), contaFinanceira: idSchema.nullable().optional(), formaPagamento: metodoFinanceiro.nullable().optional(),
}).strict();
export const parcelaAtualizacaoSchema = z.object({ valor: money.refine(n => n > 0), vencimento: dateSchema,
  escopo: z.enum(["ATUAL", "TODAS", "PENDENTES", "PAGAS", "ATUAL_EM_DIANTE", "ATUAL_PARA_TRAS"]).default("ATUAL"),
}).strict();
export const contaSchema = z.object({ nome: nonempty, saldoInicial: decimalField(2, 10, false, true), corDestaque: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable() }).strict();
export const contaPatchSchema = contaSchema.pick({ nome: true, corDestaque: true }).partial().strict().refine(notEmpty, "Informe campos para alterar.");
export const categoriaSchema = z.object({ id: idSchema.optional(), nome: nonempty, categoriaPai: idSchema.nullable() }).strict();
export const moverCategoriaSchema = z.object({ parentId: idSchema.nullable() }).strict();
const filtrosTransferencia = z.object({ inicio: dateSchema.optional(), fim: dateSchema.optional(), status: z.enum(["TODOS", "PAGO", "PENDENTE", "ATRASADO"]).optional(), tipo: z.enum(["TODOS", "RECEITA", "DESPESA"]).optional(), categoriaId: idSchema.optional(), clienteId: idSchema.optional(), search: z.string().max(191).optional() }).strict();
export const transferenciaSchema = z.discriminatedUnion("modo", [
  z.object({ modo: z.literal("GERAR_FINANCEIRO"), contaOrigemId: idSchema, contaDestinoId: idSchema, valor: money.refine(n => n > 0), data: dateSchema, descricao: nonempty }).strict(),
  z.object({ modo: z.literal("MOVER_LANCAMENTOS"), contaOrigemId: idSchema, contaDestinoId: idSchema, filtros: filtrosTransferencia }).strict(),
]);
export const transferenciaPreviewSchema = z.object({ contaOrigemId: idSchema, filtros: filtrosTransferencia }).strict();
export const cobrancaSchema = z.object({ type: z.enum(["PIX", "BOLETO", "LINK"]), value: money.refine(n => n > 0), gateway: z.literal("mercadopago"), clienteId: idSchema.optional(), vinculo: z.object({ id: idSchema, tipo: z.enum(["parcela", "venda", "os"]) }).strict() }).strict();
export const cobrancaAcaoSchema = z.object({ cobrancaId: idSchema }).strict();
export const ajusteSaldoSchema = z.object({ contaFinanceiraId: idSchema, modo: z.enum(["AJUSTE_INTERNO", "LANCAR_FINANCEIRO"]), saldoInformado: decimalField(2, 10), data: dateSchema, descricao: nonempty }).strict();
export const empresaSchema = updateContaSchema.partial().strict().refine(notEmpty, "Informe campos para alterar.");

export const parametrosFields = {
  contaFinanceiraPadraoId: idSchema.nullable(), vendaLancamentoAutomatico: z.boolean(),
  vendaCategoriaFinanceiraId: idSchema.nullable(), vendaContaFinanceiraId: idSchema.nullable(),
  osLancamentoAutomatico: z.boolean(), osCategoriaFinanceiraId: idSchema.nullable(), osContaFinanceiraId: idSchema.nullable(),
  osOcultarAssinatura: z.boolean(), modeloPdv: z.enum(["BASICO", "PRO"]),
  permitirLancamentoRetroativo: z.boolean(), permitirEfetivacaoFutura: z.boolean(), permitirTransferenciaContaFinanceira: z.boolean(), permitirCriacaoCobranca: z.boolean(),
  eventoVendaConcluida: z.boolean(), eventoProdutoAlterado: z.boolean(), eventoEstoqueBaixo: z.boolean(), eventoSangria: z.boolean(),
};
export const parametrosSchema = z.object(parametrosFields).partial().strict().refine(notEmpty, "Informe campos para alterar.");
