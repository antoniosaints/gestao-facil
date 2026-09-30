import axios, { type AxiosInstance } from "axios";

export type GeranetCity = { codigoIbge: string; nome: string; uf: string; provedor: string; versao?: string };
const sessions = new Map<string, { cookie: string; csrf: string; expiresAt: number }>();
const cache = new Map<string, { values: GeranetCity[]; expiresAt: number }>();

export function normalizeGeranetCities(response: any): GeranetCity[] {
  if (response?.situacao !== "sucesso" || !Array.isArray(response.registros)) throw new Error(response?.mensagem || "Resposta inválida da consulta de cidades Geranet.");
  return response.registros.map((item: any) => ({
    codigoIbge: String(item.codigoIbge ?? "").trim(), nome: String(item.nome ?? "").trim(), uf: String(item.uf ?? "").trim().toUpperCase(),
    provedor: String(item.provedor ?? "").trim(), ...(item.versao ? { versao: String(item.versao) } : {}),
  })).filter((item: GeranetCity) => /^\d{7}$/.test(item.codigoIbge) && item.nome && /^[A-Z]{2}$/.test(item.uf));
}

export async function searchGeranetCities(baseURL: string, search: string, limit = 30, transport: Pick<AxiosInstance, "get" | "post"> = axios): Promise<GeranetCity[]> {
  const nome = search.trim();
  if (nome.length < 2 || nome.length > 120 || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("Informe de 2 a 120 caracteres e limite de 1 a 50 cidades.");
  const origin = new URL(baseURL).origin;
  const cacheKey = `${origin}:${nome.toLocaleLowerCase()}:${limit}`;
  const cached = cache.get(cacheKey);
  if (transport === axios && cached && cached.expiresAt > Date.now()) return cached.values;
  for (let attempt = 0; attempt < 2; attempt++) {
    let session = transport === axios ? sessions.get(origin) : undefined;
    if (!session || session.expiresAt <= Date.now()) {
      const page = await transport.get<string>(`${origin}/`, { timeout: 15_000, headers: { Accept: "text/html" } });
      const meta = page.data.match(/<meta\b[^>]*name=["']csrf-token["'][^>]*>/i)?.[0];
      const csrf = meta?.match(/content=["']([^"']+)["']/i)?.[1]
        || page.data.match(/["']X-CSRF-TOKEN["']\s*:\s*["']([a-zA-Z0-9_-]+)["']/i)?.[1];
      const cookie = (page.headers["set-cookie"] || []).map((value: string) => value.split(";")[0]).join("; ");
      if (!csrf || !cookie) throw new Error("Não foi possível iniciar a consulta pública de cidades Geranet.");
      session = { cookie, csrf, expiresAt: Date.now() + 10 * 60_000 };
      if (transport === axios) sessions.set(origin, session);
    }
    try {
      // Esta rota web pública usa sessão e CSRF. Não reutilize o cliente fiscal autenticado.
      const { data } = await transport.post(`${origin}/nfse/cidades/consultar`, { nome, limite: limit }, {
        timeout: 15_000, headers: { Accept: "application/json", "Content-Type": "application/json", "X-CSRF-TOKEN": session.csrf, Cookie: session.cookie, Origin: origin, Referer: `${origin}/` },
      });
      const values = normalizeGeranetCities(data);
      if (transport === axios) {
        if (cache.size >= 100) cache.clear();
        cache.set(cacheKey, { values, expiresAt: Date.now() + 5 * 60_000 });
      }
      return values;
    } catch (error: any) {
      if (error?.response?.status !== 419 || attempt !== 0) throw error;
      sessions.delete(origin);
    }
  }
  throw new Error("Consulta de cidades Geranet indisponível.");
}

export function usesNationalNfse(city: Pick<GeranetCity, "provedor">) {
  return /nacional/i.test(city.provedor);
}
