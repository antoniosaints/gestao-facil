const dateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
});

export function diaLocal(date = new Date()) {
  return dateFormat.format(date);
}

export function dataFinanceira(dia: string) {
  return new Date(`${dia}T12:00:00-03:00`);
}

export function inicioDiaFinanceiro(dia: string) {
  return new Date(`${dia}T00:00:00-03:00`);
}

export function fimDiaFinanceiro(dia: string) {
  return new Date(`${dia}T23:59:59.999-03:00`);
}

export function dataValida(dia: string) {
  const date = dataFinanceira(dia);
  return Number.isFinite(date.getTime()) && date.toISOString().startsWith(`${dia}T`);
}

function distribuir(centavos: number, parcelas: number, indice: number) {
  return Math.floor(centavos / parcelas) + Number(indice < centavos % parcelas);
}

export function cronograma(principal: number, jurosBps: number, parcelas: number, primeiroVencimento: string, descontoFixo = 0) {
  const [ano, mes, dia] = primeiroVencimento.split("-").map(Number);
  const juros = Math.round(principal * jurosBps / 10_000);
  const total = principal + juros;
  return Array.from({ length: parcelas }, (_, i) => {
    const principalCentavos = distribuir(principal, parcelas, i);
    const totalCentavos = distribuir(total, parcelas, i);
    const ultimoDia = new Date(Date.UTC(ano, mes + i, 0)).getUTCDate();
    const date = new Date(Date.UTC(ano, mes - 1 + i, Math.min(dia, ultimoDia)));
    return {
      numero: i + 1,
      vencimento: dataFinanceira(date.toISOString().slice(0, 10)),
      principalCentavos,
      jurosCentavos: totalCentavos - principalCentavos,
      descontoFixoCentavos: distribuir(descontoFixo, parcelas, i),
    };
  });
}

type CondicoesPagamento = { descontoJurosBps: number; jurosMoraBps: number; multaBps: number };

export function cotarParcela(
  parcela: { id: number; numero: number; vencimento: Date; principalCentavos: number; jurosCentavos: number; descontoFixoCentavos: number },
  condicoes: CondicoesPagamento, diaPagamento: string,
) {
  const vencimento = diaLocal(parcela.vencimento);
  const diasAtraso = Math.max(0, (Date.parse(diaPagamento) - Date.parse(vencimento)) / 86_400_000);
  const nominalCentavos = parcela.principalCentavos + parcela.jurosCentavos;
  const { descontoFixoCentavos } = parcela;
  const base = nominalCentavos - descontoFixoCentavos;
  const descontoAntecipacaoCentavos = diaPagamento < vencimento
    ? Math.min(base - 1, Math.round(parcela.jurosCentavos * condicoes.descontoJurosBps / 10_000))
    : 0;
  const multaCentavos = diasAtraso ? Math.round(base * condicoes.multaBps / 10_000) : 0;
  const jurosMoraCentavos = Number((BigInt(base) * BigInt(condicoes.jurosMoraBps) * BigInt(diasAtraso) + 150_000n) / 300_000n);
  const descontoCentavos = descontoFixoCentavos + descontoAntecipacaoCentavos;
  return {
    id: parcela.id, numero: parcela.numero, nominalCentavos, diasAtraso,
    descontoFixoCentavos, descontoAntecipacaoCentavos, descontoCentavos, multaCentavos, jurosMoraCentavos,
    totalCentavos: nominalCentavos - descontoCentavos + multaCentavos + jurosMoraCentavos,
  };
}

export function limiteCotacao(
  vencimento: Date, condicoes: CondicoesPagamento, diaPagamento: string, descontoAntecipacaoCentavos: number,
) {
  const diaVencimento = diaLocal(vencimento);
  if (descontoAntecipacaoCentavos > 0) return new Date(inicioDiaFinanceiro(diaVencimento).getTime() - 1);
  const temEncargos = condicoes.jurosMoraBps || condicoes.multaBps;
  const ultimoDia = diaPagamento <= diaVencimento ? diaVencimento : diaPagamento;
  if (temEncargos && (diaPagamento <= diaVencimento || condicoes.jurosMoraBps)) {
    return fimDiaFinanceiro(ultimoDia);
  }
  return null;
}

export function tipoComprovante(bytes: Buffer) {
  if (bytes.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return "image/jpeg";
  return null;
}

export function referenciaGateway(id: string) {
  return `emprestimo:${id}`;
}

export function correspondeAoPagamento(
  provider: { id?: number; external_reference?: string; currency_id?: string; transaction_amount?: number },
  payment: { id: string; gatewayId: string | null; totalCentavos: number },
) {
  const amount = provider.transaction_amount;
  return !!provider.id && (!payment.gatewayId || String(provider.id) === payment.gatewayId)
    && provider.external_reference === referenciaGateway(payment.id)
    && provider.currency_id === "BRL" && typeof amount === "number"
    && Math.abs(amount * 100 - payment.totalCentavos) < 0.000_001;
}
