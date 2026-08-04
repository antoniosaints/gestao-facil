import Decimal from "decimal.js";

export interface DeliveryAddress {
  cep: string;
  cidade: string;
  bairro: string;
}

export interface DeliveryZoneCandidate {
  id: number;
  nome: string;
  cidade?: string | null;
  bairros: string[];
  cepInicial?: string | null;
  cepFinal?: string | null;
  taxa: Decimal.Value;
  pedidoMinimo: Decimal.Value;
  freteGratisAcima?: Decimal.Value | null;
  prioridade: number;
}

export function normalizeCep(value: string) {
  return value.replace(/\D/g, "").slice(0, 8);
}

export function normalizeLocation(value: string) {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

export function selectDeliveryZone(
  zones: DeliveryZoneCandidate[],
  address: DeliveryAddress,
): DeliveryZoneCandidate | null {
  const cep = normalizeCep(address.cep);
  const city = normalizeLocation(address.cidade);
  const neighborhood = normalizeLocation(address.bairro);

  return [...zones]
    .sort((a, b) => b.prioridade - a.prioridade || a.id - b.id)
    .find((zone) => {
      if (zone.cidade && normalizeLocation(zone.cidade) !== city) return false;
      if (zone.bairros.length && !zone.bairros.some((item) => normalizeLocation(item) === neighborhood)) return false;
      if (zone.cepInicial && cep < normalizeCep(zone.cepInicial)) return false;
      if (zone.cepFinal && cep > normalizeCep(zone.cepFinal)) return false;
      return true;
    }) || null;
}

export function calculateZoneDeliveryFee(zone: DeliveryZoneCandidate, subtotal: Decimal.Value) {
  const value = new Decimal(subtotal);
  if (zone.freteGratisAcima != null && value.greaterThanOrEqualTo(zone.freteGratisAcima)) {
    return new Decimal(0);
  }
  return new Decimal(zone.taxa).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}
