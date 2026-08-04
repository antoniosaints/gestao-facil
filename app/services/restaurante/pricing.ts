import Decimal from "decimal.js";

export type RegraPrecoSabores = "MAIOR_PRECO" | "MEDIA_PROPORCIONAL" | "SOMA";

export interface SelecaoPreco {
  tipo: "COMPLEMENTO" | "SABOR";
  nome: string;
  precoAdicional: Decimal.Value;
  proporcao?: Decimal.Value;
}

export function calcularPrecoUnitario(
  precoBase: Decimal.Value,
  selecoes: SelecaoPreco[],
  regra: RegraPrecoSabores,
) {
  const base = new Decimal(precoBase);
  const complementos = selecoes
    .filter((item) => item.tipo === "COMPLEMENTO")
    .reduce((total, item) => total.plus(item.precoAdicional), new Decimal(0));
  const sabores = selecoes.filter((item) => item.tipo === "SABOR");

  let adicionalSabores = new Decimal(0);
  if (sabores.length) {
    if (regra === "MAIOR_PRECO") {
      adicionalSabores = Decimal.max(...sabores.map((item) => new Decimal(item.precoAdicional)));
    } else if (regra === "SOMA") {
      adicionalSabores = sabores.reduce((total, item) => total.plus(item.precoAdicional), new Decimal(0));
    } else {
      const proporcaoInformada = sabores.some((item) => item.proporcao != null);
      const pesos = sabores.map((item) =>
        proporcaoInformada ? new Decimal(item.proporcao ?? 0) : new Decimal(1).div(sabores.length),
      );
      const somaPesos = pesos.reduce((total, peso) => total.plus(peso), new Decimal(0));
      if (!somaPesos.equals(1)) throw new Error("As proporcoes dos sabores devem totalizar 1.");
      adicionalSabores = sabores.reduce(
        (total, item, index) => total.plus(new Decimal(item.precoAdicional).mul(pesos[index])),
        new Decimal(0),
      );
    }
  }

  return base.plus(complementos).plus(adicionalSabores).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function calcularFrete(args: {
  subtotal: Decimal.Value;
  taxaFixa: Decimal.Value;
  freteGratisAcima?: Decimal.Value | null;
}) {
  const subtotal = new Decimal(args.subtotal);
  if (args.freteGratisAcima != null && subtotal.greaterThanOrEqualTo(args.freteGratisAcima)) {
    return new Decimal(0);
  }
  return new Decimal(args.taxaFixa).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}
