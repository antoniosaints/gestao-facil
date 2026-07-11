import Decimal from "decimal.js";
import { prisma } from "../../utils/prisma";
import { syncContaRecurringBilling } from "./storeModulesService";

export type TipoRecompensaIndicacao = "PERCENTUAL" | "VALOR";

export interface IndicacaoConfig {
  ativa: boolean;
  tipoRecompensa: TipoRecompensaIndicacao;
  valorRecompensa: Decimal;
  tipoBonusIndicado: TipoRecompensaIndicacao;
  valorBonusIndicado: Decimal;
}

function normalizeTipo(value?: string | null): TipoRecompensaIndicacao {
  return value === "VALOR" ? "VALOR" : "PERCENTUAL";
}

// Calcula a recompensa/bônus: PERCENTUAL = % sobre a base; VALOR = valor fixo.
export function computeRecompensa(
  tipo: TipoRecompensaIndicacao,
  valorConfig: Decimal | number,
  base: Decimal | number,
): Decimal {
  const cfg = new Decimal(valorConfig || 0);
  const baseDec = new Decimal(base || 0);
  const bruto = tipo === "PERCENTUAL" ? baseDec.times(cfg).div(100) : cfg;
  return Decimal.max(0, bruto).toDecimalPlaces(2);
}

// Config global fica na ParametrosConta da conta do superadmin (mesmo padrão do gateway).
export async function getPlatformIndicacaoConfig(): Promise<IndicacaoConfig> {
  const config = await prisma.parametrosConta.findFirst({
    where: {
      Contas: {
        Usuarios: {
          some: { superAdmin: true },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      indicacaoAtiva: true,
      indicacaoTipoRecompensa: true,
      indicacaoValorRecompensa: true,
      indicacaoTipoBonusIndicado: true,
      indicacaoValorBonusIndicado: true,
    },
  });

  return {
    ativa: Boolean(config?.indicacaoAtiva),
    tipoRecompensa: normalizeTipo(config?.indicacaoTipoRecompensa),
    valorRecompensa: new Decimal(config?.indicacaoValorRecompensa ?? 0),
    tipoBonusIndicado: normalizeTipo(config?.indicacaoTipoBonusIndicado),
    valorBonusIndicado: new Decimal(config?.indicacaoValorBonusIndicado ?? 0),
  };
}

function gerarCodigo(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let codigo = "";
  for (let i = 0; i < 8; i++) codigo += chars[Math.floor(Math.random() * chars.length)];
  return codigo;
}

// Gera (e persiste) um código único de indicação; backfill para contas antigas.
export async function getOrCreateCodigoIndicacao(contaId: number): Promise<string> {
  const conta = await prisma.contas.findUniqueOrThrow({
    where: { id: contaId },
    select: { codigoIndicacao: true },
  });
  if (conta.codigoIndicacao) return conta.codigoIndicacao;

  for (let tentativa = 0; tentativa < 8; tentativa++) {
    const codigo = gerarCodigo();
    const existente = await prisma.contas.findUnique({
      where: { codigoIndicacao: codigo },
      select: { id: true },
    });
    if (existente) continue;
    try {
      await prisma.contas.update({ where: { id: contaId }, data: { codigoIndicacao: codigo } });
      return codigo;
    } catch {
      // colisão em corrida — tenta novamente
    }
  }
  throw new Error("Não foi possível gerar um código de indicação.");
}

// Resolve o código de indicação para a conta indicadora, exigindo conta ATIVA.
export async function resolverIndicador(codigo?: string | null): Promise<number | null> {
  const normalizado = String(codigo || "").trim().toUpperCase();
  if (!normalizado) return null;
  const conta = await prisma.contas.findUnique({
    where: { codigoIndicacao: normalizado },
    select: { id: true, status: true },
  });
  if (!conta || conta.status !== "ATIVO") return null;
  return conta.id;
}

// No cadastro: vincula o indicado ao indicador e credita o bônus do indicado (se ativo).
// Não usa transação externa para manter simples; chame após criar a conta.
export async function vincularIndicacaoNoCadastro(params: {
  novaContaId: number;
  indicadorContaId: number;
  valorBasePlano: Decimal | number;
}): Promise<void> {
  if (params.indicadorContaId === params.novaContaId) return;

  const config = await getPlatformIndicacaoConfig();
  const bonus = config.ativa
    ? computeRecompensa(config.tipoBonusIndicado, config.valorBonusIndicado, params.valorBasePlano)
    : new Decimal(0);

  await prisma.contas.update({
    where: { id: params.novaContaId },
    data: {
      indicadoPorContaId: params.indicadorContaId,
      ...(bonus.gt(0) ? { creditoIndicacao: { increment: bonus.toNumber() } } : {}),
    },
  });
}

// No pagamento do indicado (1ª vez): credita a recompensa ao indicador e marca como recompensada.
export async function concederRecompensaIndicador(params: {
  contaPaganteId: number;
  valorPago: Decimal | number;
  faturaId?: number | null;
}): Promise<void> {
  const conta = await prisma.contas.findUnique({
    where: { id: params.contaPaganteId },
    select: { id: true, indicadoPorContaId: true, indicacaoRecompensada: true },
  });
  if (!conta?.indicadoPorContaId || conta.indicacaoRecompensada) return;

  const config = await getPlatformIndicacaoConfig();
  if (!config.ativa) return;

  const recompensa = computeRecompensa(config.tipoRecompensa, config.valorRecompensa, params.valorPago);

  await prisma.$transaction([
    prisma.contas.update({
      where: { id: conta.id },
      data: { indicacaoRecompensada: true },
    }),
    prisma.contas.update({
      where: { id: conta.indicadoPorContaId },
      data: { creditoIndicacao: { increment: recompensa.toNumber() } },
    }),
    prisma.indicacaoRecompensa.create({
      data: {
        indicadorContaId: conta.indicadoPorContaId,
        indicadoContaId: conta.id,
        tipo: config.tipoRecompensa,
        valor: recompensa.toFixed(2),
        faturaId: params.faturaId ?? null,
      },
    }),
  ]);

  // Atualiza a mensalidade do indicador para refletir o novo crédito.
  await syncContaRecurringBilling(conta.indicadoPorContaId).catch((error) => {
    console.error(`[indicacao] Falha ao sincronizar mensalidade do indicador ${conta.indicadoPorContaId}`, error);
  });
}
