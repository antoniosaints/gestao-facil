import { prisma } from "../utils/prisma";
import { CustomData } from "./getCustomRequest";

export const hasPermission = async (dataLogged: CustomData, permission: number) => {
  const usuario = await prisma.usuarios.findUniqueOrThrow({
    where: {
      id: dataLogged.userId,
      contaId: dataLogged.contaId,
    },
  });
  let levelPermission = 0;
  switch (usuario.permissao) {
    case "root":
      levelPermission = 5;
      break;
    case "admin":
      levelPermission = 4;
      break;
    case "gerente":
      levelPermission = 3;
      break;
    case "tecnico":
    case "vendedor":
      levelPermission = 2;
      break;
    case "usuario":
      levelPermission = 1;
      break;
    default:
      levelPermission = 0;
      break;
  }

  return levelPermission >= permission;
};
