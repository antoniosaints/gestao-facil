type Party = {
  nome: string | null;
  documento: string | null;
  inscricaoEstadual: string | null;
  inscricaoMunicipal: string | null;
  telefone: string | null;
  endereco: string | null;
};
const object = (value: any): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
function party(value: any, fallback: any = {}): Party {
  const snapshot = object(value);
  const address = object(snapshot.endereco);
  const street = text(address.logradouro) || text(snapshot.endereco);
  const location = [
    text(snapshot.cidade) ||
      text(snapshot.nomeMunicipio) ||
      text(snapshot.municipio),
    text(address.uf) || text(snapshot.uf) || text(snapshot.estado),
  ]
    .filter(Boolean)
    .join(" - ");
  return {
    nome:
      text(snapshot.razaoSocial) || text(snapshot.nome) || text(fallback.nome),
    documento:
      text(snapshot.documento) ||
      text(snapshot.cpfCnpj) ||
      text(snapshot.cnpj) ||
      text(snapshot.cpf) ||
      text(fallback.documento),
    inscricaoEstadual: text(snapshot.ie) || text(snapshot.inscricaoEstadual),
    inscricaoMunicipal: text(snapshot.im) || text(snapshot.inscricaoMunicipal),
    telefone: text(snapshot.telefone),
    endereco:
      [
        street,
        text(address.numero) || text(snapshot.numero),
        text(address.complemento) || text(snapshot.complemento),
        text(address.bairro) || text(snapshot.bairro),
        location,
        text(address.cep) || text(snapshot.cep),
      ]
        .filter(Boolean)
        .join(", ") || null,
  };
}
function xmlBlock(xml: string, tag: string): string {
  return (
    new RegExp(
      `<(?:(?:[\\w.-]+):)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${tag}\\s*>`,
      "i",
    ).exec(xml)?.[1] || ""
  );
}
function xmlAmount(xml: string, ...tags: string[]): number | null {
  for (const tag of tags) {
    const value = xmlBlock(xml, tag).trim();
    if (/^-?\d+(?:[.,]\d+)?$/.test(value)) {
      const amount = Number(value.replace(",", "."));
      if (Number.isFinite(amount)) return amount;
    }
  }
  return null;
}

/** Projeção de leitura: não retorna envelopes, credenciais ou valores fiscais estimados. */
export function fiscalDocumentPresentation(invoice: any, xml = "") {
  const issuer = object(invoice.emitenteSnapshotJson);
  const recipient = object(invoice.destinatarioSnapshotJson);
  const nfse = invoice.tipo === "NFSE";
  const totals = nfse ? xml : xmlBlock(xml, "ICMSTot");
  const nature = xmlBlock(xmlBlock(xml, "ide"), "natOp")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
  return {
    modelo: invoice.modelo,
    codigoVerificacao: invoice.codigoVerificacao,
    naturezaOperacao:
      nature ||
      text(issuer.naturezaOperacao) ||
      (nfse
        ? "Prestação de serviços"
        : invoice.provedor === "GERANET_NFE"
          ? "Venda de mercadoria"
          : null),
    emitente: party(issuer),
    destinatario: party(recipient, invoice.Cliente),
    totais: {
      produtos: xmlAmount(
        totals,
        nfse ? "ValorServicos" : "vProd",
        ...(nfse ? ["vServ"] : []),
      ),
      frete: nfse ? null : xmlAmount(totals, "vFrete"),
      desconto: xmlAmount(
        totals,
        nfse ? "DescontoIncondicionado" : "vDesc",
        ...(nfse ? ["vDescIncond"] : []),
      ),
      valorNota:
        xmlAmount(
          totals,
          nfse ? "ValorLiquidoNfse" : "vNF",
          ...(nfse ? ["vLiq"] : []),
        ) ?? Number(invoice.valorTotal),
    },
    tributos: nfse
      ? [
          { label: "Base ISS", valor: xmlAmount(totals, "BaseCalculo") },
          { label: "ISS", valor: xmlAmount(totals, "ValorIss", "vISSQN") },
          {
            label: "ISS retido",
            valor: xmlAmount(totals, "ValorIssRetido", "vISSRet"),
          },
        ]
      : [
          { label: "Base ICMS", valor: xmlAmount(totals, "vBC") },
          { label: "ICMS", valor: xmlAmount(totals, "vICMS") },
          { label: "PIS", valor: xmlAmount(totals, "vPIS") },
          { label: "COFINS", valor: xmlAmount(totals, "vCOFINS") },
          { label: "IPI", valor: xmlAmount(totals, "vIPI") },
        ],
  };
}
