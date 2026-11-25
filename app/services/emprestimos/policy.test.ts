import assert from "node:assert/strict";
import { test } from "node:test";
import { correspondeAoPagamento, cotarParcela, cronograma, dataFinanceira, dataValida, diaLocal, limiteCotacao, referenciaGateway, resumirClientePublico, simularParcelas, tipoComprovante } from "./policy";
import { criarSchema, diasSimulacaoSchema, filtrosTabelaSchema, pagamentoSchema, simularCriacaoSchema } from "./schemas";

test("a identificação do cliente no empréstimo público limita a exposição de documento e contato", () => {
  assert.deepEqual(resumirClientePublico({
    nome: " Mariana Souza ", documento: "529.982.247-25", email: "mariana@example.com", telefone: "+55 (11) 98765-4321",
  }), {
    nome: "Mariana Souza", documento: { tipo: "CPF", mascarado: "•••.•••.•••-25" },
    emailMascarado: "m•••@•••", telefoneMascarado: "••••-4321",
  });
  assert.deepEqual(resumirClientePublico({
    nome: "Horizonte", documento: "12.ABC.345/01DE-35", email: null, telefone: "1234",
  }), {
    nome: "Horizonte", documento: { tipo: "CNPJ", mascarado: "••.•••.•••/••••-35" },
    emailMascarado: null, telefoneMascarado: null,
  });
  assert.equal(resumirClientePublico({ nome: "Cliente", documento: "RG 123456", email: null, telefone: null }).documento, null);
});

test("distribui o principal e os juros simples até o último centavo sem parcelas negativas", () => {
  const principal = 10_001;
  const juros = 1_234;
  const parcelas = cronograma(principal, juros, 7, "2026-01-31");
  assert.equal(parcelas.reduce((total, p) => total + p.principalCentavos, 0), principal);
  assert.equal(parcelas.reduce((total, p) => total + p.jurosCentavos, 0), 1_234);
  const valores = parcelas.map((p) => p.principalCentavos + p.jurosCentavos);
  assert.ok(Math.max(...valores) - Math.min(...valores) <= 1);
  assert.ok(parcelas.every((p) => p.jurosCentavos >= 0));
  assert.deepEqual(parcelas.slice(0, 4).map((p) => diaLocal(p.vencimento)),
    ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  assert.deepEqual(cronograma(500, 0, 2, "2028-01-31").map((p) => diaLocal(p.vencimento)),
    ["2028-01-31", "2028-02-29"]);
});

test("desconta juros apenas antes do vencimento considerando o dia em São Paulo", () => {
  const [parcela] = cronograma(10_000, 1_000, 1, "2026-12-01");
  const p = { ...parcela, id: 42 };
  const condicoes = { descontoJurosBps: 5_000, jurosMoraBps: 0, multaBps: 0 };
  assert.equal(diaLocal(new Date("2026-12-01T01:00:00.000Z")), "2026-11-30");
  const antecipado = cotarParcela(p, condicoes, "2026-11-30");
  assert.equal(antecipado.descontoAntecipacaoCentavos, 500);
  assert.equal(antecipado.totalCentavos, 10_500);
  assert.equal(cotarParcela(p, { ...condicoes, descontoJurosBps: 10_000 }, "2026-11-30").totalCentavos, 10_000);
  assert.equal(cotarParcela(p, condicoes, "2026-12-01").totalCentavos, 11_000);
  assert.equal(cotarParcela(p, condicoes, "2026-12-10").totalCentavos, 11_000);
  assert.equal(limiteCotacao(p.vencimento, condicoes, "2026-11-30", 500)?.toISOString(), "2026-12-01T02:59:59.999Z");
  assert.equal(limiteCotacao(p.vencimento, condicoes, "2026-12-01", 0), null);
  assert.equal(dataValida("2026-02-30"), false);
  assert.equal(dataValida("2028-02-29"), true);
});

test("a antecipação em percentual ou valor funciona sem juros e respeita vencimento e desconto do contrato", () => {
  const [parcela] = cronograma(100_000, 0, 2, "2026-12-01", 20_000);
  const p = { ...parcela, id: 1 };
  const semJuros = { descontoJurosBps: 0, jurosMoraBps: 0, multaBps: 0 };
  const percentual = { ...semJuros, antecipacaoParcelaBps: 1_250 };
  const fixo = { ...semJuros, antecipacaoParcelaCentavos: 2_000 };
  assert.equal(cotarParcela(p, percentual, "2026-11-30").totalCentavos, 35_000);
  assert.equal(cotarParcela(p, fixo, "2026-11-30").totalCentavos, 38_000);
  assert.equal(cotarParcela(p, percentual, "2026-12-01").totalCentavos, 40_000);
  assert.equal(cotarParcela(p, fixo, "2026-12-02").totalCentavos, 40_000);
  assert.equal(cotarParcela(p, { ...percentual, antecipacaoParcelaBps: 10_000 }, "2026-11-30").totalCentavos, 1);
  assert.equal(cotarParcela(p, { ...fixo, antecipacaoParcelaCentavos: 100_000 }, "2026-11-30").totalCentavos, 1);
});

test("cobra multa única e juros diários somente após o vencimento, sobre a parcela após desconto fixo", () => {
  const parcelas = cronograma(100_001, 0, 2, "2026-11-30", 10_001);
  assert.deepEqual(parcelas.map((p) => p.descontoFixoCentavos), [5001, 5000]);
  const p = { ...parcelas[0], id: 1 };
  const q = { ...parcelas[1], id: 2 };
  const condicoes = { jurosMoraBps: 300, multaBps: 200, descontoJurosBps: 5_000 };
  assert.equal(cotarParcela(p, condicoes, "2026-11-29").totalCentavos, 45_000);
  assert.equal(cotarParcela(p, condicoes, "2026-11-30").totalCentavos, 45_000);
  assert.deepEqual(cotarParcela(p, condicoes, "2026-12-01"), {
    id: 1, numero: 1, nominalCentavos: 50_001, descontoFixoCentavos: 5_001, descontoAntecipacaoCentavos: 0,
    descontoCentavos: 5_001, diasAtraso: 1, multaCentavos: 900, jurosMoraCentavos: 45, totalCentavos: 45_945,
  });
  const atrasado = cotarParcela(p, condicoes, "2026-12-30");
  assert.equal(atrasado.multaCentavos, 900);
  assert.equal(atrasado.jurosMoraCentavos, 1350);
  assert.equal(atrasado.totalCentavos, 47_250);
  assert.equal(cotarParcela(q, condicoes, "2026-12-01").totalCentavos, 45_000);
  assert.equal(limiteCotacao(p.vencimento, condicoes, "2026-11-30", 0)?.toISOString(), "2026-12-01T02:59:59.999Z");
  assert.equal(limiteCotacao(p.vencimento, condicoes, "2026-12-01", 0)?.toISOString(), "2026-12-02T02:59:59.999Z");
  assert.equal(limiteCotacao(p.vencimento, { ...condicoes, jurosMoraBps: 0 }, "2026-12-01", 0), null);
});

test("simula cada vencimento com centavos exatos e mantém os recebimentos já registrados", () => {
  const saida = "2028-01-31";
  const parcelas = cronograma(100_001, 1_000, 3, saida, 10_001).map((parcela) => ({
    ...parcela, id: parcela.numero,
    recebidoEm: parcela.numero === 2 ? dataFinanceira("2028-02-25") : null,
    recebidoCentavos: parcela.numero === 2 ? 31_666 : null,
  }));
  const condicoes = { descontoJurosBps: 5_000, jurosMoraBps: 300, multaBps: 200 };
  const noPrazo = simularParcelas(parcelas, condicoes, saida, 0).parcelas;
  assert.deepEqual(noPrazo.map((p) => p.valorNoVencimentoCentavos), [33_333, 33_333, 33_334]);
  assert.deepEqual(noPrazo.map((p) => p.cotacao?.totalCentavos), [33_333, undefined, 33_334]);

  const [primeira, paga, terceira] = simularParcelas(parcelas, condicoes, saida, 30).parcelas;
  assert.equal(diaLocal(primeira.dataSimulada!), "2028-03-01");
  assert.equal(primeira.cotacao?.diasAtraso, 30);
  assert.equal(primeira.cotacao?.jurosMoraCentavos, 1000);
  assert.equal(primeira.cotacao?.multaCentavos, 667);
  assert.equal(primeira.cotacao?.totalCentavos, 35_000);
  assert.equal(diaLocal(paga.recebidoEm!), "2028-02-25");
  assert.equal(paga.recebidoCentavos, 31_666);
  assert.equal(paga.cotacao, null);
  assert.equal(paga.dataSimulada, null);
  assert.equal(terceira.cotacao?.totalCentavos, 35_001);

  const antecipadas = simularParcelas(parcelas, condicoes, saida, -30).parcelas;
  assert.equal(diaLocal(antecipadas[0].dataSimulada!), saida);
  assert.equal(antecipadas[0].cotacao?.descontoAntecipacaoCentavos, 0);
  assert.equal(antecipadas[2].cotacao?.descontoAntecipacaoCentavos, 1667);
});

test("permite simular sem cliente ou dados financeiros e valida o cronograma como no cadastro", () => {
  const termos = {
    principalCentavos: 500, dataSaida: "2026-11-24", primeiroVencimento: "2026-12-24",
    jurosBps: 0, numeroParcelas: 2, dias: 30,
  };
  assert.equal(simularCriacaoSchema.safeParse(termos).success, true);
  assert.equal(simularCriacaoSchema.safeParse({ ...termos, antecipacaoParcelaBps: 1250 }).success, true);
  assert.equal(simularCriacaoSchema.safeParse({ ...termos, antecipacaoParcelaCentavos: 25 }).success, true);
  assert.equal(simularCriacaoSchema.safeParse({ ...termos, antecipacaoParcelaBps: 1250, antecipacaoParcelaCentavos: 25 }).success, false);
  assert.equal(simularCriacaoSchema.safeParse({ ...termos, antecipacaoParcelaBps: 1250, descontoJurosBps: 500 }).success, false);
  assert.equal(simularCriacaoSchema.safeParse({ ...termos, primeiroVencimento: "2026-11-23" }).success, false);
  assert.equal(simularCriacaoSchema.safeParse({ ...termos, descontoFixoCentavos: 499 }).success, false);
  assert.equal(diasSimulacaoSchema.safeParse({ dias: -1.5 }).success, false);
  assert.equal(diasSimulacaoSchema.safeParse({ dias: 3651 }).success, false);
});

test("confere a referência, o valor, a moeda e o identificador do Mercado Pago", () => {
  const pagamento = { id: "pagamento", gatewayId: "81", totalCentavos: 10_517 };
  const provider = {
    id: 81, external_reference: referenciaGateway("pagamento"), currency_id: "BRL", transaction_amount: 105.17,
  };
  assert.equal(correspondeAoPagamento(provider, pagamento), true);
  assert.equal(correspondeAoPagamento({ ...provider, id: 82 }, pagamento), false);
  assert.equal(correspondeAoPagamento({ ...provider, external_reference: "outro" }, pagamento), false);
  assert.equal(correspondeAoPagamento({ ...provider, currency_id: "USD" }, pagamento), false);
  assert.equal(correspondeAoPagamento({ ...provider, transaction_amount: 105.18 }, pagamento), false);
});

test("valida as contas obrigatórias e recusa parcelas duplicadas na emissão do Pix", () => {
  const contrato = {
    chaveOperacao: "aa736359-36ca-4155-aa63-3ec7394a0cbc", clienteId: 1, principalCentavos: 10_000,
    dataSaida: "2026-11-24", primeiroVencimento: "2026-12-24", jurosBps: 1_000, numeroParcelas: 3,
    formaSaida: "PIX", contaSaidaId: null, contaEntradaId: null, categoriaId: null, lancamentoAutomatico: false,
  };
  assert.equal(criarSchema.safeParse(contrato).success, true);
  assert.equal(criarSchema.safeParse({ ...contrato, descontoJurosBps: 0, descontoFixoCentavos: 9997 }).success, true);
  assert.equal(criarSchema.safeParse({ ...contrato, descontoFixoCentavos: 9998 }).success, false);
  assert.equal(criarSchema.safeParse({ ...contrato, jurosMoraBps: -1 }).success, false);
  assert.equal(criarSchema.safeParse({ ...contrato, multaBps: 10_001 }).success, false);
  assert.equal(criarSchema.safeParse({ ...contrato, contaSaidaId: 4 }).success, false);
  assert.equal(criarSchema.safeParse({ ...contrato, lancamentoAutomatico: true }).success, false);
  assert.equal(criarSchema.safeParse({ ...contrato, primeiroVencimento: "2026-11-23" }).success, false);
  assert.equal(pagamentoSchema.safeParse({ metodo: "PIX_MANUAL", parcelas: [1, 1], totalCentavos: 1000 }).success, false);
  assert.equal(pagamentoSchema.safeParse({ metodo: "PIX_MANUAL", parcelas: [1], totalCentavos: 1000 }).success, true);
});

test("identifica os formatos de comprovante pelo conteúdo do arquivo", () => {
  assert.equal(tipoComprovante(Buffer.from("%PDF-1.7")), "application/pdf");
  assert.equal(tipoComprovante(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), "image/png");
  assert.equal(tipoComprovante(Buffer.from([255, 216, 255])), "image/jpeg");
  assert.equal(tipoComprovante(Buffer.from("<svg>")), null);
});

test("aceita filtros vazios ou de uma data e rejeita intervalos de vencimento inválidos", () => {
  assert.deepEqual(filtrosTabelaSchema.parse({ inicioVencimento: "", fimVencimento: "" }), {
    situacao: "TODOS", inicioVencimento: undefined, fimVencimento: undefined,
  });
  assert.equal(filtrosTabelaSchema.safeParse({ situacao: "QUITADO", fimVencimento: "2026-11-24" }).success, true);
  assert.equal(filtrosTabelaSchema.safeParse({ inicioVencimento: "2026-11-24", fimVencimento: "2026-11-24" }).success, true);
  assert.equal(filtrosTabelaSchema.safeParse({ inicioVencimento: "2026-11-25", fimVencimento: "2026-11-24" }).success, false);
  assert.equal(filtrosTabelaSchema.safeParse({ inicioVencimento: "2026-11-31" }).success, false);
  assert.equal(filtrosTabelaSchema.safeParse({ situacao: "DESCONHECIDO" }).success, false);
});
