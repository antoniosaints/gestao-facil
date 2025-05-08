import { Prisma } from "@prisma/client";
import { Response } from "express";
import { prismaErrorMap } from "../mappers/prismaErros";

export function handleError(res: Response, error: unknown): void {
  let status = 500;
  let title = "Erro interno";
  let message = "Algo inesperado ocorreu.";

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const mapped = prismaErrorMap[error.code];
    if (mapped) {
      status = mapped.status;
      title = mapped.title;
      message = mapped.message;
    } else {
      status = 400;
      title = "Erro de banco de dados";
      message = `Código ${error.code}: ${error.message}`;
    }
  } else if (error instanceof Prisma.PrismaClientValidationError) {
    status = 422;
    title = "Erro de validação Prisma";
    message = error.message;
  } else if (error instanceof Error) {
    message = error.message;
  }

  res.status(status).json({ title, message });
}
