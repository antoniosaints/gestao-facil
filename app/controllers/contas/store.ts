import { Request, Response } from "express";
import { isAfter } from "date-fns";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { handleError } from "../../utils/handleError";
import {
  calculateModuleImmediateCharge,
  cancelModuleCurrentCharge,
  createImmediateModuleCharge,
  ensureDefaultStoreModules,
  isContaSubscriptionActive,
  syncContaRecurringBilling,
  type ModuleBillingMode,
  type ModuleStatus,
} from "../../services/contas/storeModulesService";

function getModuleState(moduleLink?: {
  status: ModuleStatus;
  vencimento: Date;
  cobrancaAtualId?: number | null;
}) {
  const now = new Date();

  if (!moduleLink) {
    return {
      ativo: false,
      pendenteAtivacao: false,
      cancelamentoAgendado: false,
      cobrancaPendenteAtual: false,
    };
  }

  const stillAvailable =
    moduleLink.status === "ATIVO" ||
    (moduleLink.status === "CANCELAMENTO_AGENDADO" && isAfter(moduleLink.vencimento, now));

  return {
    ativo: stillAvailable,
    pendenteAtivacao: moduleLink.status === "PENDENTE_ATIVACAO",
    cancelamentoAgendado: moduleLink.status === "CANCELAMENTO_AGENDADO",
    cobrancaPendenteAtual:
      moduleLink.status === "PENDENTE_ATIVACAO" && !!moduleLink.cobrancaAtualId,
  };
}

function normalizeBillingMode(value: unknown): ModuleBillingMode {
  return String(value).toUpperCase() === "MENSAL" ? "MENSAL" : "PROPORCIONAL";
}

export async function listStoreModules(req: Request, res: Response): Promise<any> {
  try {
    const customData = getCustomRequest(req).customData;

    await ensureDefaultStoreModules();

    const [conta, modulos] = await Promise.all([
      prisma.contas.findUniqueOrThrow({
        where: {
          id: customData.contaId,
        },
        select: {
          id: true,
          valor: true,
          valorBasePlano: true,
          vencimento: true,
          status: true,
        },
      }),
      prisma.modulosAdicionais.findMany({
        where: {
          status: true,
        },
        orderBy: {
          createdAt: "asc",
        },
        include: {
          moduloOnContas: {
            where: {
              contaId: customData.contaId,
            },
            take: 1,
            orderBy: {
              updatedAt: "desc",
            },
            include: {
              CobrancaAtual: {
                select: {
                  id: true,
                  externalLink: true,
                  dataVencimento: true,
                  status: true,
                  gateway: true,
                },
              },
            },
          },
        },
      }),
    ]);

    const contaAtiva = isContaSubscriptionActive(conta);

    const data = modulos.map((modulo) => {
      const vinculo = modulo.moduloOnContas[0];
      const state = getModuleState(
        vinculo
          ? {
              status: vinculo.status as ModuleStatus,
              vencimento: vinculo.vencimento,
              cobrancaAtualId: vinculo.cobrancaAtualId,
            }
          : undefined,
      );

      const precoMensal = Number(vinculo?.valorAdicional ?? modulo.preco ?? 0);
      const valorProporcional = calculateModuleImmediateCharge(
        precoMensal,
        conta.vencimento,
        "PROPORCIONAL",
      ).toNumber();

      return {
        id: modulo.id,
        codigo: modulo.codigo,
        nome: modulo.nome,
        descricao: modulo.descricao,
        detalhes: modulo.descricao,
        categoria: modulo.categoria,
        preco: precoMensal,
        ativo: state.ativo,
        pendenteAtivacao: state.pendenteAtivacao,
        cancelamentoAgendado: state.cancelamentoAgendado,
        cobrancaPendenteAtual: state.cobrancaPendenteAtual,
        vigenciaAte: vinculo?.vencimento ?? null,
        ativacaoImediataDisponivel: contaAtiva && !state.ativo && !state.cancelamentoAgendado,
        valorCobrancaProporcional: valorProporcional,
        valorCobrancaMensal: precoMensal,
        cobrancaAtual: vinculo?.CobrancaAtual
          ? {
              id: vinculo.CobrancaAtual.id,
              tipo: vinculo.tipoCobrancaAtual,
              valor: Number(vinculo.valorCobrancaAtual ?? 0),
              linkPagamento: vinculo.CobrancaAtual.externalLink,
              vencimento: vinculo.CobrancaAtual.dataVencimento,
              status: vinculo.CobrancaAtual.status,
              gateway: vinculo.CobrancaAtual.gateway,
            }
          : null,
      };
    });

    const mensalidadeAtual = Number(conta.valor ?? 0);
    const valorBasePlano = Number(conta.valorBasePlano ?? 0);

    return res.json({
      data,
      resumo: {
        mensalidadeAtual,
        valorBasePlano,
        valorAppsProximoCiclo: Math.max(mensalidadeAtual - valorBasePlano, 0),
        totalAppsDisponiveis: data.length,
        totalAppsEmUso: data.filter((modulo) => modulo.ativo).length,
        totalAppsPendentes: data.filter((modulo) => modulo.pendenteAtivacao).length,
        proximoVencimento: conta.vencimento,
        contaAtiva,
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
}

export async function activateStoreModule(req: Request, res: Response): Promise<any> {
  try {
    const customData = getCustomRequest(req).customData;
    const moduleId = Number(req.params.id);
    const billingMode = normalizeBillingMode(req.body?.billingMode);

    if (!moduleId) {
      return res.status(400).json({ message: "Modulo invalido." });
    }

    const [conta, modulo, vinculoAtual] = await Promise.all([
      prisma.contas.findUniqueOrThrow({
        where: {
          id: customData.contaId,
        },
        select: {
          id: true,
          vencimento: true,
          status: true,
        },
      }),
      prisma.modulosAdicionais.findFirstOrThrow({
        where: {
          id: moduleId,
          status: true,
        },
      }),
      prisma.moduloOnConta.findUnique({
        where: {
          moduloId_contaId: {
            moduloId: moduleId,
            contaId: customData.contaId,
          },
        },
      }),
    ]);

    const statusAtual = vinculoAtual?.status as ModuleStatus | undefined;

    if (statusAtual === "ATIVO") {
      return res.status(400).json({ message: "Este app ja esta ativo na conta." });
    }

    if (statusAtual === "PENDENTE_ATIVACAO" && vinculoAtual?.cobrancaAtualId) {
      return res.status(400).json({
        message:
          "Ja existe uma cobranca pendente para liberar este app. Abra o link de pagamento ou cancele a solicitacao atual.",
      });
    }

    const manterAtivo =
      statusAtual === "CANCELAMENTO_AGENDADO" &&
      !!vinculoAtual &&
      isAfter(vinculoAtual.vencimento, new Date());

    const nextStatus: ModuleStatus = manterAtivo ? "ATIVO" : "PENDENTE_ATIVACAO";
    const contaAtiva = isContaSubscriptionActive(conta);

    const vinculo = vinculoAtual
      ? await prisma.moduloOnConta.update({
          where: {
            id: vinculoAtual.id,
          },
          data: {
            valorAdicional: modulo.preco,
            status: nextStatus as any,
            ativoDesde: new Date(),
            solicitadoCancelamentoEm: null,
            canceladoEm: null,
            vencimento: conta.vencimento,
            cobrancaAtualId: null,
            tipoCobrancaAtual: null,
            valorCobrancaAtual: null,
          },
        })
      : await prisma.moduloOnConta.create({
          data: {
            contaId: customData.contaId,
            moduloId: modulo.id,
            valorAdicional: modulo.preco,
            status: nextStatus as any,
            ativoDesde: new Date(),
            vencimento: conta.vencimento,
          },
        });

    const recurringValue = await syncContaRecurringBilling(customData.contaId);

    if (manterAtivo) {
      return res.json({
        message: "Modulo reativado para continuar na recorrencia da proxima mensalidade.",
        data: {
          recurringValue: recurringValue.toNumber(),
        },
      });
    }

    if (!contaAtiva) {
      return res.json({
        message:
          "Modulo reservado para a proxima mensalidade. Ele sera liberado quando o proximo pagamento do plano for confirmado.",
        data: {
          recurringValue: recurringValue.toNumber(),
          billingMode: null,
          paymentLink: null,
        },
      });
    }

    const immediateCharge = await createImmediateModuleCharge({
      contaId: customData.contaId,
      moduloOnContaId: vinculo.id,
      moduloNome: modulo.nome,
      billingMode,
    });

    return res.json({
      message:
        billingMode === "MENSAL"
          ? "App reservado com cobranca mensal imediata. Pague a cobranca avulsa para liberar o acesso neste ciclo."
          : "App reservado com cobranca proporcional ate o proximo vencimento. Pague a cobranca avulsa para liberar o acesso neste ciclo.",
      data: {
        recurringValue: recurringValue.toNumber(),
        billingMode,
        immediateCharge: immediateCharge.amount.toNumber(),
        paymentLink: immediateCharge.paymentLink,
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
}

export async function cancelStoreModule(req: Request, res: Response): Promise<any> {
  try {
    const customData = getCustomRequest(req).customData;
    const moduleId = Number(req.params.id);

    if (!moduleId) {
      return res.status(400).json({ message: "Modulo invalido." });
    }

    const [conta, vinculo] = await Promise.all([
      prisma.contas.findUniqueOrThrow({
        where: {
          id: customData.contaId,
        },
        select: {
          id: true,
          vencimento: true,
        },
      }),
      prisma.moduloOnConta.findUnique({
        where: {
          moduloId_contaId: {
            moduloId: moduleId,
            contaId: customData.contaId,
          },
        },
      }),
    ]);

    const statusAtual = vinculo?.status as ModuleStatus | undefined;

    if (!vinculo || statusAtual === "CANCELADO") {
      return res.status(404).json({ message: "Modulo nao esta vinculado a conta." });
    }

    let message =
      "Cancelamento agendado. O modulo continuara disponivel ate o fim da mensalidade ja paga.";

    if (statusAtual === "PENDENTE_ATIVACAO") {
      await cancelModuleCurrentCharge(vinculo.id);

      await prisma.moduloOnConta.update({
        where: {
          id: vinculo.id,
        },
        data: {
          status: "CANCELADO",
          canceladoEm: new Date(),
          solicitadoCancelamentoEm: null,
        },
      });

      message =
        "Solicitacao cancelada. O app foi removido da proxima mensalidade e a cobranca avulsa pendente foi encerrada.";
    } else if (statusAtual !== "CANCELAMENTO_AGENDADO") {
      await prisma.moduloOnConta.update({
        where: {
          id: vinculo.id,
        },
        data: {
          status: "CANCELAMENTO_AGENDADO",
          solicitadoCancelamentoEm: new Date(),
          vencimento: conta.vencimento,
        },
      });
    }

    const recurringValue = await syncContaRecurringBilling(customData.contaId);

    return res.json({
      message,
      data: {
        recurringValue: recurringValue.toNumber(),
        vigenteAte: conta.vencimento,
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
}
