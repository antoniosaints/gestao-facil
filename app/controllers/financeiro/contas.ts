import { Request, Response } from "express";
import Decimal from "decimal.js";
import { ResponseHandler } from "../../utils/response";
import { handleError } from "../../utils/handleError";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { Prisma } from "../../../generated";
import { isAccountOverdue } from "../../routers/web";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import { buildParcelaFinanceiroWhere, decimalToNumber, getParcelaStatus, matchesStatusFilter, parseFinanceiroFilters, type FinanceiroStatusFiltro, type FinanceiroTipoFiltro } from "./queryFilters";
import { criarLancamentoFinanceiro } from "../../services/financeiro/lancamentoService";
import { endOfDay, startOfDay } from "date-fns";
import { assertTransferAllowed } from "../../services/financeiro/financeiroPolicyService";
import { sendFinanceiroUpdated } from "../../hooks/financeiro/socket";
import { deleteStoredFile } from "../../services/uploads/fileStorageService";

const AJUSTE_SALDO_CATEGORIA = "Ajuste de saldo da conta";
const TRANSFERENCIA_ENTRE_CONTAS_CATEGORIA = "Transferência entre contas";

function normalizeColor(value?: string | null) {
    if (!value) return null;

    const normalized = String(value).trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) {
        return null;
    }

    return normalized.toUpperCase();
}

async function calcularSaldosAtuaisContas(contaId: number, contaFinanceiraIds: number[]) {
    if (!contaFinanceiraIds.length) {
        return new Map<number, number>();
    }

    const parcelasPagas = await prisma.parcelaFinanceiro.findMany({
        where: {
            contaFinanceira: { in: contaFinanceiraIds },
            pago: true,
            OR: [
                { dataPagamento: null },
                { dataPagamento: { lte: endOfDay(new Date()) } },
            ],
            lancamento: {
                contaId,
            },
        },
        select: {
            contaFinanceira: true,
            valor: true,
            valorPago: true,
            lancamento: {
                select: {
                    tipo: true,
                },
            },
        },
    });

    const saldoPorConta = new Map<number, Decimal>();

    for (const parcela of parcelasPagas) {
        if (!parcela.contaFinanceira) continue;

        const atual = saldoPorConta.get(parcela.contaFinanceira) ?? new Decimal(0);
        const valor = new Decimal(parcela.valorPago ?? parcela.valor ?? 0);
        saldoPorConta.set(
            parcela.contaFinanceira,
            parcela.lancamento.tipo === "RECEITA" ? atual.plus(valor) : atual.minus(valor),
        );
    }

    return new Map(Array.from(saldoPorConta.entries()).map(([key, value]) => [key, value.toNumber()]));
}

export const listContasFinanceiro = async (req: Request, res: Response): Promise<any> => {
    try {
        const { contaId } = getCustomRequest(req).customData;

        const contas = await prisma.contasFinanceiro.findMany({
            where: {
                contaId,
            },
            select: {
                id: true,
                Uid: true,
                nome: true,
                icone: true,
                corDestaque: true,
                saldoInicial: true,
            },
            orderBy: {
                nome: "asc",
            },
        });

        const saldoPorConta = await calcularSaldosAtuaisContas(contaId, contas.map((conta) => conta.id));

        return ResponseHandler(
            res,
            "Contas listadas com sucesso!",
            contas.map((conta) => {
                const saldoInicial = decimalToNumber(conta.saldoInicial);
                const variacao = saldoPorConta.get(conta.id) ?? 0;

                return {
                    ...conta,
                    saldoInicial,
                    saldoAtual: saldoInicial + variacao,
                };
            }),
            200,
        );
    } catch (error) {
        handleError(res, error);
    }
}

export const saveContaFinanceiro = async (req: Request, res: Response): Promise<any> => {
    try {
        const { contaId } = getCustomRequest(req).customData;

        if (!req.body) {
            return ResponseHandler(res, "Dados obrigatorio!", null, 400);
        }
        
        if (!req.body.nome) {
            return ResponseHandler(res, "Nome da conta obrigatorio!", null, 400);
        }

        const dataPayload = {
            nome: String(req.body.nome).trim(),
            saldoInicial: new Decimal(req.body.saldoInicial || 0),
            corDestaque: normalizeColor(req.body.corDestaque),
        };

        const removeIcon = Boolean(req.body.removeIcon);
        let saved: { id: number; Uid: string; nome: string; icone: string | null; corDestaque: string | null; saldoInicial: Decimal };

        if (req.body.id) {
            const contaAtual = await prisma.contasFinanceiro.findFirst({
                where: {
                    id: Number(req.body.id),
                    contaId,
                },
                select: {
                    id: true,
                    Uid: true,
                    nome: true,
                    icone: true,
                    corDestaque: true,
                    saldoInicial: true,
                },
            });

            if (!contaAtual) {
                return ResponseHandler(res, "Conta financeira não encontrada!", null, 404);
            }

            if (removeIcon && contaAtual.icone) {
                await deleteStoredFile(contaAtual.icone);
            }

            saved = await prisma.contasFinanceiro.update({
                where: {
                    id: Number(req.body.id),
                    contaId,
                },
                data: {
                    ...dataPayload,
                    ...(removeIcon ? { icone: null } : {}),
                },
                select: {
                    id: true,
                    Uid: true,
                    nome: true,
                    icone: true,
                    corDestaque: true,
                    saldoInicial: true,
                },
            });
        } else {
            saved = await prisma.contasFinanceiro.create({
                data: {
                    contaId,
                    Uid: gerarIdUnicoComMetaFinal('CON'),
                    ...dataPayload,
                },
                select: {
                    id: true,
                    Uid: true,
                    nome: true,
                    icone: true,
                    corDestaque: true,
                    saldoInicial: true,
                },
            });
        }

        sendFinanceiroUpdated(contaId, {
            reason: req.body.id ? "conta-financeira-atualizada" : "conta-financeira-criada",
            contaFinanceiraId: saved.id,
        });

        return ResponseHandler(res, "Conta salva com sucesso!", {
            ...saved,
            saldoInicial: decimalToNumber(saved.saldoInicial),
        }, 200);
    } catch (error) {
        handleError(res, error);
    }
}

export const deleteContaFinanceiro = async (req: Request, res: Response): Promise<any> => {
    try {
        const { id } = req.params;
        const { contaId } = getCustomRequest(req).customData;
        await prisma.contasFinanceiro.deleteMany({
            where: {
                id: Number(id),
                contaId,
            },
        });
        sendFinanceiroUpdated(contaId, { reason: "conta-financeira-deletada", contaFinanceiraId: Number(id) });
        return ResponseHandler(res, "Conta deletada com sucesso!", null, 200);
    } catch (error) {
        handleError(res, error);
    }
}

export const getContaFinanceiroDetalhes = async (req: Request, res: Response): Promise<any> => {
    try {
        const { contaId } = getCustomRequest(req).customData;
        const contaFinanceiraId = Number(req.params.id);

        if (!contaFinanceiraId || Number.isNaN(contaFinanceiraId)) {
            return res.status(400).json({ message: "Informe uma conta financeira válida." });
        }

        const filters = parseFinanceiroFilters(req, { defaultRange: "current-month" });
        const hoje = new Date();

        const conta = await prisma.contasFinanceiro.findFirst({
            where: {
                id: contaFinanceiraId,
                contaId,
            },
            select: {
                id: true,
                Uid: true,
                nome: true,
                icone: true,
                corDestaque: true,
                saldoInicial: true,
            },
        });

        if (!conta) {
            return res.status(404).json({ message: "Conta financeira não encontrada." });
        }

        const where = buildParcelaFinanceiroWhere(contaId, {
            ...filters,
            contaFinanceiraId,
        }) as Prisma.ParcelaFinanceiroWhereInput;

        if (filters.inicio || filters.fim) {
            where.vencimento = {
                ...(filters.inicio ? { gte: filters.inicio } : {}),
                ...(filters.fim ? { lte: filters.fim } : {}),
            };
        }

        const parcelas = await prisma.parcelaFinanceiro.findMany({
            where,
            select: {
                id: true,
                numero: true,
                valor: true,
                valorPago: true,
                pago: true,
                vencimento: true,
                dataPagamento: true,
                formaPagamento: true,
                lancamento: {
                    select: {
                        id: true,
                        Uid: true,
                        descricao: true,
                        tipo: true,
                        formaPagamento: true,
                        categoria: {
                            select: {
                                id: true,
                                nome: true,
                            },
                        },
                        cliente: {
                            select: {
                                id: true,
                                nome: true,
                            },
                        },
                    },
                },
            },
            orderBy: [{ vencimento: "desc" }, { id: "desc" }],
        });

        const parcelasFiltradas = parcelas.filter((parcela) => matchesStatusFilter(parcela, filters.status, hoje));

        const saldoInicial = new Decimal(conta.saldoInicial || 0);
        const toDecimal = (value: unknown) => new Decimal(value || 0);
        const getValorPago = (parcela: { valor: unknown; valorPago?: unknown | null }) =>
            parcela.valorPago !== null && parcela.valorPago !== undefined
                ? toDecimal(parcela.valorPago)
                : toDecimal(parcela.valor);

        const entradasPrevistas = parcelasFiltradas
            .filter((parcela) => parcela.lancamento.tipo === "RECEITA")
            .reduce((acc, parcela) => acc.plus(toDecimal(parcela.valor)), new Decimal(0));

        const saidasPrevistas = parcelasFiltradas
            .filter((parcela) => parcela.lancamento.tipo === "DESPESA")
            .reduce((acc, parcela) => acc.plus(toDecimal(parcela.valor)), new Decimal(0));

        const entradasRealizadas = parcelasFiltradas
            .filter((parcela) => parcela.lancamento.tipo === "RECEITA" && parcela.pago)
            .reduce((acc, parcela) => acc.plus(getValorPago(parcela)), new Decimal(0));

        const saidasRealizadas = parcelasFiltradas
            .filter((parcela) => parcela.lancamento.tipo === "DESPESA" && parcela.pago)
            .reduce((acc, parcela) => acc.plus(getValorPago(parcela)), new Decimal(0));

        const pendenteReceber = parcelasFiltradas
            .filter((parcela) => parcela.lancamento.tipo === "RECEITA" && !parcela.pago)
            .reduce((acc, parcela) => acc.plus(toDecimal(parcela.valor)), new Decimal(0));

        const pendentePagar = parcelasFiltradas
            .filter((parcela) => parcela.lancamento.tipo === "DESPESA" && !parcela.pago)
            .reduce((acc, parcela) => acc.plus(toDecimal(parcela.valor)), new Decimal(0));

        const atrasadoReceber = parcelasFiltradas
            .filter((parcela) => parcela.lancamento.tipo === "RECEITA" && getParcelaStatus(parcela, hoje) === "ATRASADO")
            .reduce((acc, parcela) => acc.plus(toDecimal(parcela.valor)), new Decimal(0));

        const atrasadoPagar = parcelasFiltradas
            .filter((parcela) => parcela.lancamento.tipo === "DESPESA" && getParcelaStatus(parcela, hoje) === "ATRASADO")
            .reduce((acc, parcela) => acc.plus(toDecimal(parcela.valor)), new Decimal(0));

        const saldoAtual = saldoInicial.plus(entradasRealizadas).minus(saidasRealizadas);
        const saldoPrevisto = saldoInicial.plus(entradasPrevistas).minus(saidasPrevistas);

        const movimentacoes = parcelasFiltradas.map((parcela) => ({
            id: parcela.id,
            numero: parcela.numero,
            valor: decimalToNumber(parcela.valor),
            valorPago: parcela.pago ? decimalToNumber(getValorPago(parcela)) : null,
            pago: parcela.pago,
            status: getParcelaStatus(parcela, hoje),
            vencimento: parcela.vencimento,
            dataPagamento: parcela.dataPagamento,
            formaPagamento: parcela.formaPagamento || parcela.lancamento.formaPagamento || null,
            lancamento: {
                id: parcela.lancamento.id,
                Uid: parcela.lancamento.Uid,
                descricao: parcela.lancamento.descricao,
                tipo: parcela.lancamento.tipo,
                categoria: parcela.lancamento.categoria,
                cliente: parcela.lancamento.cliente,
            },
        }));

        return res.json({
            data: {
                conta: {
                    ...conta,
                    saldoInicial: decimalToNumber(conta.saldoInicial),
                },
                periodo: {
                    inicio: filters.inicio,
                    fim: filters.fim,
                },
                resumo: {
                    totalMovimentacoes: movimentacoes.length,
                    pagos: movimentacoes.filter((item) => item.pago).length,
                    pendentes: movimentacoes.filter((item) => item.status === "PENDENTE").length,
                    atrasados: movimentacoes.filter((item) => item.status === "ATRASADO").length,
                    saldoInicial: decimalToNumber(conta.saldoInicial),
                    entradasPrevistas: entradasPrevistas.toNumber(),
                    saidasPrevistas: saidasPrevistas.toNumber(),
                    entradasRealizadas: entradasRealizadas.toNumber(),
                    saidasRealizadas: saidasRealizadas.toNumber(),
                    pendenteReceber: pendenteReceber.toNumber(),
                    pendentePagar: pendentePagar.toNumber(),
                    atrasadoReceber: atrasadoReceber.toNumber(),
                    atrasadoPagar: atrasadoPagar.toNumber(),
                    saldoAtual: saldoAtual.toNumber(),
                    saldoPrevisto: saldoPrevisto.toNumber(),
                },
                movimentacoes,
            },
        });
    } catch (error) {
        handleError(res, error);
    }
}

function normalizeTransferMode(mode: unknown): "GERAR_FINANCEIRO" | "MOVER_LANCAMENTOS" {
    return mode === "MOVER_LANCAMENTOS" ? "MOVER_LANCAMENTOS" : "GERAR_FINANCEIRO";
}

function normalizeTransferStatus(status: unknown): FinanceiroStatusFiltro {
    if (status === "PAGO" || status === "PENDENTE" || status === "ATRASADO") return status;
    return "TODOS";
}

function normalizeTransferTipo(tipo: unknown): FinanceiroTipoFiltro {
    if (tipo === "RECEITA" || tipo === "DESPESA") return tipo;
    return "TODOS";
}

function parseTransferDate(value: unknown, end: boolean = false) {
    if (!value || typeof value !== "string") return undefined;

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return undefined;

    return end ? endOfDay(date) : startOfDay(date);
}

async function getOrCreateCategoriaFinanceira(
    tx: Prisma.TransactionClient,
    contaId: number,
    nome: string,
) {
    let categoria = await tx.categoriaFinanceiro.findFirst({
        where: { contaId, nome },
        select: { id: true },
    });

    if (!categoria) {
        categoria = await tx.categoriaFinanceiro.create({
            data: {
                contaId,
                Uid: gerarIdUnicoComMetaFinal("CAT"),
                nome,
            },
            select: { id: true },
        });
    }

    return categoria;
}

async function calcularSaldoAtualContaFinanceira(contaId: number, contaFinanceiraId: number) {
    const conta = await prisma.contasFinanceiro.findFirst({
        where: {
            id: contaFinanceiraId,
            contaId,
        },
        select: {
            id: true,
            nome: true,
            saldoInicial: true,
        },
    });

    if (!conta) {
        throw new Error("Conta financeira não encontrada.");
    }

    const parcelasPagas = await prisma.parcelaFinanceiro.findMany({
        where: {
            contaFinanceira: contaFinanceiraId,
            pago: true,
            OR: [
                { dataPagamento: null },
                { dataPagamento: { lte: endOfDay(new Date()) } },
            ],
            lancamento: {
                contaId,
            },
        },
        select: {
            valor: true,
            valorPago: true,
            lancamento: {
                select: {
                    tipo: true,
                },
            },
        },
    });

    const saldoInicial = new Decimal(conta.saldoInicial || 0);
    const entradasRealizadas = parcelasPagas
        .filter((parcela) => parcela.lancamento.tipo === "RECEITA")
        .reduce((acc, parcela) => acc.plus(parcela.valorPago ?? parcela.valor), new Decimal(0));

    const saidasRealizadas = parcelasPagas
        .filter((parcela) => parcela.lancamento.tipo === "DESPESA")
        .reduce((acc, parcela) => acc.plus(parcela.valorPago ?? parcela.valor), new Decimal(0));

    const saldoAtual = saldoInicial.plus(entradasRealizadas).minus(saidasRealizadas);

    return {
        conta,
        saldoInicial,
        entradasRealizadas,
        saidasRealizadas,
        saldoAtual,
    };
}

async function obterParcelasTransferencia(
    contaId: number,
    contaOrigemId: number,
    filtros: Record<string, any>,
) {
    const where = buildParcelaFinanceiroWhere(contaId, {
        contaFinanceiraId: contaOrigemId,
        categoriaId: filtros.categoriaId ? Number(filtros.categoriaId) : undefined,
        clienteId: filtros.clienteId ? Number(filtros.clienteId) : undefined,
        tipo: normalizeTransferTipo(filtros.tipo),
        status: normalizeTransferStatus(filtros.status),
        search: typeof filtros.search === "string" ? filtros.search.trim() || undefined : undefined,
    } as any) as Prisma.ParcelaFinanceiroWhereInput;

    const inicio = parseTransferDate(filtros.inicio);
    const fim = parseTransferDate(filtros.fim, true);

    if (inicio || fim) {
        where.vencimento = {
            ...(inicio ? { gte: inicio } : {}),
            ...(fim ? { lte: fim } : {}),
        };
    }

    const parcelas = await prisma.parcelaFinanceiro.findMany({
        where,
        select: {
            id: true,
            lancamentoId: true,
            pago: true,
            vencimento: true,
        },
    });

    const hoje = new Date();
    return parcelas.filter((parcela) => matchesStatusFilter(parcela, normalizeTransferStatus(filtros.status), hoje));
}

export const getContaFinanceiroSaldoAtual = async (req: Request, res: Response): Promise<any> => {
    try {
        const { contaId } = getCustomRequest(req).customData;
        const contaFinanceiraId = Number(req.params.id);

        if (!contaFinanceiraId || Number.isNaN(contaFinanceiraId)) {
            return res.status(400).json({ message: "Informe uma conta financeira válida." });
        }

        const { conta, saldoInicial, entradasRealizadas, saidasRealizadas, saldoAtual } = await calcularSaldoAtualContaFinanceira(contaId, contaFinanceiraId);

        return res.json({
            data: {
                conta: {
                    id: conta.id,
                    nome: conta.nome,
                    saldoInicial: saldoInicial.toNumber(),
                },
                resumo: {
                    saldoAtual: saldoAtual.toNumber(),
                    entradasRealizadas: entradasRealizadas.toNumber(),
                    saidasRealizadas: saidasRealizadas.toNumber(),
                },
            },
        });
    } catch (error) {
        handleError(res, error);
    }
}

export const previewTransferirContaFinanceira = async (req: Request, res: Response): Promise<any> => {
    try {
        const { contaId } = getCustomRequest(req).customData;
        await assertTransferAllowed(contaId);
        const contaOrigemId = Number(req.body?.contaOrigemId);

        if (!contaOrigemId || Number.isNaN(contaOrigemId)) {
            return res.status(400).json({ message: "Informe a conta de origem." });
        }

        const contaOrigem = await prisma.contasFinanceiro.findFirst({
            where: { id: contaOrigemId, contaId },
            select: { id: true, nome: true },
        });

        if (!contaOrigem) {
            return res.status(404).json({ message: "Conta de origem não encontrada." });
        }

        const parcelas = await obterParcelasTransferencia(contaId, contaOrigemId, req.body?.filtros || {});
        const lancamentoIds = Array.from(new Set(parcelas.map((item) => item.lancamentoId)));

        return res.json({
            data: {
                contaOrigem,
                preview: {
                    parcelasAfetadas: parcelas.length,
                    lancamentosAfetados: lancamentoIds.length,
                },
            },
        });
    } catch (error) {
        handleError(res, error);
    }
}

export const ajustarSaldoContaFinanceira = async (req: Request, res: Response): Promise<any> => {
    try {
        const { contaId } = getCustomRequest(req).customData;
        const contaFinanceiraId = Number(req.body?.contaFinanceiraId);
        const modo = req.body?.modo === "AJUSTE_INTERNO" ? "AJUSTE_INTERNO" : "LANCAR_FINANCEIRO";
        const saldoInformado = new Decimal(req.body?.saldoInformado || 0);
        const dataAjuste = parseTransferDate(req.body?.data) || startOfDay(new Date());
        const descricaoBase = typeof req.body?.descricao === "string" && req.body.descricao.trim()
            ? req.body.descricao.trim()
            : "Ajuste manual de saldo";

        if (!contaFinanceiraId || Number.isNaN(contaFinanceiraId)) {
            return res.status(400).json({ message: "Informe a conta financeira." });
        }

        if (saldoInformado.lt(0)) {
            return res.status(400).json({ message: "Informe um saldo válido para ajuste." });
        }

        const { conta, saldoAtual } = await calcularSaldoAtualContaFinanceira(contaId, contaFinanceiraId);
        const diferenca = saldoInformado.minus(saldoAtual);

        if (diferenca.isZero()) {
            return res.status(400).json({ message: "O saldo informado já é igual ao saldo atual da conta." });
        }

        if (modo === "AJUSTE_INTERNO") {
            await prisma.contasFinanceiro.update({
                where: { id: contaFinanceiraId, contaId },
                data: {
                    saldoInicial: new Decimal(conta.saldoInicial || 0).plus(diferenca),
                },
            });

            sendFinanceiroUpdated(contaId, { reason: "saldo-conta-ajustado", contaFinanceiraId, modo });

            return ResponseHandler(res, "Saldo ajustado internamente com sucesso.", {
                modo,
                contaFinanceiraId,
                saldoAtualAnterior: saldoAtual.toNumber(),
                saldoInformado: saldoInformado.toNumber(),
                diferenca: diferenca.toNumber(),
                tipoAjuste: diferenca.greaterThan(0) ? "RECEITA" : "DESPESA",
            });
        }

        const resultado = await prisma.$transaction(async (tx) => {
            const categoriaAjuste = await getOrCreateCategoriaFinanceira(tx, contaId, AJUSTE_SALDO_CATEGORIA);
            const valorAbsoluto = diferenca.abs();
            const tipoAjuste = diferenca.greaterThan(0) ? "RECEITA" : "DESPESA";

            const lancamento = await criarLancamentoFinanceiro(tx as any, contaId, {
                descricao: `${descricaoBase} • ${conta.nome}`,
                valorTotal: valorAbsoluto.toNumber(),
                valorEntrada: 0,
                desconto: 0,
                tipoLancamentoModo: "AVISTA",
                lancamentoEfetivado: true,
                tipo: tipoAjuste,
                formaPagamento: "TRANSFERENCIA",
                categoriaId: categoriaAjuste.id,
                dataLancamento: dataAjuste,
                parcelas: 1,
                contasFinanceiroId: contaFinanceiraId,
            }, { skipNotification: true });

            return {
                lancamentoId: lancamento.id,
                tipoAjuste,
            };
        });

        sendFinanceiroUpdated(contaId, { reason: "saldo-conta-ajustado", contaFinanceiraId, modo, lancamentoId: resultado.lancamentoId });

        return ResponseHandler(res, "Saldo ajustado com lançamento financeiro com sucesso.", {
            modo,
            contaFinanceiraId,
            saldoAtualAnterior: saldoAtual.toNumber(),
            saldoInformado: saldoInformado.toNumber(),
            diferenca: diferenca.toNumber(),
            ...resultado,
        });
    } catch (error) {
        handleError(res, error);
    }
}

export const transferirContaFinanceira = async (req: Request, res: Response): Promise<any> => {
    try {
        const { contaId } = getCustomRequest(req).customData;
        await assertTransferAllowed(contaId);
        const contaOrigemId = Number(req.body?.contaOrigemId);
        const contaDestinoId = Number(req.body?.contaDestinoId);
        const modo = normalizeTransferMode(req.body?.modo);

        if (!contaOrigemId || Number.isNaN(contaOrigemId)) {
            return res.status(400).json({ message: "Informe a conta de origem." });
        }

        if (!contaDestinoId || Number.isNaN(contaDestinoId)) {
            return res.status(400).json({ message: "Informe a conta de destino." });
        }

        if (contaOrigemId === contaDestinoId) {
            return res.status(400).json({ message: "Origem e destino devem ser diferentes." });
        }

        const [contaOrigem, contaDestino] = await Promise.all([
            prisma.contasFinanceiro.findFirst({
                where: { id: contaOrigemId, contaId },
                select: { id: true, nome: true },
            }),
            prisma.contasFinanceiro.findFirst({
                where: { id: contaDestinoId, contaId },
                select: { id: true, nome: true },
            }),
        ]);

        if (!contaOrigem || !contaDestino) {
            return res.status(404).json({ message: "Conta de origem ou destino não encontrada." });
        }

        if (modo === "GERAR_FINANCEIRO") {
            const valor = new Decimal(req.body?.valor || 0);
            const dataTransferencia = parseTransferDate(req.body?.data) || startOfDay(new Date());
            const descricaoBase = typeof req.body?.descricao === "string" && req.body.descricao.trim()
                ? req.body.descricao.trim()
                : `Transferência entre contas`;

            if (valor.lte(0)) {
                return res.status(400).json({ message: "Informe um valor maior que zero para a transferência." });
            }

            const resultado = await prisma.$transaction(async (tx) => {
                const categoriaTransferencia = await getOrCreateCategoriaFinanceira(tx, contaId, TRANSFERENCIA_ENTRE_CONTAS_CATEGORIA);

                const saida = await criarLancamentoFinanceiro(tx as any, contaId, {
                    descricao: `${descricaoBase} • Saída ${contaOrigem.nome} → ${contaDestino.nome}`,
                    valorTotal: valor.toNumber(),
                    valorEntrada: 0,
                    desconto: 0,
                    tipoLancamentoModo: "AVISTA",
                    lancamentoEfetivado: true,
                    tipo: "DESPESA",
                    formaPagamento: "TRANSFERENCIA",
                    categoriaId: categoriaTransferencia.id,
                    dataLancamento: dataTransferencia,
                    parcelas: 1,
                    contasFinanceiroId: contaOrigemId,
                }, { skipNotification: true });

                const entrada = await criarLancamentoFinanceiro(tx as any, contaId, {
                    descricao: `${descricaoBase} • Entrada ${contaOrigem.nome} → ${contaDestino.nome}`,
                    valorTotal: valor.toNumber(),
                    valorEntrada: 0,
                    desconto: 0,
                    tipoLancamentoModo: "AVISTA",
                    lancamentoEfetivado: true,
                    tipo: "RECEITA",
                    formaPagamento: "TRANSFERENCIA",
                    categoriaId: categoriaTransferencia.id,
                    dataLancamento: dataTransferencia,
                    parcelas: 1,
                    contasFinanceiroId: contaDestinoId,
                }, { skipNotification: true });

                return {
                    saidaId: saida.id,
                    entradaId: entrada.id,
                };
            });

            sendFinanceiroUpdated(contaId, { reason: "transferencia-entre-contas", modo, contaOrigemId, contaDestinoId });

            return ResponseHandler(res, "Transferência registrada no financeiro com sucesso.", {
                modo,
                ...resultado,
            });
        }

        const filtros = req.body?.filtros || {};
        const parcelasFiltradas = await obterParcelasTransferencia(contaId, contaOrigemId, filtros);

        if (!parcelasFiltradas.length) {
            return res.status(400).json({ message: "Nenhum lançamento/parcela encontrado para os filtros informados." });
        }

        const lancamentoIds = Array.from(new Set(parcelasFiltradas.map((item) => item.lancamentoId)));

        const resultadoMovimentacao = await prisma.$transaction(async (tx) => {
            await tx.parcelaFinanceiro.updateMany({
                where: {
                    id: { in: parcelasFiltradas.map((item) => item.id) },
                },
                data: {
                    contaFinanceira: contaDestinoId,
                },
            });

            const parcelasPorLancamento = await tx.parcelaFinanceiro.findMany({
                where: {
                    lancamentoId: { in: lancamentoIds },
                },
                select: {
                    lancamentoId: true,
                    contaFinanceira: true,
                },
            });

            const lancamentosIntegralmenteTransferidos = lancamentoIds.filter((lancamentoId) => {
                const parcelasDoLancamento = parcelasPorLancamento.filter((item) => item.lancamentoId === lancamentoId);
                return parcelasDoLancamento.length > 0 && parcelasDoLancamento.every((item) => item.contaFinanceira === contaDestinoId);
            });

            if (lancamentosIntegralmenteTransferidos.length) {
                await tx.lancamentoFinanceiro.updateMany({
                    where: {
                        id: { in: lancamentosIntegralmenteTransferidos },
                        contaId,
                    },
                    data: {
                        contasFinanceiroId: contaDestinoId,
                    },
                });
            }

            return {
                lancamentosIntegralmenteTransferidos: lancamentosIntegralmenteTransferidos.length,
            };
        });

        sendFinanceiroUpdated(contaId, { reason: "transferencia-entre-contas", modo, contaOrigemId, contaDestinoId });

        return ResponseHandler(res, "Lançamentos transferidos de conta com sucesso.", {
            modo,
            parcelasAtualizadas: parcelasFiltradas.length,
            lancamentosAtualizados: resultadoMovimentacao.lancamentosIntegralmenteTransferidos,
            lancamentosAfetados: lancamentoIds.length,
        });
    } catch (error) {
        handleError(res, error);
    }
}

export const tableContasFinanceiro = async (req: Request, res: Response): Promise<any> => {
    try {
        if (await isAccountOverdue(req)) {
            return res.status(404).json({
                message: "Conta inativa ou bloqueada, verifique seu plano",
            });
        }

        const { contaId } = getCustomRequest(req).customData;
        const page = parseInt(req.query.page as string) || 1;
        const pageSize = parseInt(req.query.pageSize as string) || 10;
        const search = (req.query.search as string) || "";
        const sortBy = (req.query.sortBy as string) || "nome";
        const order = req.query.order === "desc" ? "desc" : "asc";

        const where: Prisma.ContasFinanceiroWhereInput = {
            contaId,
        };

        if (search) {
            where.OR = [
                { nome: { contains: search } },
                { Uid: { contains: search } },
            ];
        }

        const total = await prisma.contasFinanceiro.count({ where });

        const orderBy: Prisma.ContasFinanceiroOrderByWithRelationInput[] = [];
        switch (sortBy) {
            case "id":
                orderBy.push({ id: order });
                break;
            case "Uid":
                orderBy.push({ Uid: order });
                break;
            case "saldoInicial":
                orderBy.push({ saldoInicial: order });
                break;
            default:
                orderBy.push({ nome: order });
                break;
        }
        orderBy.push({ id: "asc" });

        const shouldSortBySaldoAtual = sortBy === "saldoAtual";

        const contasBase = await prisma.contasFinanceiro.findMany({
            where,
            select: {
                id: true,
                Uid: true,
                nome: true,
                icone: true,
                corDestaque: true,
                saldoInicial: true,
            },
            orderBy: shouldSortBySaldoAtual ? [{ nome: "asc" }, { id: "asc" }] : orderBy,
            ...(shouldSortBySaldoAtual
                ? {}
                : {
                    skip: (page - 1) * pageSize,
                    take: pageSize,
                }),
        });

        const saldoPorConta = await calcularSaldosAtuaisContas(contaId, contasBase.map((conta) => conta.id));

        const contasComSaldo = contasBase.map((conta) => {
            const saldoInicial = decimalToNumber(conta.saldoInicial);
            const variacao = saldoPorConta.get(conta.id) ?? 0;

            return {
                ...conta,
                saldoInicial,
                saldoAtual: saldoInicial + variacao,
            };
        });

        const orderedData = shouldSortBySaldoAtual
            ? [...contasComSaldo].sort((a, b) => {
                const diff = Number(a.saldoAtual) - Number(b.saldoAtual);
                if (diff === 0) return a.id - b.id;
                return order === "desc" ? -diff : diff;
            })
            : contasComSaldo;

        const data = shouldSortBySaldoAtual
            ? orderedData.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize)
            : orderedData;

        return res.json({
            data,
            page,
            pageSize,
            total,
            totalPages: Math.ceil(total / pageSize),
        });
    } catch (error) {
        handleError(res, error);
    }
}
