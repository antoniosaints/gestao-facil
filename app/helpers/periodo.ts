const SOMENTE_DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Converte o valor de um filtro de período em Date.
 *
 * `new Date("2026-07-01")` é interpretado como meia-noite **UTC** pela spec. Em um
 * servidor com fuso negativo (BRT = UTC-3) isso vira 30/06 21:00 local, e o
 * startOfDay/endOfDay seguinte joga a janela inteira um dia para trás. Com o horário
 * explícito o parse acontece no fuso local e o dia escolhido é respeitado.
 *
 * Valores que já trazem hora (ISO completo, `toDateString()`) passam direto.
 */
export function parseDataFiltro(valor: string): Date {
  const texto = String(valor).trim();
  return new Date(SOMENTE_DATA.test(texto) ? `${texto}T00:00:00` : texto);
}
