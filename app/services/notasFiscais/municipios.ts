type IbgeMunicipio = { id: number; nome: string };
type MunicipioFiscal = { codigoIbge: string; nome: string; uf: string };

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; values: MunicipioFiscal[] }>();

function normalizar(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

export async function consultarMunicipiosIbge(uf: string, busca: string) {
  const estado = uf.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(estado)) throw new Error("Informe uma UF válida.");
  const termo = busca.trim();
  if (termo.length < 2) throw new Error("Informe ao menos 2 caracteres para consultar o município.");

  let entry = cache.get(estado);
  if (!entry || entry.expiresAt < Date.now()) {
    const response = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${estado}/municipios`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error("A consulta de municípios do IBGE está indisponível.");
    const municipalities = (await response.json()) as IbgeMunicipio[];
    entry = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      values: municipalities.map((item) => ({ codigoIbge: String(item.id), nome: item.nome, uf: estado })),
    };
    cache.set(estado, entry);
  }

  const normalized = normalizar(termo);
  return entry.values.filter((item) => normalizar(item.nome).includes(normalized)).slice(0, 30);
}
