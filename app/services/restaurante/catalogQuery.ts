import type { Prisma } from "../../../generated/client";

export const restaurantCatalogGroupsInclude = {
  include: {
    Grupo: {
      include: {
        opcoes: {
          where: { ativo: true },
          orderBy: [{ ordem: "asc" }, { id: "asc" }],
        },
      },
    },
  },
} satisfies Prisma.RestauranteCatalogoItem$gruposArgs;
