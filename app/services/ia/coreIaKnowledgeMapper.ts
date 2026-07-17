export type CoreIaKnowledgeChunk = {
  id: string;
  module: string;
  title: string;
  intent: string[];
  keywords: string[];
  summary: string;
  steps?: string[];
  routes?: string[];
  tools?: string[];
  cautions?: string[];
};

type BuildKnowledgeContextInput = {
  prompt: string;
  maxChunks?: number;
  maxChars?: number;
};

const STOP_WORDS = new Set([
  "a",
  "ao",
  "aos",
  "as",
  "com",
  "como",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "e",
  "em",
  "eu",
  "me",
  "no",
  "nos",
  "o",
  "os",
  "ou",
  "para",
  "por",
  "que",
  "um",
  "uma",
]);

export const CORE_IA_KNOWLEDGE_BASE: CoreIaKnowledgeChunk[] = [
  {
    id: "sistema.visao_geral",
    module: "Sistema",
    title: "Visão geral do Gestão Fácil",
    intent: ["explicar sistema", "onde fica", "menu principal", "primeiro uso"],
    keywords: ["gestao", "facil", "erp", "sistema", "dashboard", "home", "menu", "inicio", "visao", "geral"],
    summary:
      "O Gestão Fácil centraliza vendas, financeiro, produtos, serviços, clientes, contratos, loja, atendimento, WhatsApp e Core IA. Use o menu lateral para acessar módulos; alguns apps aparecem apenas quando ativos na conta.",
    steps: [
      "Abrir o menu lateral.",
      "Escolher o módulo desejado.",
      "Usar dashboards para acompanhar indicadores e telas de listagem para cadastrar, editar ou consultar dados.",
    ],
    routes: ["/", "/configuracoes"],
    cautions: ["Se um módulo não aparece, pode estar oculto nas configurações ou inativo na conta."],
  },
  {
    id: "clientes.cadastro_busca",
    module: "Clientes",
    title: "Cadastrar, buscar e consultar clientes",
    intent: ["cadastrar cliente", "buscar cliente", "editar cliente", "ver detalhes cliente"],
    keywords: ["cliente", "clientes", "fornecedor", "fornecedores", "cadastro", "buscar", "nome", "documento", "telefone", "email"],
    summary:
      "Clientes e fornecedores ficam no módulo Clientes. A tela permite listar, pesquisar, cadastrar, editar e abrir detalhes do cadastro.",
    steps: [
      "Ir em Clientes.",
      "Usar a busca para localizar por nome ou dados do cadastro.",
      "Para novo cliente, clicar em adicionar/cadastrar e preencher nome; endereço e contato podem complementar.",
      "Abrir detalhes para conferir histórico e informações vinculadas.",
    ],
    routes: ["/clientes", "/clientes/:id", "/publico/:contaId/cadastro"],
    tools: ["buscarClientePorNomeParaOperacao", "getClientesSistema", "createClienteNovo"],
    cautions: ["Não peça ID interno ao usuário; busque pelo nome quando precisar vincular venda, OS ou financeiro."],
  },
  {
    id: "produtos.cadastro_estoque",
    module: "Produtos",
    title: "Produtos, categorias, estoque e movimentações",
    intent: ["cadastrar produto", "consultar estoque", "repor estoque", "movimentar produto", "categoria produto"],
    keywords: ["produto", "produtos", "estoque", "categoria", "preco", "custo", "reposicao", "movimentacao", "entrada", "saida", "catalogo"],
    summary:
      "Produtos reúne cadastro, preço, estoque, categorias, dashboard, reposição e movimentações. Use para controlar itens vendidos e saldo em estoque.",
    steps: [
      "Ir em Produtos para listar e cadastrar itens.",
      "Preencher nome, preços e dados de estoque.",
      "Usar Categorias para organizar produtos.",
      "Usar Reposição ou Movimentações para ajustar saldo quando necessário.",
    ],
    routes: ["/produtos", "/produtos/categorias", "/produtos/dashboard", "/produtos/reposicao", "/produtos/movimentacoes", "/catalogo/:contaId"],
    tools: ["getProdutosSistema", "buscarProdutoPorNome", "reporEstoqueProduto"],
    cautions: ["Para vender ou repor, confirme produto e quantidade antes de executar alteração."],
  },
  {
    id: "vendas.pdv_caixa",
    module: "Vendas",
    title: "Vendas, PDV e caixas",
    intent: ["registrar venda", "abrir pdv", "vender produto", "caixa", "dashboard vendas"],
    keywords: ["venda", "vendas", "pdv", "caixa", "pagamento", "cliente", "produto", "quantidade", "desconto", "total"],
    summary:
      "Vendas controla registros de venda, PDV, caixas e indicadores. Para vender, informe produto, quantidade, cliente quando houver e forma de pagamento.",
    steps: [
      "Ir em Vendas > PDV para venda rápida ou Vendas para listagem.",
      "Selecionar produtos e quantidades.",
      "Vincular cliente se necessário.",
      "Conferir total, desconto e forma de pagamento.",
      "Finalizar e acompanhar no dashboard ou histórico.",
    ],
    routes: ["/vendas", "/vendas/pdv", "/vendas/caixas", "/vendas/dashboard"],
    tools: ["buscarClientePorNomeParaOperacao", "buscarProdutoPorNome", "registrarVendaProduto", "getResumoVendas"],
    cautions: ["Antes de registrar venda pela IA, confirme produto, quantidade, cliente e pagamento."],
  },
  {
    id: "financeiro.lancamentos",
    module: "Financeiro",
    title: "Lançamentos financeiros",
    intent: ["criar lançamento", "registrar receita", "registrar despesa", "conta financeira", "parcelas"],
    keywords: ["financeiro", "lancamento", "lançamento", "receita", "despesa", "pagar", "receber", "parcela", "vencimento", "conta", "banco", "caixa"],
    summary:
      "Lançamentos financeiros registram receitas e despesas. Cada lançamento deve ter tipo, valor, vencimento/competência e conta financeira vinculada.",
    steps: [
      "Ir em Financeiro > Lançamentos.",
      "Escolher receita ou despesa.",
      "Informar descrição, valor, data, categoria e conta financeira.",
      "Definir parcelas se houver.",
      "Salvar e acompanhar em contas a pagar/receber ou painel.",
    ],
    routes: ["/financeiro/lancamentos", "/financeiro/contas-a-receber", "/financeiro/contas-a-pagar", "/financeiro/painel"],
    tools: ["criarLancamentoFinanceiro", "getResumoFinanceiro"],
    cautions: ["Nunca crie lançamento sem conta financeira. Se não souber a conta, liste opções e peça escolha."],
  },
  {
    id: "financeiro.configuracoes",
    module: "Financeiro",
    title: "Contas financeiras, categorias, cobranças e assinaturas a pagar",
    intent: ["configurar financeiro", "categoria financeira", "conta financeira", "cobrança", "assinatura a pagar"],
    keywords: ["conta financeira", "categoria financeira", "categoria", "cobranca", "cobrança", "assinatura pagar", "recorrente", "banco"],
    summary:
      "O financeiro possui contas financeiras para caixa/bancos, categorias para classificar lançamentos, cobranças para recebimento e assinaturas a pagar para despesas recorrentes.",
    steps: [
      "Ir em Financeiro > Contas para cadastrar caixas/bancos.",
      "Ir em Financeiro > Categorias para organizar receitas e despesas.",
      "Usar Cobranças para acompanhar cobranças emitidas.",
      "Usar Assinaturas a pagar para compromissos recorrentes.",
    ],
    routes: ["/financeiro/contas", "/financeiro/categorias", "/financeiro/cobrancas", "/financeiro/assinaturas-a-pagar"],
    cautions: ["Separar conta financeira de categoria: conta é onde o dinheiro entra/sai; categoria explica o motivo."],
  },
  {
    id: "servicos.os",
    module: "Serviços",
    title: "Serviços e ordens de serviço",
    intent: ["criar serviço", "ordem de serviço", "os", "assinatura de ordem", "serviço prestado"],
    keywords: ["servico", "serviço", "servicos", "serviços", "ordem", "os", "cliente", "assinatura", "prestacao", "prestação"],
    summary:
      "Serviços cadastra itens de serviço e ordens de serviço. OS pode vincular cliente, itens, valores e assinatura pública do cliente.",
    steps: [
      "Ir em Serviços para cadastrar serviços disponíveis.",
      "Ir em Serviços > OS para criar ordem de serviço.",
      "Selecionar cliente, itens/serviços, descrição, valores e status.",
      "Compartilhar link público quando precisar de assinatura ou acompanhamento.",
    ],
    routes: ["/servicos", "/servicos/os", "/servicos/painel", "/publico/:contaId/ordem-servico/:ordemId"],
    tools: ["createServicoNovo", "getResumoOrdensServicos", "buscarClientePorNomeParaOperacao"],
  },
  {
    id: "assinaturas.comodatos",
    module: "Contratos",
    title: "Contratos, planos, cobranças e comodatos",
    intent: ["assinatura", "plano recorrente", "comodato", "cobrança assinatura"],
    keywords: ["assinatura", "assinaturas", "plano", "planos", "recorrencia", "recorrência", "cobranca", "comodato", "contrato"],
    summary:
      "Contratos gerencia planos recorrentes, contratos de clientes, cobranças e comodatos vinculados.",
    steps: [
      "Ir em Contratos > Planos para definir planos.",
      "Ir em Contratos > Contratos para cadastrar contrato de cliente.",
      "Acompanhar cobranças e comodatos nos menus próprios.",
      "Usar o painel para visão consolidada.",
    ],
    routes: ["/assinaturas/painel", "/assinaturas/assinaturas", "/assinaturas/planos", "/assinaturas/cobrancas", "/assinaturas/comodatos"],
  },
  {
    id: "loja.app_store",
    module: "App Store",
    title: "Loja de apps e módulos",
    intent: ["ativar app", "instalar módulo", "loja", "app store", "módulo grátis"],
    keywords: ["loja", "app", "apps", "modulo", "módulo", "ativar", "instalar", "gratis", "gratuito", "produtividade", "core ia", "whatsapp", "atendimento"],
    summary:
      "A App Store permite ativar módulos adicionais. Apps com valor zero são tratados como grátis. Atendimento, WhatsApp e Core IA pertencem à categoria Produtividade.",
    steps: [
      "Ir em Loja/App Store.",
      "Abrir o card do módulo desejado.",
      "Conferir preço e ativar.",
      "Depois de ativo, o menu do módulo passa a aparecer conforme permissões/configurações.",
    ],
    routes: ["/loja"],
    cautions: ["Se o módulo é grátis, não deve haver fluxo de cobrança proporcional ou primeira mensalidade."],
  },
  {
    id: "core_ia.uso",
    module: "Core IA",
    title: "Como usar o Core IA",
    intent: ["usar core ia", "chat ia", "imagem na ia", "o que pode fazer", "tokens"],
    keywords: ["core ia", "ia", "inteligencia", "chat", "imagem", "foto", "analise", "tokens", "consumo", "ferramenta"],
    summary:
      "Core IA é o assistente do sistema. Ele responde dúvidas, guia operações, consulta dados por ferramentas, aceita imagens na mensagem atual e descarta a imagem após processar.",
    steps: [
      "Abrir Core IA pelo botão flutuante ou menu Chat > IA.",
      "Perguntar em linguagem natural o que deseja consultar ou fazer.",
      "Anexar imagem quando quiser análise visual.",
      "Confirmar dados quando a IA for criar ou alterar registros.",
    ],
    routes: ["/chat/ia", "/admin/inteligencia/core", "/admin/inteligencia/consumo"],
    tools: ["buscarAjudaSistema", "buscarClientePorNomeParaOperacao"],
    cautions: ["A IA deve confirmar dados essenciais antes de operações de escrita e não deve exibir IDs internos sem necessidade."],
  },
  {
    id: "whatsapp.atendimento",
    module: "Produtividade",
    title: "WhatsApp e Atendimento",
    intent: ["usar whatsapp", "atendimento", "conversas", "contatos", "agentes", "relatórios atendimento"],
    keywords: ["whatsapp", "atendimento", "conversa", "conversas", "contato", "contatos", "agente", "agentes", "relatorio", "relatório", "produtividade"],
    summary:
      "WhatsApp e Atendimento centralizam comunicação, contatos, agentes, painel e relatórios. São módulos de Produtividade quando ativos na conta.",
    steps: [
      "Ir em WhatsApp para configurar e operar conexão/conversas do WhatsApp.",
      "Ir em Atendimento para conversas e operação.",
      "Usar Painel, Contatos, Agentes e Relatórios para gestão do atendimento.",
    ],
    routes: ["/whatsapp", "/atendimento", "/atendimento/painel", "/atendimento/contatos", "/atendimento/agentes", "/atendimento/relatorios"],
  },
  {
    id: "site_publico.gerenciador",
    module: "Site Público",
    title: "Gerenciador do site no modo CEO",
    intent: ["configurar site", "site público", "hero", "faq", "perguntas frequentes", "valor do plano"],
    keywords: ["site", "publico", "público", "ceo", "hero", "plano", "faq", "perguntas", "frequentes", "imagem", "secao", "seção"],
    summary:
      "O modo CEO possui Gerenciador do site para controlar imagem principal, chamada, valor do plano, apps exibidos, seções e perguntas frequentes do /site.",
    steps: [
      "Entrar no modo CEO/Admin.",
      "Abrir Site.",
      "Editar abas verticais: Hero e plano, Funcionalidades, Apps e valores, Seções do site e Perguntas frequentes.",
      "Salvar site e conferir em Ver site.",
    ],
    routes: ["/admin/site", "/site"],
    cautions: ["Textos devem permanecer em UTF-8; se aparecer texto quebrado, revisar a configuração salva."],
  },
  {
    id: "configuracoes.menus",
    module: "Configurações",
    title: "Configurações, permissões e menus",
    intent: ["configurar sistema", "ocultar menu", "mostrar menu", "permissão", "perfil usuário"],
    keywords: ["configuracao", "configuração", "configuracoes", "configurações", "menu", "menus", "submenu", "ocultar", "mostrar", "permissao", "permissão", "usuario", "usuário"],
    summary:
      "Configurações centraliza preferências da conta, menus/submenus visíveis, usuários e ajustes operacionais. Menus de apps/módulos só fazem sentido quando o app está ativo na conta.",
    steps: [
      "Ir em Configurações.",
      "Abrir a seção de menus para mostrar ou ocultar menus/submenus.",
      "Verificar usuários e permissões em Administração > Usuários quando necessário.",
    ],
    routes: ["/configuracoes", "/administracao/usuarios", "/usuario/perfil"],
    cautions: ["Ocultar menu não substitui permissão de acesso; permissão deve continuar sendo validada no backend."],
  },
  {
    id: "admin.ceo_ia_consumo",
    module: "Modo CEO",
    title: "Administração, Core IA e consumo",
    intent: ["modo ceo", "admin", "consumo ia", "modelo ia", "chave ia", "assinantes", "faturas"],
    keywords: ["ceo", "admin", "assinante", "fatura", "modelo", "chave", "core", "consumo", "token", "usd", "dolar", "dólar"],
    summary:
      "Modo CEO/Admin gerencia assinantes, faturas, financeiro da plataforma, site público e configurações do Core IA, incluindo modelos, chaves, prompt, consumo e custos em USD.",
    steps: [
      "Ir em Admin para painel geral.",
      "Usar Assinantes e Faturas para gestão da plataforma.",
      "Usar Inteligência > Modelos/Chaves/Core/Consumo para configurar IA e acompanhar uso.",
      "Na tela de consumo, usar calculadora de tokens quando precisar simular custo e conversão de moeda.",
    ],
    routes: ["/admin", "/admin/assinantes", "/admin/faturas", "/admin/inteligencia/modelos", "/admin/inteligencia/chaves", "/admin/inteligencia/core", "/admin/inteligencia/consumo"],
    cautions: ["Custos de IA devem usar USD como moeda base do provedor; conversões são auxiliares."],
  },
  {
    id: "arena.comandas_reservas",
    module: "Arena",
    title: "Arena, comandas, reservas e quadras",
    intent: ["arena", "comanda", "reserva", "quadra", "calendário"],
    keywords: ["arena", "comanda", "comandas", "reserva", "reservas", "quadra", "quadras", "calendario", "calendário"],
    summary:
      "Arena atende operações com comandas, vendas, reservas, quadras e calendário.",
    steps: [
      "Ir em Arena para dashboard.",
      "Usar Comandas ou Vendas para operação comercial.",
      "Usar Reservas, Quadras e Calendário para agenda e disponibilidade.",
    ],
    routes: ["/arena", "/arena/comandas", "/arena/vendas", "/arena/reservas", "/arena/quadras", "/arena/calendario"],
  },
];

function normalizeText(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9]+/i)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3 && !STOP_WORDS.has(item));
}

function chunkSearchText(chunk: CoreIaKnowledgeChunk): string {
  return normalizeText([
    chunk.id,
    chunk.module,
    chunk.title,
    chunk.intent.join(" "),
    chunk.keywords.join(" "),
    chunk.summary,
    chunk.steps?.join(" ") || "",
    chunk.routes?.join(" ") || "",
  ].join(" "));
}

function scoreChunk(chunk: CoreIaKnowledgeChunk, query: string, tokens: string[]): number {
  const haystack = chunkSearchText(chunk);
  const normalizedQuery = normalizeText(query);
  let score = 0;

  for (const keyword of chunk.keywords) {
    const normalizedKeyword = normalizeText(keyword);
    if (normalizedKeyword && normalizedQuery.includes(normalizedKeyword)) score += 8;
  }

  for (const intent of chunk.intent) {
    const normalizedIntent = normalizeText(intent);
    if (normalizedIntent && normalizedQuery.includes(normalizedIntent)) score += 10;
  }

  for (const token of tokens) {
    if (haystack.includes(token)) score += 2;
    if (normalizeText(chunk.module).includes(token)) score += 3;
    if (normalizeText(chunk.title).includes(token)) score += 3;
  }

  return score;
}

function formatChunk(chunk: CoreIaKnowledgeChunk): string {
  const fields = [
    `id=${chunk.id}`,
    `mod=${chunk.module}`,
    `titulo=${chunk.title}`,
    `uso=${chunk.intent.join(", ")}`,
    `resumo=${chunk.summary}`,
  ];

  if (chunk.steps?.length) fields.push(`passos=${chunk.steps.map((step, index) => `${index + 1}) ${step}`).join(" ")}`);
  if (chunk.routes?.length) fields.push(`rotas=${chunk.routes.join(", ")}`);
  if (chunk.tools?.length) fields.push(`tools=${chunk.tools.join(", ")}`);
  if (chunk.cautions?.length) fields.push(`alertas=${chunk.cautions.join(" ")}`);

  return fields.join("\n");
}

export function searchCoreIaKnowledge(query: string, limit = 5): CoreIaKnowledgeChunk[] {
  const tokens = tokenize(query);
  const scored = CORE_IA_KNOWLEDGE_BASE
    .map((chunk) => ({ chunk, score: scoreChunk(chunk, query, tokens) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id));

  if (!scored.length) {
    return CORE_IA_KNOWLEDGE_BASE.filter((chunk) =>
      ["sistema.visao_geral", "core_ia.uso", "configuracoes.menus"].includes(chunk.id),
    ).slice(0, limit);
  }

  return scored.slice(0, limit).map((item) => item.chunk);
}

export function buildCoreIaKnowledgeContext({
  prompt,
  maxChunks = 4,
  maxChars = 4200,
}: BuildKnowledgeContextInput): string {
  const chunks = searchCoreIaKnowledge(prompt, maxChunks);
  const lines = ["[base_sistema_gestao_facil_v1]"];

  for (const chunk of chunks) {
    const next = `${lines.join("\n\n")}\n\n${formatChunk(chunk)}`;
    if (next.length > maxChars) break;
    lines.push(formatChunk(chunk));
  }

  return lines.join("\n\n");
}

export async function buscarAjudaSistemaParaIa(args: { consulta?: string }) {
  const consulta = String(args?.consulta || "").trim();
  const chunks = searchCoreIaKnowledge(consulta, 6);

  return {
    consulta,
    total: chunks.length,
    instrucoes:
      "Use estes blocos como base de autoajuda. Responda em português, com passos curtos, sem tabela e sem inventar menus que não aparecem nos blocos.",
    blocos: chunks.map((chunk) => ({
      id: chunk.id,
      modulo: chunk.module,
      titulo: chunk.title,
      resumo: chunk.summary,
      passos: chunk.steps || [],
      rotas: chunk.routes || [],
      ferramentas: chunk.tools || [],
      alertas: chunk.cautions || [],
    })),
  };
}
