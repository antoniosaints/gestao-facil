// A routing hint only: the model still resolves entities, and the server authorizes tools.
export function identifyCoreIaIntent(value: string) {
  const text = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const help = /\b(como|onde|ajuda|passo a passo)\b/.test(text);
  const sale = /\b(vendi|vender|venda|vendas)\b/.test(text);
  const finance =
    /\b(lancamento|lancar|despesa|receita|paguei|gastei|recebi|conta a pagar|conta a receber)\b/.test(
      text,
    );
  const write =
    /\b(cadastr\w*|registr\w*|cri\w*|adicion\w*|inclu\w*|lanc\w*|vendi|paguei|gastei|recebi|vend\w*)\b/.test(
      text,
    );
  const entity = sale
    ? "venda"
    : finance
      ? "lançamento financeiro"
      : /\b(client\w*|fornecedor\w*)\b/.test(text)
        ? "cliente"
        : /\b(produt\w*|mercadoria|item)\b/.test(text)
          ? "produto"
          : /\b(servic\w*)\b/.test(text)
            ? "serviço"
            : "contexto da conversa";
  return {
    mode: help
      ? "autoajuda"
      : write
        ? "cadastro"
        : /\b(analise|compare|por que|evolucao|tendencia|resumo)\b/.test(text)
          ? "análise"
          : "consulta",
    entity,
  };
}
