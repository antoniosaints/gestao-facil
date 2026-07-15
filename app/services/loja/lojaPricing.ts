import Decimal from "decimal.js";

type PromoInput = {
  preco: Decimal.Value;
  precoPromocional?: Decimal.Value | null;
};

/**
 * Uma promoção só é válida quando o preço promocional está definido, é positivo e
 * é estritamente menor que o preço normal. Caso contrário, vale o preço normal.
 */
export function isPromoActive(product: PromoInput): boolean {
  if (product.precoPromocional === null || product.precoPromocional === undefined) return false;
  const promo = new Decimal(product.precoPromocional);
  return promo.greaterThan(0) && promo.lessThan(new Decimal(product.preco));
}

/** Preço efetivamente cobrado: promocional quando a promoção está ativa, senão o preço normal. */
export function storeEffectivePrice(product: PromoInput): Decimal {
  return isPromoActive(product) ? new Decimal(product.precoPromocional as Decimal.Value) : new Decimal(product.preco);
}
