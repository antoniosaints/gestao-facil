import Decimal from "decimal.js";

export const formatCurrency = (value: any) => {
  const roundedValue = parseFloat(value.toFixed(2)); // Garante que o número tenha duas casas decimais
  return roundedValue.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
};
export function formatarValorMonetario(valorDecimal: any): string {
  const [inteiro, decimal] = valorDecimal.toFixed(2).split(".");

  const inteiroFormatado = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `R$ ${inteiroFormatado},${decimal}`;
}

export function formatarToRealValue(valor: Decimal | number): string {
  return `R$ ${new Decimal(valor).toFixed(2)}`;
}