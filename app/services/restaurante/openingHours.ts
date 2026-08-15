export type RestaurantBusinessDay = "SEGUNDA" | "TERCA" | "QUARTA" | "QUINTA" | "SEXTA" | "SABADO" | "DOMINGO";

export type RestaurantOpeningHour = {
  dia: RestaurantBusinessDay;
  ativo: boolean;
  abertura: string;
  fechamento: string;
};

const days: RestaurantBusinessDay[] = ["DOMINGO", "SEGUNDA", "TERCA", "QUARTA", "QUINTA", "SEXTA", "SABADO"];
const dayLabels: Record<RestaurantBusinessDay, string> = {
  SEGUNDA: "segunda-feira", TERCA: "terça-feira", QUARTA: "quarta-feira", QUINTA: "quinta-feira", SEXTA: "sexta-feira", SABADO: "sábado", DOMINGO: "domingo",
};

function minutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const result = Number(match[1]) * 60 + Number(match[2]);
  return result >= 0 && result < 1440 ? result : null;
}

function localNow(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || "";
  const day: Record<string, RestaurantBusinessDay> = {
    Sunday: "DOMINGO", Monday: "SEGUNDA", Tuesday: "TERCA", Wednesday: "QUARTA", Thursday: "QUINTA", Friday: "SEXTA", Saturday: "SABADO",
  };
  return { day: day[value("weekday")], minute: Number(value("hour")) * 60 + Number(value("minute")) };
}

export function restaurantOpenNow(hours: unknown, now = new Date()) {
  if (!Array.isArray(hours) || !hours.length) {
    return { aberto: true, mensagem: "Recebendo pedidos", configurado: false };
  }
  const valid = hours.filter((item): item is RestaurantOpeningHour => {
    const value = item as RestaurantOpeningHour;
    return Boolean(value?.dia && typeof value.ativo === "boolean" && minutes(value.abertura) != null && minutes(value.fechamento) != null);
  });
  if (!valid.length) return { aberto: true, mensagem: "Recebendo pedidos", configurado: false };

  const byDay = new Map(valid.map((hour) => [hour.dia, hour]));
  const current = localNow(now);
  const today = byDay.get(current.day);
  const previous = byDay.get(days[(days.indexOf(current.day) + 6) % days.length]);
  const inWindow = (hour?: RestaurantOpeningHour, fromPreviousDay = false) => {
    if (!hour?.ativo) return false;
    const open = minutes(hour.abertura)!;
    const close = minutes(hour.fechamento)!;
    if (open === close) return false;
    if (open < close) return !fromPreviousDay && current.minute >= open && current.minute < close;
    return fromPreviousDay ? current.minute < close : current.minute >= open;
  };
  if (inWindow(today) || inWindow(previous, true)) return { aberto: true, mensagem: "Recebendo pedidos", configurado: true };
  if (!today?.ativo) return { aberto: false, mensagem: `Fechado hoje (${dayLabels[current.day]}).`, configurado: true };
  return { aberto: false, mensagem: `Fechado no momento. Atendimento hoje: ${today.abertura} às ${today.fechamento}.`, configurado: true };
}
