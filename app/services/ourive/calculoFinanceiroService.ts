import Decimal from "decimal.js";

export type CalculoFinanceiroOuriveInput = {
  valorBruto: Decimal.Value;
  custoMaterialLoja: Decimal.Value;
  outrosCustos?: Decimal.Value;
  percentualLoja: Decimal.Value;
  percentualOurives: Decimal.Value;
};

export type MemoriaCalculoFinanceiroOurive = {
  valorBruto: string;
  custoMaterialLoja: string;
  outrosCustos: string;
  baseDivisao: string;
  percentualLoja: string;
  percentualOurives: string;
  valorLoja: string;
  valorOurives: string;
};

const decimal = (value: Decimal.Value) => new Decimal(value || 0);
const money = (value: Decimal) => value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const percentage = (value: Decimal.Value) => decimal(value).toDecimalPlaces(2);

export function calcularFinanceiroOurive(
  input: CalculoFinanceiroOuriveInput,
): MemoriaCalculoFinanceiroOurive {
  const percentualLoja = percentage(input.percentualLoja);
  const percentualOurives = percentage(input.percentualOurives);

  if (!percentualLoja.plus(percentualOurives).equals(100)) {
    throw new Error("ourive_invalid_percentage_split");
  }

  const valorBruto = money(decimal(input.valorBruto));
  const custoMaterialLoja = money(decimal(input.custoMaterialLoja));
  const outrosCustos = money(decimal(input.outrosCustos || 0));
  const baseDivisao = Decimal.max(
    0,
    money(valorBruto.minus(custoMaterialLoja).minus(outrosCustos)),
  );
  const valorLoja = money(baseDivisao.mul(percentualLoja).div(100));
  const valorOurives = money(baseDivisao.minus(valorLoja));

  return {
    valorBruto: valorBruto.toFixed(2),
    custoMaterialLoja: custoMaterialLoja.toFixed(2),
    outrosCustos: outrosCustos.toFixed(2),
    baseDivisao: baseDivisao.toFixed(2),
    percentualLoja: percentualLoja.toFixed(2),
    percentualOurives: percentualOurives.toFixed(2),
    valorLoja: valorLoja.toFixed(2),
    valorOurives: valorOurives.toFixed(2),
  };
}

export function dividirRepasseOurives(
  valorTotal: Decimal.Value,
  usuarioIds: number[],
) {
  const ids = [...new Set(usuarioIds.map(Number).filter((id) => id > 0))].sort(
    (a, b) => a - b,
  );
  if (!ids.length) throw new Error("ourive_responsible_required");

  const totalCentavos = money(decimal(valorTotal)).mul(100).toDecimalPlaces(0).toNumber();
  const baseCentavos = Math.floor(totalCentavos / ids.length);
  let restante = totalCentavos - baseCentavos * ids.length;

  return ids.map((usuarioId) => {
    const centavos = baseCentavos + (restante-- > 0 ? 1 : 0);
    return { usuarioId, valor: new Decimal(centavos).div(100).toFixed(2) };
  });
}
