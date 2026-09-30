import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGeranetNfsePayload, buildGeranetNfsePdfPayload, buildGeranetNfseCancelPayload, fiscalArtifactBytes, geranetNfseSchema, validateGeranetNfseRules, isConfirmedGeranetRejection } from './geranetNfsePolicy';
const config = { regimeTributario: 1, nfseDataOpcaoSimples: '2020-01-01', nfseRegimeApuracaoSn: '2', codigoMunicipioIbge: '1702109', municipioNome: 'Araguaína', ambiente: 'HOMOLOGACAO', serieRps: 3, codigoServicoPadrao: '0604', nfseCodigoServicoNacional: '060401', nfseCodigoTributacaoMunicipio: '604', aliquotaIssPadrao: 2, nfseIssRetido: '2' };
const input = () => geranetNfseSchema.parse({ clienteId: 1, valorTotal: 100, discriminacao: 'Serviço de manutenção', percentualTributosSimplesNacional: 6 });
const invoice = { id: 9, rpsNumero: '2', ambiente: 'PRODUCAO', emitenteSnapshotJson: { municipio: '1702109' }, requisicaoJson: { padraoNacional: 'nao' } };

test('Simples total não reutiliza a alíquota ISS nem o regime de apuração', () => {
  const payload = buildGeranetNfsePayload(config, input(), invoice, invoice.emitenteSnapshotJson, {}, true);
  assert.equal(payload.servico.aliquota, '2.00');
  assert.equal(payload.servico.tributacao?.percentualTributosSimplesNacional, '6.00');
  assert.equal(payload.regimeApuracaoSN, '2');
  assert.equal(payload.padraoNacional, 'sim');
  assert.equal(payload.servico.itemListaServico, '0604');
  assert.equal(payload.servico.codigoServicoNacional, '060401');
  assert.equal(payload.servico.codigoTributacaoMunicipio, '604');
  assert.equal('totaisTributos' in payload.servico.tributacao!, false);
});
test('bloqueia Simples nacional sem percentual próprio, mas não impõe percentual ao município', () => {
  const data = geranetNfseSchema.parse({ ...input(), percentualTributosSimplesNacional: null });
  assert.match(validateGeranetNfseRules(config, data, true)!, /diferente da alíquota/);
  assert.equal(validateGeranetNfseRules(config, data, false), null);
  assert.match(validateGeranetNfseRules({ ...config, regimeTributario: 0 }, data, false)!, /regime tributário/);
});
test('ISS retido precisa de responsável e usa o valor informado ou cálculo da alíquota', () => {
  const retained = { ...config, nfseIssRetido: '1', nfseResponsavelRetencao: '1' };
  assert.match(validateGeranetNfseRules({ ...retained, nfseResponsavelRetencao: '4' }, input(), true)!, /responsável/);
  assert.equal(buildGeranetNfsePayload(retained, input(), invoice, {}, {}, false).servico.valorIssRetido, '2.00');
  assert.equal(buildGeranetNfsePayload(retained, { ...input(), valorIssRetido: 3 }, invoice, {}, {}, false).servico.valorIssRetido, '3.00');
  assert.match(validateGeranetNfseRules(retained, { ...input(), valorIssRetido: 101 }, true)!, /ultrapassar/);
});
test('competência, incidência, NBS e tomador são dados independentes', () => {
  const data = geranetNfseSchema.parse({ ...input(), dataCompetencia: '2026-09-29', municipioIncidencia: '3550308', codigoNbs: '123', substitutoTributario: '1' });
  const payload = buildGeranetNfsePayload(config, data, invoice, {}, { municipio: '3550308' }, false);
  assert.equal(payload.padraoNacional, 'nao');
  assert.equal(payload.dataCompetencia, '2026-09-29');
  assert.equal(payload.servico.codigoNBS, '123');
  assert.equal(payload.servico.municipioIncidencia, '3550308');
  assert.equal(payload.servico.descricaoLocalidadeIncidencia, undefined);
  assert.equal(payload.tomador.substitutoTributario, '1');
  assert.equal(geranetNfseSchema.safeParse({ ...input(), dataCompetencia: '2026-02-30' }).success, false);
  assert.equal(geranetNfseSchema.safeParse({ ...input(), municipioIncidencia: '123' }).success, false);
});
test('IBS/CBS é opcional e usa nomes e precisão do contrato Geranet', () => {
  const rates = { aliquota: 0.1, reducaoAliquota: 25 };
  const ibscbs = { finNFSe: '0', cst: '000', cIndOp: '100401', indFinal: '1', indDest: '0', indOpeOne: '0', ibsEstadual: rates, ibsMunicipal: rates, cbsFederal: { ...rates, aliquota: 0.9 } };
  const data = geranetNfseSchema.parse({ ...input(), ibscbs });
  const tax = buildGeranetNfsePayload(config, data, invoice, {}, {}, true).servico.tributacao!.ibscbs!;
  assert.deepEqual(tax.ibsEstadual, { percentualIbs: '0.1000', percentualReducaoAliquota: '25.0000' });
  assert.equal(tax.cbsFederal.percentualCbs, '0.9000');
  assert.equal(geranetNfseSchema.safeParse({ ...input(), ibscbs: { ...ibscbs, cIndOp: '12' } }).success, false);
  assert.equal(buildGeranetNfsePayload(config, input(), invoice, {}, {}, true).servico.tributacao?.ibscbs, undefined);
});
test('PDF e cancelamento usam município, ambiente e padrão da nota original', () => {
  const xml = Buffer.from('<NFSe>autorizada</NFSe>');
  assert.deepEqual(buildGeranetNfsePdfPayload(invoice, xml), { ambiente: '1', codigoMunicipio: '1702109', nomeSistema: 'Gestão Fácil', xml: xml.toString('hex') });
  const cancel = buildGeranetNfseCancelPayload(invoice, xml, 'Erro no serviço informado', '3');
  assert.equal(cancel.ambiente, '1'); assert.equal(cancel.padraoNacional, 'nao'); assert.equal(cancel.codigoCancelamento, '3'); assert.equal(cancel.motivoCancelamento, 'Erro no serviço informado');
  assert.throws(() => buildGeranetNfsePdfPayload({ ...invoice, emitenteSnapshotJson: {} }, xml), /IBGE/);
});
test('arquivos fiscais aceitam XML texto/hex e PDF hex, rejeitando resposta inválida', () => {
  const xml = '<NFSe />'; const pdf = Buffer.from('%PDF-1.4\n');
  assert.equal(fiscalArtifactBytes(xml, 'xml').toString(), xml);
  assert.equal(fiscalArtifactBytes(Buffer.from(xml).toString('hex'), 'xml').toString(), xml);
  assert.deepEqual(fiscalArtifactBytes(pdf.toString('hex'), 'pdf'), pdf);
  assert.throws(() => fiscalArtifactBytes('erro do provedor', 'xml'), /inválido/);
  assert.throws(() => fiscalArtifactBytes('7b7d', 'pdf'), /inválido/);
});
test('timeout e HTTP 5xx permanecem incertos, sem permitir reemissão como rejeição', () => {
  assert.equal(isConfirmedGeranetRejection({ response: { status: 422, data: { situacao: 'erro' } } }), true);
  assert.equal(isConfirmedGeranetRejection({ response: { status: 503, data: { situacao: 'erro' } } }), false);
  assert.equal(isConfirmedGeranetRejection({ code: 'ECONNRESET' }), false);
});

test('Petrolina EL 2.04 exige códigos distintos e não aceita NBS', () => {
  const city = { nome: 'Petrolina', uf: 'PE', provedor: 'EL', versao: '2.04' };
  assert.equal(validateGeranetNfseRules(config, input(), false, city), null);
  assert.match(validateGeranetNfseRules(config, { ...input(), codigoNbs: '123' }, false, city)!, /não aceita/);
  assert.match(validateGeranetNfseRules(config, { ...input(), codigoServico: '123' }, false, city)!, /4 dígitos/);
});
