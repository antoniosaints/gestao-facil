import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildCoreIaSystemInstruction } from "./coreIaPromptBuilder";

const base = {
  systemPrompt: "Você é o Core, assistente de gestão.",
  hoje: "2026-07-22",
  baseUrlFrontend: "https://app.exemplo.com",
};

/// Conta ocorrências de um trecho no prompt montado.
function ocorrencias(texto: string, trecho: string) {
  return texto.split(trecho).length - 1;
}

describe("buildCoreIaSystemInstruction", () => {
  it("preserva o prompt configurado pelo CEO", () => {
    const prompt = buildCoreIaSystemInstruction(base);
    assert.ok(prompt.includes("Você é o Core, assistente de gestão."));
  });

  it("inclui cada bloco de regras uma única vez", () => {
    const prompt = buildCoreIaSystemInstruction({
      ...base,
      knowledgeContext: "Bloco de ajuda",
      temImagem: true,
    });

    // A versão anterior injetava as regras de imagem e de formato 2-3 vezes.
    for (const cabecalho of [
      "## Como trabalhar",
      "## Uso de ferramentas",
      "## Quando o pedido está vago",
      "## Formato da resposta",
      "## Imagem anexada",
      "## Contexto",
    ]) {
      assert.equal(ocorrencias(prompt, cabecalho), 1, `bloco duplicado: ${cabecalho}`);
    }
  });

  it("só inclui as regras de imagem quando há anexo", () => {
    const semImagem = buildCoreIaSystemInstruction(base);
    const comImagem = buildCoreIaSystemInstruction({ ...base, temImagem: true });

    assert.equal(semImagem.includes("## Imagem anexada"), false);
    assert.ok(comImagem.includes("## Imagem anexada"));
  });

  it("injeta a data de hoje e o link do site", () => {
    const prompt = buildCoreIaSystemInstruction(base);

    assert.ok(prompt.includes("2026-07-22"));
    assert.ok(prompt.includes("https://app.exemplo.com/site"));
  });

  it("omite a seção de conhecimento quando o mapper não devolve nada", () => {
    const vazio = buildCoreIaSystemInstruction({ ...base, knowledgeContext: "   " });
    const comBase = buildCoreIaSystemInstruction({ ...base, knowledgeContext: "Como emitir OS" });

    assert.equal(vazio.includes("Base do sistema"), false);
    assert.ok(comBase.includes("Como emitir OS"));
  });

  it("funciona mesmo sem prompt do CEO configurado", () => {
    const prompt = buildCoreIaSystemInstruction({ ...base, systemPrompt: "" });

    assert.ok(prompt.startsWith("## Como trabalhar"));
    assert.ok(prompt.includes("## Formato da resposta"));
  });

  it("mantém a proibição de confirmar escrita não realizada", () => {
    const prompt = buildCoreIaSystemInstruction(base);
    assert.ok(prompt.includes("sem que a ferramenta tenha confirmado"));
  });
});
