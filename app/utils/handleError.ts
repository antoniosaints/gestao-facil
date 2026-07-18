import { Response } from "express";
import { ZodError } from "zod";
import { prismaErrorMap } from "../mappers/prismaErros";
import { Prisma } from "../../generated";
import { env } from "./dotenv";

const isProduction = env.NODE_ENV === "production";
const GENERIC_MESSAGE = "Ocorreu um erro inesperado. Tente novamente mais tarde.";

export function handleError(res: Response, error: unknown): void {
  let status = 500;
  let title = "Erro interno";
  let message = GENERIC_MESSAGE;

  if (error instanceof ZodError) {
    // Mensagens de validação são voltadas ao usuário e seguras de expor.
    status = 422;
    title = "Erro de validação dos dados";
    message = error.issues.map((e) => e.message).join(", ");
  }

  else if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const mapped = prismaErrorMap[error.code];
    if (mapped) {
      ({ status, title, message } = mapped);
    } else {
      // Erro de banco não mapeado: o detalhe (código, tabela/coluna, SQL) fica só
      // no log do servidor. Em produção o cliente recebe mensagem genérica para
      // não vazar estrutura interna; em dev mantemos o detalhe para depurar.
      status = 400;
      title = "Erro do banco de dados";
      message = isProduction ? "Não foi possível concluir a operação." : `Prisma code ${error.code}: ${error.message}`;
    }
  }

  else if (error instanceof Prisma.PrismaClientValidationError) {
    status = 422;
    title = "Validação do Prisma falhou";
    message = isProduction ? "Dados inválidos para a operação." : error.message;
  }

  else if (error instanceof Error) {
    message = isProduction ? GENERIC_MESSAGE : error.message;
  }

  // Sempre logar o erro real no servidor, independentemente do que é devolvido.
  if (status >= 500) {
    console.error("[handleError]", error);
  }

  res.status(status).json({ title, message });
}
