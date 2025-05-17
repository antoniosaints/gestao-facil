import { Response } from "express";
import { ZodError } from "zod";
import { prismaErrorMap } from "../mappers/prismaErros";
import { Prisma } from "../../generated";

export function handleError(res: Response, error: unknown): void {
  let status = 500;
  let title = "Erro interno";
  let message = "Ocorreu um erro inesperado. Tente novamente mais tarde.";

  if (error instanceof ZodError) {
    status = 422;
    title = "Erro de validação dos dados";
    message = error.issues.map((e) => e.message).join(", ");
  } 
  
  else if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const mapped = prismaErrorMap[error.code];
    if (mapped) {
      ({ status, title, message } = mapped);
    } else {
      status = 400;
      title = "Erro do banco de dados";
      message = `Prisma code ${error.code}: ${error.message}`;
    }
  } 
  
  else if (error instanceof Prisma.PrismaClientValidationError) {
    status = 422;
    title = "Validação do Prisma falhou";
    message = error.message;
  } 
  
  else if (error instanceof Error) {
    message = error.message;
  }

  res.status(status).json({ title, message });
}
