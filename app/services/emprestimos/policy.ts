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

export function resumirClientePublico(cliente: {
  nome: string;
  documento: string | null;
  email: string | null;
  telefone: string | null;
}) {
  const identificacao = cliente.documento?.trim().replace(/[.\/-]/g, "") ?? "";
  const finalDocumento = identificacao.slice(-2);
  let documento: { tipo: "CPF" | "CNPJ"; mascarado: string } | null = null;
  if (/^\d{11}$/.test(identificacao)) {
    documento = { tipo: "CPF", mascarado: `•••.•••.•••-${finalDocumento}` };
  } else if (/^[a-z0-9]{12}\d{2}$/i.test(identificacao)) {
    documento = { tipo: "CNPJ", mascarado: `••.•••.•••/••••-${finalDocumento}` };
  }

  const email = cliente.email?.trim().match(/^([^\s@])[^\s@]*@[^\s@]+\.[^\s@]+$/u);
  const telefone = cliente.telefone?.replace(/\D/g, "") ?? "";
  return {
    nome: cliente.nome.trim(),
    documento,
    emailMascarado: email ? `${email[1]}•••@•••` : null,
    telefoneMascarado: /^\d{8,13}$/.test(telefone) ? `••••-${telefone.slice(-4)}` : null,
  };
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

type CondicoesPagamento = {
  descontoJurosBps: number; jurosMoraBps: number; multaBps: number;
  antecipacaoParcelaBps?: number; antecipacaoParcelaCentavos?: number;
};
type ParcelaCotavel = {
  id: number; numero: number; vencimento: Date; principalCentavos: number;
  jurosCentavos: number; descontoFixoCentavos: number;
};

export function cotarParcela(
  parcela: ParcelaCotavel,
  condicoes: CondicoesPagamento, diaPagamento: string,
) {
  const vencimento = diaLocal(parcela.vencimento);
  const diasAtraso = Math.max(0, (Date.parse(diaPagamento) - Date.parse(vencimento)) / 86_400_000);
  const nominalCentavos = parcela.principalCentavos + parcela.jurosCentavos;
  const { descontoFixoCentavos } = parcela;
  const base = nominalCentavos - descontoFixoCentavos;
  let descontoAntecipacaoCentavos = 0;
  if (diaPagamento < vencimento) {
    const { antecipacaoParcelaBps, antecipacaoParcelaCentavos, descontoJurosBps } = condicoes;
    const abatimento = antecipacaoParcelaCentavos || (antecipacaoParcelaBps
      ? Math.round(base * antecipacaoParcelaBps / 10_000)
      : Math.round(parcela.jurosCentavos * descontoJurosBps / 10_000));
    descontoAntecipacaoCentavos = Math.max(0, Math.min(base - 1, abatimento));
  }
  const multaCentavos = diasAtraso ? Math.round(base * condicoes.multaBps / 10_000) : 0;
  const jurosMoraCentavos = Number((BigInt(base) * BigInt(condicoes.jurosMoraBps) * BigInt(diasAtraso) + 150_000n) / 300_000n);
  const descontoCentavos = descontoFixoCentavos + descontoAntecipacaoCentavos;
  return {
    id: parcela.id, numero: parcela.numero, nominalCentavos, diasAtraso,
    descontoFixoCentavos, descontoAntecipacaoCentavos, descontoCentavos, multaCentavos, jurosMoraCentavos,
    totalCentavos: nominalCentavos - descontoCentavos + multaCentavos + jurosMoraCentavos,
  };
}

export function simularParcelas(
  parcelas: (ParcelaCotavel & { recebidoEm?: Date | null; recebidoCentavos?: number | null })[],
  condicoes: CondicoesPagamento, dataSaida: string, dias: number,
) {
  const saida = Date.parse(dataSaida);
  const ultimaData = Date.parse("9999-12-31");
  return {
    descontoJurosBps: condicoes.descontoJurosBps,
    antecipacaoParcelaBps: condicoes.antecipacaoParcelaBps ?? 0,
    antecipacaoParcelaCentavos: condicoes.antecipacaoParcelaCentavos ?? 0,
    parcelas: parcelas.map((parcela) => {
      const { numero, vencimento, principalCentavos, jurosCentavos, descontoFixoCentavos } = parcela;
      const base = principalCentavos + jurosCentavos - descontoFixoCentavos;
      const recebidoEm = parcela.recebidoEm ?? null;
      const dataAlvo = Date.parse(diaLocal(vencimento)) + dias * 86_400_000;
      const diaSimulado = new Date(Math.min(ultimaData, Math.max(saida, dataAlvo))).toISOString().slice(0, 10);
      return {
        numero, vencimento, principalCentavos, jurosCentavos, descontoFixoCentavos,
        valorNoVencimentoCentavos: base, recebidoEm, recebidoCentavos: parcela.recebidoCentavos ?? null,
        dataSimulada: recebidoEm ? null : dataFinanceira(diaSimulado),
        cotacao: recebidoEm ? null : cotarParcela(parcela, condicoes, diaSimulado),
      };
    }),
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
