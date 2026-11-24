import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import qrcode from "qrcode";
import type { MetodoPagamento, Prisma } from "../../../generated";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import { sendFinanceiroUpdated } from "../../hooks/financeiro/socket";
import { AppRequirementError } from "../../utils/appRequirementError";
import { env } from "../../utils/dotenv";
import { prisma } from "../../utils/prisma";
import { QrCodePix } from "../qrcodeGenerator";
import { getTenantMercadoPagoService } from "../financeiro/tenantMercadoPagoService";
import { correspondeAoPagamento, cotarParcela, cronograma, dataFinanceira, diaLocal, fimDiaFinanceiro, inicioDiaFinanceiro, limiteCotacao, referenciaGateway, resumirClientePublico, tipoComprovante } from "./policy";
import { valorMaximoPagamento, type AbrirPagamento, type BaixaEmprestimo, type ConfigEmprestimo, type ConfirmacaoEmprestimo, type CotacaoBaixa, type CriarEmprestimo, type FiltrosTabelaEmprestimos } from "./schemas";

const configPadrao = { pixManual: false, mercadoPago: false, descontoJurosBps: 0 };
const parcelasOrdenadas = { orderBy: { numero: "asc" } } as const;
const ativoSelect = {
  id: true, metodo: true, status: true, itens: true, totalCentavos: true, pixCopiaCola: true,
  expiraEm: true, criadoEm: true, gatewayId: true, gatewaySituacao: true,
  comprovante: { select: { enviadoEm: true } },
} satisfies Prisma.EmprestimoPagamentoSelect;
type Quote = ReturnType<typeof cotarParcela>;
type Pagamento = Prisma.EmprestimoPagamentoGetPayload<Record<never, never>>;
type Emprestimo = Prisma.EmprestimoGetPayload<Record<never, never>>;
type Gateway = Awaited<ReturnType<typeof getTenantMercadoPagoService>>;
type RespostaGateway = Awaited<ReturnType<Gateway["payment"]["get"]>>;

function erro(message: string, status = 422): never {
  throw new AppRequirementError(message, "emprestimo_operacao", status);
}

async function dadosRecebimento(contaId: number) {
  const [config, conta] = await Promise.all([
    prisma.emprestimoConfiguracao.findUnique({ where: { contaId } }),
    prisma.contas.findUniqueOrThrow({
      where: { id: contaId },
      select: {
        nome: true, nomeFantasia: true, profile: true,
        ParametrosConta: { select: { chavePix: true, MercadoPagoApiKey: true }, take: 1 },
        MercadoPagoOAuth: { select: { id: true } },
        NotaFiscalConfiguracao: { select: { municipioNome: true } },
      },
    }),
  ]);
  return {
    config: config ?? configPadrao,
    nome: conta.nomeFantasia?.trim() || conta.nome.trim(),
    profile: conta.profile?.trim() || null,
    cidade: conta.NotaFiscalConfiguracao?.municipioNome || "SAO PAULO",
    chavePix: conta.ParametrosConta[0]?.chavePix?.trim() || null,
    gatewayDisponivel: !!(conta.MercadoPagoOAuth || conta.ParametrosConta[0]?.MercadoPagoApiKey),
  };
}

export async function lerConfig(contaId: number) {
  const { config, chavePix, gatewayDisponivel } = await dadosRecebimento(contaId);
  return { ...config, pixDisponivel: !!chavePix, gatewayDisponivel };
}

export async function salvarConfig(contaId: number, config: ConfigEmprestimo) {
  await prisma.emprestimoConfiguracao.upsert({
    where: { contaId }, update: config, create: { contaId, ...config },
  });
  return lerConfig(contaId);
}

async function validarContaCategoria(tx: Prisma.TransactionClient, contaId: number, contas: number[], categoriaId: number | null) {
  for (const id of new Set(contas)) {
    if (!(await tx.contasFinanceiro.findFirst({ where: { id, contaId }, select: { id: true } }))) {
      erro("Conta financeira inválida.");
    }
  }
  if (categoriaId && !(await tx.categoriaFinanceiro.findFirst({ where: { id: categoriaId, contaId }, select: { id: true } }))) {
    erro("Categoria financeira inválida.");
  }
}

async function lancar(
  tx: Prisma.TransactionClient, data: {
    contaId: number; clienteId: number; descricao: string; tipo: "RECEITA" | "DESPESA";
    valorCentavos: number; brutoCentavos?: number; data: Date; forma: MetodoPagamento;
    contaFinanceira: number; categoriaId: number;
  },
) {
  const valor = data.valorCentavos / 100;
  const brutoCentavos = data.brutoCentavos ?? data.valorCentavos;
  return tx.lancamentoFinanceiro.create({
    data: {
      Uid: gerarIdUnicoComMetaFinal("FIN"), origemSistema: "EMPRESTIMO", status: "PAGO",
      contaId: data.contaId, clienteId: data.clienteId, descricao: data.descricao, tipo: data.tipo,
      valorTotal: valor, valorBruto: brutoCentavos / 100, valorEntrada: 0, desconto: (brutoCentavos - data.valorCentavos) / 100,
      dataLancamento: data.data, formaPagamento: data.forma, categoriaId: data.categoriaId,
      contasFinanceiroId: data.contaFinanceira,
      parcelas: { create: {
        Uid: gerarIdUnicoComMetaFinal("PAR"), numero: 1, valor, vencimento: data.data,
        pago: true, valorPago: valor, dataPagamento: data.data, formaPagamento: data.forma,
        contaFinanceira: data.contaFinanceira,
      } },
    },
    select: { id: true },
  });
}

export async function criarEmprestimo(contaId: number, input: CriarEmprestimo) {
  if (input.dataSaida > diaLocal()) erro("A data da saída deve ser hoje ou anterior.");
  let resultado;
  try {
    resultado = await prisma.$transaction(async (tx) => {
      const where = { contaId_chaveOperacao: { contaId, chaveOperacao: input.chaveOperacao } };
      const existente = await tx.emprestimo.findUnique({ where, select: { id: true } });
      if (existente) return { ...existente, financeiro: false };
      const cliente = await tx.clientesFornecedores.findFirst({
        where: { id: input.clienteId, contaId, tipo: "CLIENTE", status: "ATIVO" }, select: { id: true },
      });
      if (!cliente) erro("Selecione um cliente ativo desta conta.");
      const contas = [input.contaSaidaId, input.contaEntradaId].filter((id): id is number => id !== null);
      await validarContaCategoria(tx, contaId, contas, input.categoriaId);
      const config = input.descontoJurosBps == null
        ? await tx.emprestimoConfiguracao.findUnique({ where: { contaId }, select: { descontoJurosBps: true } })
        : null;
      const dataSaida = dataFinanceira(input.dataSaida);
      const { principalCentavos, jurosBps, jurosMoraBps = 0, multaBps = 0, descontoFixoCentavos = 0 } = input;
      const itens = cronograma(principalCentavos, jurosBps, input.numeroParcelas, input.primeiroVencimento, descontoFixoCentavos);
      const emprestimo = await tx.emprestimo.create({
        data: {
          contaId, clienteId: cliente.id, chaveOperacao: input.chaveOperacao,
          tokenPublico: randomBytes(32).toString("hex"), principalCentavos,
          jurosBps, jurosMoraBps, multaBps, descontoFixoCentavos,
          descontoJurosBps: input.descontoJurosBps ?? config?.descontoJurosBps ?? 0,
          dataSaida, formaSaida: input.formaSaida, contaSaidaId: input.contaSaidaId,
          contaEntradaId: input.contaEntradaId, categoriaId: input.categoriaId,
          lancamentoAutomatico: input.lancamentoAutomatico, parcelas: { create: itens },
        },
        select: { id: true },
      });
      if (input.contaSaidaId && input.categoriaId) {
        const saida = await lancar(tx, {
          contaId, clienteId: cliente.id, descricao: `Saída do empréstimo #${emprestimo.id}`,
          tipo: "DESPESA", valorCentavos: input.principalCentavos, data: dataSaida,
          forma: input.formaSaida, contaFinanceira: input.contaSaidaId, categoriaId: input.categoriaId,
        });
        await tx.emprestimo.update({ where: { id: emprestimo.id }, data: { lancamentoSaidaId: saida.id } });
      }
      return { id: emprestimo.id, financeiro: !!input.contaSaidaId };
    });
  } catch (error) {
    // Uma requisição paralela com a mesma chave pode ter concluído o cadastro.
    if ((error as { code?: string }).code !== "P2002") throw error;
    const existente = await prisma.emprestimo.findUnique({
      where: { contaId_chaveOperacao: { contaId, chaveOperacao: input.chaveOperacao } }, select: { id: true },
    });
    if (!existente) throw error;
    return existente;
  }
  if (resultado.financeiro) sendFinanceiroUpdated(contaId);
  return { id: resultado.id };
}

const resumoSelect = {
  id: true, dataSaida: true, principalCentavos: true, cliente: { select: { id: true, nome: true } },
  parcelas: {
    ...parcelasOrdenadas,
    select: {
      principalCentavos: true, jurosCentavos: true, descontoFixoCentavos: true,
      recebidoCentavos: true, recebidoEm: true, vencimento: true,
    },
  },
  pagamentos: { where: { status: "EM_ANALISE" }, select: { id: true }, take: 1 },
} satisfies Prisma.EmprestimoSelect;

function situacaoEmprestimo(comprovanteEmAnalise: boolean, proximoVencimento: Date | null, inicioHoje: Date) {
  if (comprovanteEmAnalise) return "COMPROVANTE_EM_ANALISE";
  if (!proximoVencimento) return "QUITADO";
  return proximoVencimento < inicioHoje ? "EM_ATRASO" : "EM_ANDAMENTO";
}

function resumirEmprestimo(
  { parcelas, pagamentos, ...item }: Prisma.EmprestimoGetPayload<{ select: typeof resumoSelect }>,
  inicioHoje: Date,
) {
  const proximoVencimento = parcelas.find((p) => !p.recebidoEm)?.vencimento ?? null;
  const comprovanteEmAnalise = pagamentos.length > 0;
  return {
    ...item, totalCentavos: parcelas.reduce((total, p) => total + p.principalCentavos + p.jurosCentavos - p.descontoFixoCentavos, 0),
    recebidoCentavos: parcelas.reduce((total, p) => total + (p.recebidoCentavos ?? 0), 0),
    parcelas: parcelas.length, pagas: parcelas.filter((p) => p.recebidoEm).length,
    proximoVencimento, comprovanteEmAnalise,
    situacao: situacaoEmprestimo(comprovanteEmAnalise, proximoVencimento, inicioHoje),
  };
}

function filtrarEmprestimos(contaId: number, busca: string): Prisma.EmprestimoWhereInput {
  const numero = /^#?\d{1,10}$/.test(busca) ? Number(busca.replace(/^#/, "")) : 0;
  return {
    contaId,
    ...(busca && { OR: [
      { cliente: { nome: { contains: busca } } },
      ...(numero > 0 && numero <= 2_147_483_647 ? [{ id: numero }] : []),
    ] }),
  };
}

export async function listarEmprestimos(contaId: number, busca: string, cursor?: number) {
  const inicioHoje = inicioDiaFinanceiro(diaLocal());
  const registros = await prisma.emprestimo.findMany({
    where: { ...filtrarEmprestimos(contaId, busca), ...(cursor && { id: { lt: cursor } }) },
    orderBy: { id: "desc" }, take: 31, select: resumoSelect,
  });
  const emprestimos = registros.slice(0, 30).map((registro) => resumirEmprestimo(registro, inicioHoje));
  return { emprestimos, proximoCursor: registros.length > 30 ? emprestimos.at(-1)!.id : null };
}

export async function tabelaEmprestimos(
  contaId: number, params: {
    busca: string; page: number; pageSize: number; sortBy: unknown; order: Prisma.SortOrder;
  } & FiltrosTabelaEmprestimos,
) {
  const { busca, page, pageSize, sortBy, order, situacao, inicioVencimento, fimVencimento } = params;
  const inicioHoje = inicioDiaFinanceiro(diaLocal());
  const where = filtrarEmprestimos(contaId, busca);
  const pendente = { recebidoEm: null } satisfies Prisma.EmprestimoParcelaWhereInput;
  const atrasada = { ...pendente, vencimento: { lt: inicioHoje } };
  const comprovante = { status: "EM_ANALISE" } as const;
  const condicoes: Prisma.EmprestimoWhereInput[] = [];

  if (situacao === "COMPROVANTE_EM_ANALISE") {
    condicoes.push({ pagamentos: { some: comprovante } });
  } else if (situacao !== "TODOS") {
    condicoes.push({ pagamentos: { none: comprovante } });
    if (situacao === "QUITADO") condicoes.push({ parcelas: { none: pendente } });
    if (situacao === "EM_ATRASO") condicoes.push({ parcelas: { some: atrasada } });
    if (situacao === "EM_ANDAMENTO") {
      condicoes.push({ parcelas: { some: pendente, none: atrasada } });
    }
  }
  if (inicioVencimento || fimVencimento) {
    condicoes.push({ parcelas: { some: { vencimento: {
      gte: inicioVencimento ? inicioDiaFinanceiro(inicioVencimento) : undefined,
      lte: fimVencimento ? fimDiaFinanceiro(fimVencimento) : undefined,
    } } } });
  }
  if (condicoes.length) where.AND = condicoes;
  const orderBy: Prisma.EmprestimoOrderByWithRelationInput[] = [];
  if (sortBy === "cliente") orderBy.push({ cliente: { nome: order } });
  if (sortBy === "principalCentavos") orderBy.push({ principalCentavos: order });
  orderBy.push({ id: "desc" });

  const skip = (page - 1) * pageSize;
  const total = await prisma.emprestimo.count({ where });
  const registros = skip < total
    ? await prisma.emprestimo.findMany({ where, orderBy, skip, take: pageSize, select: resumoSelect })
    : [];
  return { data: registros.map((registro) => resumirEmprestimo(registro, inicioHoje)), page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

export async function detalheEmprestimo(contaId: number, id: number) {
  const emprestimo = await prisma.emprestimo.findFirst({
    where: { id, contaId },
    include: {
      cliente: { select: { id: true, nome: true } }, parcelas: parcelasOrdenadas,
      pagamentos: {
        orderBy: { criadoEm: "desc" }, take: 150, select: {
          id: true, metodo: true, status: true, itens: true, totalCentavos: true,
          gatewaySituacao: true, recebidoEm: true, criadoEm: true, lancamentoId: true,
          comprovante: { select: { enviadoEm: true } }, emprestimoAtivoId: true,
        },
      },
    },
  });
  if (!emprestimo) erro("Empréstimo não encontrado.", 404);
  const { chaveOperacao, tokenPublico, parcelas, ...dados } = emprestimo;
  const hoje = diaLocal();
  const proximoVencimento = parcelas.find((p) => !p.recebidoEm)?.vencimento ?? null;
  return {
    ...dados,
    situacao: situacaoEmprestimo(dados.pagamentos.some((p) => p.status === "EM_ANALISE"), proximoVencimento, inicioDiaFinanceiro(hoje)),
    dataCotacao: hoje,
    parcelas: parcelas.map((p) => ({ ...p, cotacao: p.recebidoEm ? null : cotarParcela(p, emprestimo, hoje) })),
    linkPublico: `${env.BASE_URL_FRONTEND.replace(/\/$/, "")}/emprestimo#token=${tokenPublico}`,
  };
}

async function publico(tokenPublico: string) {
  const loan = await prisma.emprestimo.findUnique({ where: { tokenPublico } });
  if (!loan) erro("Link de empréstimo inválido.", 404);
  return loan;
}

async function lock(tx: Prisma.TransactionClient, id: number, contaId: number) {
  const [loan] = await tx.$queryRaw<{ id: number }[]>`
    SELECT id FROM Emprestimo WHERE id = ${id} AND contaId = ${contaId} FOR UPDATE
  `;
  if (!loan) erro("Empréstimo não encontrado.", 404);
  return tx.emprestimo.findUniqueOrThrow({ where: { id } });
}

export async function excluirEmprestimo(contaId: number, id: number) {
  const lancamentoSaidaId = await prisma.$transaction(async (tx) => {
    const loan = await lock(tx, id, contaId);
    const [parcelaRecebida, pagamento] = await Promise.all([
      tx.emprestimoParcela.findFirst({
        where: { emprestimoId: id, OR: [{ recebidoEm: { not: null } }, { pagamentoId: { not: null } }] },
        select: { id: true },
      }),
      tx.emprestimoPagamento.findFirst({
        where: { emprestimoId: id, OR: [
          { status: { not: "CANCELADO" } }, { emprestimoAtivoId: { not: null } },
          { recebidoEm: { not: null } }, { lancamentoId: { not: null } },
        ] },
        select: { status: true, recebidoEm: true, lancamentoId: true },
      }),
    ]);
    if (parcelaRecebida || pagamento?.status === "PAGO" || pagamento?.recebidoEm || pagamento?.lancamentoId) {
      erro("Este empréstimo tem recebimentos registrados e deve ser mantido no histórico.", 409);
    }
    if (pagamento) erro("Resolva o Pix em aberto antes de excluir o empréstimo.", 409);

    await tx.emprestimoPagamento.deleteMany({ where: { emprestimoId: id, status: "CANCELADO" } });
    await tx.emprestimo.delete({ where: { id } });
    if (loan.lancamentoSaidaId) {
      const saida = await tx.lancamentoFinanceiro.deleteMany({
        where: { id: loan.lancamentoSaidaId, contaId, origemSistema: "EMPRESTIMO", tipo: "DESPESA" },
      });
      if (saida.count !== 1) erro("A saída vinculada precisa ser revisada antes da exclusão.", 409);
    }
    return loan.lancamentoSaidaId;
  });
  if (lancamentoSaidaId) {
    sendFinanceiroUpdated(contaId, { reason: "lancamento-deletado", lancamentoId: lancamentoSaidaId });
  }
}

async function cotar(tx: Prisma.TransactionClient, loan: Emprestimo, ids: number[], dia: string) {
  const parcelas = await tx.emprestimoParcela.findMany({
    where: { emprestimoId: loan.id, id: { in: ids }, recebidoEm: null }, orderBy: { numero: "asc" },
  });
  if (parcelas.length !== ids.length) erro("Uma das parcelas selecionadas já foi paga ou é inválida.", 409);
  let validade: Date | null = null;
  const itens: Quote[] = [];
  for (const p of parcelas) {
    const item = cotarParcela(p, loan, dia);
    itens.push(item);
    const limite = limiteCotacao(p.vencimento, loan, dia, item.descontoAntecipacaoCentavos);
    if (limite && (!validade || limite < validade)) validade = limite;
  }
  const totalCentavos = itens.reduce((total, item) => total + item.totalCentavos, 0);
  if (totalCentavos > valorMaximoPagamento) {
    erro("O valor calculado excede o limite para um pagamento. Confira os encargos ou selecione menos parcelas.");
  }
  return { itens, totalCentavos, validade };
}

export async function estadoPublico(token: string) {
  const loan = await publico(token);
  const [parcelas, ativo, dados, cliente] = await Promise.all([
    prisma.emprestimoParcela.findMany({ where: { emprestimoId: loan.id }, ...parcelasOrdenadas }),
    prisma.emprestimoPagamento.findUnique({ where: { emprestimoAtivoId: loan.id }, select: ativoSelect }),
    dadosRecebimento(loan.contaId),
    prisma.clientesFornecedores.findFirst({
      where: { id: loan.clienteId, contaId: loan.contaId },
      select: { nome: true, documento: true, email: true, telefone: true },
    }),
  ]);
  const hoje = diaLocal();
  const expirada = !!ativo?.expiraEm && ativo.expiraEm <= new Date();
  return {
    estabelecimento: dados.nome,
    logoEmpresa: dados.profile && !/^\/*imgs\/logo\.png(?:[?#].*)?$/i.test(dados.profile) ? dados.profile : null,
    cliente: cliente ? resumirClientePublico(cliente) : null,
    referencia: `#EMP-${String(loan.id).padStart(4, "0")}`,
    dataContratacao: loan.dataSaida, principalCentavos: loan.principalCentavos, jurosBps: loan.jurosBps,
    descontoJurosBps: loan.descontoJurosBps, jurosMoraBps: loan.jurosMoraBps, multaBps: loan.multaBps,
    descontoFixoCentavos: loan.descontoFixoCentavos,
    pixManual: dados.config.pixManual && !!dados.chavePix,
    mercadoPago: dados.config.mercadoPago && dados.gatewayDisponivel,
    parcelas: parcelas.map((p) => ({
      ...cotarParcela(p, loan, p.recebidoEm ? diaLocal(p.recebidoEm) : hoje), vencimento: p.vencimento,
      recebidoCentavos: p.recebidoCentavos, recebidoEm: p.recebidoEm,
    })),
    pagamento: ativo ? {
      id: ativo.id, metodo: ativo.metodo, status: ativo.status, itens: ativo.itens, totalCentavos: ativo.totalCentavos,
      pixCopiaCola: expirada ? null : ativo.pixCopiaCola,
      pixQr: !expirada && ativo.pixCopiaCola ? await qrcode.toDataURL(ativo.pixCopiaCola) : null,
      expirada,
      expiraEm: ativo.expiraEm, comprovante: !!ativo.comprovante, podeConsultar: !!ativo.gatewayId,
    } : null,
  };
}

function validarDataBaixa(loan: Emprestimo, dia: string) {
  if (dia < diaLocal(loan.dataSaida) || dia > diaLocal()) erro("Informe uma data entre a saída do empréstimo e hoje.");
}

export async function cotarBaixa(contaId: number, id: number, input: CotacaoBaixa) {
  const loan = await prisma.emprestimo.findFirst({ where: { id, contaId } });
  if (!loan) erro("Empréstimo não encontrado.", 404);
  validarDataBaixa(loan, input.recebidoEm);
  const { itens, totalCentavos } = await cotar(prisma, loan, input.parcelas, input.recebidoEm);
  return { itens, totalCentavos };
}

async function efetivar(
  tx: Prisma.TransactionClient, loan: Emprestimo, pagamento: Pagamento, data: Date, forma: MetodoPagamento,
  financeiro: Pick<ConfirmacaoEmprestimo, "lancarNoFinanceiro" | "contaEntradaId" | "categoriaId">,
) {
  const itens = pagamento.itens as Quote[];
  for (const item of itens) {
    const atualizadas = await tx.emprestimoParcela.updateMany({
      where: { id: item.id, emprestimoId: loan.id, recebidoEm: null },
      data: { recebidoEm: data, recebidoCentavos: item.totalCentavos, pagamentoId: pagamento.id },
    });
    if (atualizadas.count !== 1) erro("Uma parcela já foi quitada. Recarregue o empréstimo.", 409);
  }
  let lancamentoId: number | undefined;
  if (financeiro.lancarNoFinanceiro) {
    const contaFinanceira = financeiro.contaEntradaId ?? loan.contaEntradaId;
    const categoriaId = financeiro.categoriaId ?? loan.categoriaId;
    if (!contaFinanceira || !categoriaId) erro("Selecione uma conta financeira e uma categoria para o recebimento.");
    await validarContaCategoria(tx, loan.contaId, [contaFinanceira], categoriaId);
    const lancamento = await lancar(tx, {
      contaId: loan.contaId, clienteId: loan.clienteId,
      descricao: `Recebimento do empréstimo #${loan.id} · ${itens.map((i) => i.numero).join(", ")}`.slice(0, 175),
      tipo: "RECEITA", valorCentavos: pagamento.totalCentavos, data, forma,
      brutoCentavos: itens.reduce((total, i) => total + i.nominalCentavos + (i.multaCentavos ?? 0) + (i.jurosMoraCentavos ?? 0), 0),
      contaFinanceira, categoriaId,
    });
    lancamentoId = lancamento.id;
  }
  await tx.emprestimoPagamento.update({
    where: { id: pagamento.id },
    data: { status: "PAGO", emprestimoAtivoId: null, recebidoEm: data, formaRecebimento: forma, lancamentoId },
  });
  return !!lancamentoId;
}

export async function registrarBaixa(contaId: number, id: number, input: BaixaEmprestimo) {
  const postou = await prisma.$transaction(async (tx) => {
    const loan = await lock(tx, id, contaId);
    const where = { emprestimoId_chaveOperacao: { emprestimoId: id, chaveOperacao: input.chaveOperacao } };
    if (await tx.emprestimoPagamento.findUnique({ where, select: { id: true } })) return false;
    if (await tx.emprestimoPagamento.findUnique({ where: { emprestimoAtivoId: id }, select: { id: true } })) {
      erro("Resolva o pagamento aberto antes de registrar uma baixa por fora do link.", 409);
    }
    validarDataBaixa(loan, input.recebidoEm);
    const { itens, totalCentavos } = await cotar(tx, loan, input.parcelas, input.recebidoEm);
    if (input.totalCentavos !== undefined && input.totalCentavos !== totalCentavos) {
      erro("O valor mudou. Confira a cotação antes de confirmar a baixa.", 409);
    }
    const pagamento = await tx.emprestimoPagamento.create({
      data: { id: randomUUID(), emprestimoId: id, metodo: "INTERNO", chaveOperacao: input.chaveOperacao, itens, totalCentavos },
    });
    return efetivar(tx, loan, pagamento, dataFinanceira(input.recebidoEm), input.formaRecebimento, input);
  });
  if (postou) sendFinanceiroUpdated(contaId);
}

export async function aprovarComprovante(contaId: number, id: number, pagamentoId: string, input: ConfirmacaoEmprestimo) {
  const postou = await prisma.$transaction(async (tx) => {
    const loan = await lock(tx, id, contaId);
    const pagamento = await tx.emprestimoPagamento.findFirst({ where: { id: pagamentoId, emprestimoId: id, metodo: "PIX_MANUAL" } });
    if (pagamento?.status === "PAGO") return false;
    if (pagamento?.emprestimoAtivoId !== id || !["EM_ANALISE", "PENDENTE"].includes(pagamento.status)) {
      erro("O Pix manual não está aberto.", 409);
    }
    validarDataBaixa(loan, input.recebidoEm);
    if (pagamento.expiraEm && input.recebidoEm > diaLocal(pagamento.expiraEm)) {
      erro("O Pix foi pago após o prazo da cotação. Confira os encargos e o valor recebido antes de registrar a baixa.");
    }
    return efetivar(tx, loan, pagamento, dataFinanceira(input.recebidoEm), "PIX", input);
  });
  if (postou) sendFinanceiroUpdated(contaId);
}

export async function cancelarPixManual(contaId: number, id: number, pagamentoId: string) {
  await prisma.$transaction(async (tx) => {
    await lock(tx, id, contaId);
    const changed = await tx.emprestimoPagamento.updateMany({
      where: { id: pagamentoId, emprestimoAtivoId: id, metodo: "PIX_MANUAL", status: { in: ["PENDENTE", "EM_ANALISE"] } },
      data: { status: "CANCELADO", emprestimoAtivoId: null },
    });
    if (!changed.count) erro("O Pix não está aberto.", 409);
  });
}

export async function lerComprovante(contaId: number, id: number, pagamentoId: string) {
  const comprovante = await prisma.emprestimoComprovante.findFirst({
    where: { pagamentoId, pagamento: { emprestimo: { id, contaId } } },
    select: { tipo: true, conteudo: true },
  });
  if (!comprovante) erro("Comprovante não encontrado.", 404);
  return comprovante;
}

export async function enviarComprovante(token: string, pagamentoId: string, bytes?: Buffer) {
  if (!bytes?.length) erro("Selecione um comprovante.");
  const tipo = tipoComprovante(bytes);
  if (!tipo) erro("Envie um comprovante em PDF, JPG ou PNG.");
  const { id, contaId } = await publico(token);
  await prisma.$transaction(async (tx) => {
    await lock(tx, id, contaId);
    const pagamento = await tx.emprestimoPagamento.findUnique({ where: { emprestimoAtivoId: id } });
    if (pagamento?.id !== pagamentoId || pagamento.metodo !== "PIX_MANUAL" || pagamento.status !== "PENDENTE") {
      erro("O Pix não está aguardando comprovante.", 409);
    }
    const dados = { conteudo: bytes, tipo, enviadoEm: new Date() };
    await tx.emprestimoComprovante.create({ data: { pagamentoId: pagamento.id, ...dados } });
    await tx.emprestimoPagamento.update({ where: { id: pagamento.id }, data: { status: "EM_ANALISE" } });
  });
  return estadoPublico(token);
}

async function aplicarGateway(pagamento: Pagamento, contaId: number, provider: RespostaGateway) {
  const result = await prisma.$transaction(async (tx) => {
    const loan = await lock(tx, pagamento.emprestimoId, contaId);
    const atual = await tx.emprestimoPagamento.findUniqueOrThrow({ where: { id: pagamento.id } });
    if (!correspondeAoPagamento(provider, atual) || provider.payment_method_id !== "pix") return false;
    const status = provider.status;
    const gatewayId = String(provider.id);
    if (atual.status === "PAGO") {
      if (status === "refunded" || status === "charged_back" || (provider.transaction_amount_refunded ?? 0) > 0) {
        await tx.emprestimoPagamento.update({
          where: { id: atual.id }, data: { gatewaySituacao: status === "approved" ? "partial_refund" : status },
        });
      }
      return false;
    }
    if (atual.status !== "PENDENTE") return false;
    const expiracao = provider.date_of_expiration ? new Date(provider.date_of_expiration) : null;
    const validadeGateway = expiracao && Number.isFinite(expiracao.getTime()) ? expiracao : null;
    const cancelado = status === "cancelled" || status === "rejected" || status === "refunded";
    await tx.emprestimoPagamento.update({
      where: { id: atual.id },
      data: {
        gatewayId, gatewaySituacao: status, pagadorEmail: null, pagadorDocumento: null,
        pixCopiaCola: provider.point_of_interaction?.transaction_data?.qr_code || undefined,
        expiraEm: validadeGateway && (!atual.expiraEm || validadeGateway < atual.expiraEm) ? validadeGateway : undefined,
        ...(cancelado ? { status: "CANCELADO", emprestimoAtivoId: null } : {}),
      },
    });
    if (status !== "approved") return false;
    const recebidoEm = new Date(provider.date_approved || "");
    if (!Number.isFinite(recebidoEm.getTime())) erro("O Mercado Pago ainda não informou a data do pagamento.", 503);
    return efetivar(tx, loan, atual, recebidoEm, "PIX", { lancarNoFinanceiro: loan.lancamentoAutomatico });
  });
  if (result) sendFinanceiroUpdated(contaId);
}

function assinaturaWebhook(id: string) {
  return createHmac("sha256", env.JWT_SECRET).update(referenciaGateway(id)).digest("hex");
}

export function validarWebhook(id: string, assinatura: string) {
  return /^[a-f0-9]{64}$/.test(assinatura)
    && timingSafeEqual(Buffer.from(assinatura), Buffer.from(assinaturaWebhook(id)));
}

async function iniciarGateway(gateway: Gateway, loan: Emprestimo, pagamento: Pagamento) {
  if (pagamento.gatewayId) return;
  const document = pagamento.pagadorDocumento!;
  let provider: RespostaGateway;
  try {
    provider = await gateway.payment.create({
      requestOptions: { idempotencyKey: pagamento.id },
      body: {
        payer: { email: pagamento.pagadorEmail!, identification: { type: document.length === 11 ? "CPF" : "CNPJ", number: document } },
        external_reference: referenciaGateway(pagamento.id), transaction_amount: pagamento.totalCentavos / 100,
        description: `Parcelas do empréstimo #${loan.id}`, payment_method_id: "pix", installments: 1,
        date_of_expiration: pagamento.expiraEm?.toISOString(),
        notification_url: `${env.BASE_URL.replace(/\/$/, "")}/mercadopago/webhook/emprestimos/${pagamento.id}/${assinaturaWebhook(pagamento.id)}?source_news=webhooks`,
      },
    });
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 400 || status === 422) {
      await prisma.$transaction(async (tx) => {
        await lock(tx, loan.id, loan.contaId);
        await tx.emprestimoPagamento.updateMany({
          where: { id: pagamento.id, gatewayId: null, status: "PENDENTE" },
          data: { status: "CANCELADO", emprestimoAtivoId: null, pagadorEmail: null, pagadorDocumento: null },
        });
      });
      erro("O Mercado Pago recusou a emissão do Pix. Confira os dados do pagador e tente novamente.");
    }
    erro("O Mercado Pago está indisponível. Tente retomar a mesma cobrança em instantes.", 503);
  }
  if (!correspondeAoPagamento(provider, pagamento)) {
    // A confirmação web pode chegar depois. Mantenha a chave idempotente para a próxima consulta.
    erro("O Mercado Pago ainda não confirmou a emissão do Pix. Tente atualizar em instantes.", 503);
  }
  await aplicarGateway(pagamento, loan.contaId, provider);
}

function textoPix(value: string) {
  return value.normalize("NFD").replace(/[^A-Za-z0-9 ]/g, "").trim();
}

export async function abrirPagamento(token: string, input: AbrirPagamento) {
  const loan = await publico(token);
  const dados = await dadosRecebimento(loan.contaId);
  if (input.metodo === "PIX_MANUAL" && (!dados.config.pixManual || !dados.chavePix)) erro("O Pix manual está indisponível.");
  if (input.metodo === "MERCADO_PAGO" && (!dados.config.mercadoPago || !dados.gatewayDisponivel)) erro("O Mercado Pago está indisponível.");
  const gateway = input.metodo === "MERCADO_PAGO" ? await getTenantMercadoPagoService(loan.contaId) : null;
  const pagamento = await prisma.$transaction(async (tx) => {
    const atual = await lock(tx, loan.id, loan.contaId);
    const ativo = await tx.emprestimoPagamento.findUnique({ where: { emprestimoAtivoId: loan.id } });
    if (ativo) {
      const ids = (ativo.itens as Quote[]).map((p) => p.id);
      if (ativo.metodo !== input.metodo || ids.length !== input.parcelas.length || !input.parcelas.every((id) => ids.includes(id))) {
        erro("Já existe um Pix aberto para este empréstimo. Confira a cobrança atual.", 409);
      }
      return ativo;
    }
    const id = randomUUID();
    const agora = new Date();
    const { itens, totalCentavos, validade } = await cotar(tx, atual, input.parcelas, diaLocal(agora));
    if (totalCentavos !== input.totalCentavos) erro("O valor mudou. Confira o total atualizado antes de gerar o Pix.", 409);
    const validadeGateway = input.metodo === "MERCADO_PAGO" ? validade : null;
    if (validadeGateway && validadeGateway.getTime() - agora.getTime() < 31 * 60 * 1000) {
      erro("O valor das parcelas será atualizado em breve. Use o Pix manual, se disponível, ou gere um novo Pix após a atualização.");
    }
    const expiraEm = validadeGateway
      ? new Date(Math.min(validadeGateway.getTime(), agora.getTime() + 24 * 60 * 60 * 1000))
      : validade;
    const nome = textoPix(dados.nome) || "RECEBEDOR";
    const cidade = textoPix(dados.cidade) || "SAO PAULO";
    return tx.emprestimoPagamento.create({
      data: {
        id, emprestimoId: loan.id, emprestimoAtivoId: loan.id, metodo: input.metodo, itens, totalCentavos, expiraEm,
        ...(input.metodo === "PIX_MANUAL" ? {
          pixCopiaCola: QrCodePix({
            version: "01", key: dados.chavePix!, name: nome, city: cidade,
            value: totalCentavos / 100, transactionId: id.replace(/-/g, "").slice(0, 25),
          }).payload(),
        } : { pagadorEmail: input.email, pagadorDocumento: input.documento }),
      },
    });
  });
  if (gateway && pagamento.metodo === "MERCADO_PAGO") await iniciarGateway(gateway, loan, pagamento);
  return estadoPublico(token);
}

async function sincronizarGateway(loan: Emprestimo, pagamentoId: string, cancelar = false) {
  const pagamento = await prisma.emprestimoPagamento.findUnique({ where: { emprestimoAtivoId: loan.id } });
  if (pagamento?.id !== pagamentoId || pagamento.metodo !== "MERCADO_PAGO") return;
  const gateway = await getTenantMercadoPagoService(loan.contaId);
  if (!pagamento.gatewayId) {
    await iniciarGateway(gateway, loan, pagamento);
    return;
  }
  if (cancelar) {
    try {
      await gateway.payment.cancel({ id: pagamento.gatewayId });
    } catch {
      const atual = await gateway.payment.get({ id: pagamento.gatewayId });
      await aplicarGateway(pagamento, loan.contaId, atual);
      if (atual.status === "pending" || atual.status === "in_process") {
        erro("O Mercado Pago ainda não confirmou o cancelamento. Tente novamente em instantes.", 409);
      }
      return;
    }
  }
  await aplicarGateway(pagamento, loan.contaId, await gateway.payment.get({ id: pagamento.gatewayId }));
}

export async function consultarPagamento(token: string, pagamentoId: string, cancelar = false) {
  await sincronizarGateway(await publico(token), pagamentoId, cancelar);
  return estadoPublico(token);
}

export async function consultarPagamentoAdmin(contaId: number, id: number, pagamentoId: string) {
  const loan = await prisma.emprestimo.findFirst({ where: { id, contaId } });
  if (!loan) erro("Empréstimo não encontrado.", 404);
  await sincronizarGateway(loan, pagamentoId);
}

export async function webhookGateway(pagamentoId: string, gatewayId: string) {
  const pagamento = await prisma.emprestimoPagamento.findFirst({
    where: { id: pagamentoId, metodo: "MERCADO_PAGO" }, include: { emprestimo: { select: { contaId: true } } },
  });
  if (!pagamento || (pagamento.gatewayId && pagamento.gatewayId !== gatewayId)) return;
  const { contaId } = pagamento.emprestimo;
  const gateway = await getTenantMercadoPagoService(contaId);
  await aplicarGateway(pagamento, contaId, await gateway.payment.get({ id: gatewayId }));
}
