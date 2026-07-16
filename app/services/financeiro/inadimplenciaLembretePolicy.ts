import { differenceInCalendarDays, startOfDay } from "date-fns";

/**
 * Regras puras (sem I/O) do menu de Inadimplência: resolvem QUAL agenda de lembretes
 * vale para um lançamento a receber e QUANDO um lembrete deve disparar.
 *
 * Convenção de `diasLembrete`: inteiros com sinal relativos ao vencimento da parcela.
 *   negativo = X dias ANTES do vencimento (ex.: -3 = "faltam 3 dias")
 *   0        = no dia do vencimento
 *   positivo = X dias DEPOIS do vencimento (ex.: 1 = "venceu ontem")
 * Assim o offset de disparo é `hoje - vencimento` (differenceInCalendarDays).
 */

export type CanalLembreteInadimplencia = "WHATSAPP" | "EMAIL" | "SMS";

export type LembreteCanais = {
  whatsapp: boolean;
  email: boolean;
  sms: boolean;
};

export type LembreteConfigInput = {
  ativo: boolean;
  diasLembrete: unknown;
  canalWhatsapp?: boolean | null;
  canalEmail?: boolean | null;
  canalSms?: boolean | null;
  mensagemCustom?: string | null;
} | null;

export type LembreteScheduleResolvido = {
  origem: "OVERRIDE_LANCAMENTO" | "CONFIG_CLIENTE" | "LEGADO";
  dias: number[];
  canais: LembreteCanais;
  mensagemCustom: string | null;
};

/** Padrão de fábrica (o "3, 1, dia + 1"), usado quando a conta não definiu um próprio. */
export const DEFAULT_LEMBRETE_DIAS = [-3, -1, 0, 1] as const;

/** Hora padrão de envio dos lembretes ao cliente quando a conta não configurou. */
export const DEFAULT_LEMBRETE_HORA = 10;

/** Limite de segurança para não gerar janelas absurdas de lembrete. */
export const MIN_DIA_OFFSET = -60;
export const MAX_DIA_OFFSET = 60;

/**
 * Somente o WhatsApp está implementado nesta versão. E-mail e SMS já existem como
 * "casca" (podem ser marcados na config e persistidos), mas não são entregues ainda.
 */
export const IMPLEMENTED_CHANNELS: CanalLembreteInadimplencia[] = ["WHATSAPP"];

export function isChannelImplemented(canal: CanalLembreteInadimplencia): boolean {
  return IMPLEMENTED_CHANNELS.includes(canal);
}

/**
 * Normaliza a lista de dias vinda do banco/entrada do usuário: aceita só inteiros,
 * remove duplicados, aplica o clamp de segurança e ordena (antes → depois).
 */
export function normalizeDiasLembrete(input: unknown): number[] {
  const raw = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? safeParseArray(input)
      : [];

  const unique = new Set<number>();
  for (const value of raw) {
    const n = Number(value);
    if (!Number.isInteger(n)) continue;
    if (n < MIN_DIA_OFFSET || n > MAX_DIA_OFFSET) continue;
    unique.add(n);
  }

  return Array.from(unique).sort((a, b) => a - b);
}

function safeParseArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function resolveCanais(config: NonNullable<LembreteConfigInput>): LembreteCanais {
  // WhatsApp é o default quando nada foi marcado, para não gerar config "muda".
  const whatsapp = config.canalWhatsapp ?? true;
  const email = config.canalEmail ?? false;
  const sms = config.canalSms ?? false;

  if (!whatsapp && !email && !sms) {
    return { whatsapp: true, email: false, sms: false };
  }

  return { whatsapp: Boolean(whatsapp), email: Boolean(email), sms: Boolean(sms) };
}

/**
 * Resolve a agenda efetiva de lembretes para um lançamento a receber, na ordem:
 *   1. override do lançamento (inclusive `ativo:false` para EXCLUIR só este lançamento);
 *   2. config padrão do cliente;
 *   3. flag legada `notificarClienteVencimento` → agenda padrão do sistema.
 * Retorna `null` quando não há lembrete a enviar.
 */
export function resolveLembreteSchedule(args: {
  override?: LembreteConfigInput;
  clienteConfig?: LembreteConfigInput;
  legacyFlag?: boolean | null;
  /** Agenda padrão da conta usada no fallback legado (senão, o padrão de fábrica). */
  defaultDias?: unknown;
}): LembreteScheduleResolvido | null {
  const { override, clienteConfig, legacyFlag } = args;

  if (override) {
    if (!override.ativo) return null; // opt-out explícito deste lançamento
    const dias = normalizeDiasLembrete(override.diasLembrete);
    if (!dias.length) return null;
    return {
      origem: "OVERRIDE_LANCAMENTO",
      dias,
      canais: resolveCanais(override),
      mensagemCustom: override.mensagemCustom?.trim() || null,
    };
  }

  if (clienteConfig && clienteConfig.ativo) {
    const dias = normalizeDiasLembrete(clienteConfig.diasLembrete);
    if (!dias.length) return null;
    return {
      origem: "CONFIG_CLIENTE",
      dias,
      canais: resolveCanais(clienteConfig),
      mensagemCustom: clienteConfig.mensagemCustom?.trim() || null,
    };
  }

  if (legacyFlag) {
    const defaultDias = normalizeDiasLembrete(args.defaultDias);
    return {
      origem: "LEGADO",
      dias: defaultDias.length ? defaultDias : [...DEFAULT_LEMBRETE_DIAS],
      canais: { whatsapp: true, email: false, sms: false },
      mensagemCustom: null,
    };
  }

  return null;
}

/** Offset de disparo de uma parcela: `hoje - vencimento` em dias de calendário. */
export function computeDueOffset(dueDate: Date, today = new Date()): number {
  return differenceInCalendarDays(startOfDay(today), startOfDay(dueDate));
}

/** O lembrete dispara hoje? (offset de hoje está na agenda) */
export function shouldRemindToday(
  dias: number[],
  dueDate: Date,
  today = new Date(),
): boolean {
  return dias.includes(computeDueOffset(dueDate, today));
}

/** Canais habilitados na config (independente de implementados ou não). */
export function getEnabledChannels(canais: LembreteCanais): CanalLembreteInadimplencia[] {
  const list: CanalLembreteInadimplencia[] = [];
  if (canais.whatsapp) list.push("WHATSAPP");
  if (canais.email) list.push("EMAIL");
  if (canais.sms) list.push("SMS");
  return list;
}

export type ReminderTemplateVars = {
  cliente: string;
  descricao: string;
  valor: string;
  vencimento: string;
  parcela: string;
};

/**
 * Aplica variáveis num template de mensagem custom. Suporta os placeholders
 * `{cliente}`, `{descricao}`, `{valor}`, `{vencimento}` e `{parcela}`
 * (case-insensitive). Placeholders desconhecidos são mantidos como estão.
 */
export function applyMensagemTemplate(template: string, vars: ReminderTemplateVars): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const normalized = key.toLowerCase() as keyof ReminderTemplateVars;
    return normalized in vars ? vars[normalized] : match;
  });
}

/** Rótulo amigável do offset para exibição ("faltam 3 dias", "vence hoje", ...). */
export function getOffsetLabel(offset: number): string {
  if (offset < 0) {
    const dias = Math.abs(offset);
    return dias === 1 ? "vence amanhã" : `faltam ${dias} dias`;
  }
  if (offset === 0) return "vence hoje";
  return offset === 1 ? "venceu ontem" : `venceu há ${offset} dias`;
}
