// src/utils/prismaErrorMap.ts
export const prismaErrorMap: Record<
  string,
  { status: number; title: string; message: string }
> = {
  P2000: {
    status: 400,
    title: "Campo inválido",
    message: "O valor é muito longo para o campo.",
  },
  P2001: {
    status: 404,
    title: "Registro não encontrado",
    message: "Nenhum registro encontrado com os critérios fornecidos.",
  },
  P2002: {
    status: 409,
    title: "Violação de unicidade",
    message: "Já existe um registro com esse valor.",
  },
  P2003: {
    status: 400,
    title: "Chave estrangeira inválida",
    message: "A referência de chave estrangeira não é válida.",
  },
  P2005: {
    status: 400,
    title: "Tipo de dado inválido",
    message: "O valor fornecido é inválido para o tipo do campo.",
  },
  P2010: {
    status: 500,
    title: "Erro interno do banco de dados",
    message: "Erro desconhecido ao executar a operação no banco.",
  },
  P2011: {
    status: 400,
    title: "Campo obrigatório",
    message: "Não é permitido inserir null neste campo.",
  },
  P2012: {
    status: 400,
    title: "Campo ausente",
    message: "Campo obrigatório não fornecido.",
  },
  P2013: {
    status: 400,
    title: "Argumento ausente",
    message: "Argumento necessário para a operação não foi informado.",
  },
  P2015: {
    status: 404,
    title: "Relacionamento não encontrado",
    message: "Registro relacionado não existe.",
  },
  P2020: {
    status: 400,
    title: "Valor fora do limite",
    message: "O valor fornecido está fora do intervalo permitido.",
  },
  P2025: {
    status: 404,
    title: "Registro inexistente",
    message: "O registro que se tentou alterar ou excluir não existe.",
  },
  P2033: {
    status: 409,
    title: "Erro de concorrência",
    message: "Erro ao tentar modificar dados concorrentes.",
  },
};
