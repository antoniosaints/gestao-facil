import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../utils/prisma";
import { contaHasActiveModule } from "../../services/contas/storeModulesService";
import { publicStoreConfig } from "../../services/loja/lojaConfigService";
import { getReservedQuantity, calculateAvailableStock } from "../../services/loja/lojaInventoryService";
import { getPublicOrder, placeStoreOrder, previewStoreOrder, retryStoreCheckout } from "../../services/loja/lojaOrderService";
import { sendCommerceError } from "../../services/loja/commerceError";
import { ResponseHandler } from "../../utils/response";

const itemSchema = z.object({ productId: z.number().int().positive(), quantity: z.number().int().positive().max(999) });
// Campos opcionais em branco (string vazia) devem virar `undefined` — caso contrário
// validações como e-mail e UF (length 2) reprovam o pedido inteiro.
const blankToUndefined = (val: unknown) => {
  if (val && typeof val === "object") {
    return Object.fromEntries(
      Object.entries(val as Record<string, unknown>).map(([key, value]) => [key, typeof value === "string" && value.trim() === "" ? undefined : value]),
    );
  }
  return val;
};
const orderSchema = z.object({
  items: z.array(itemSchema).min(1).max(100),
  channel: z.enum(["WHATSAPP", "GATEWAY"]),
  deliveryType: z.enum(["RETIRADA", "ENTREGA_LOCAL"]),
  customer: z.preprocess(blankToUndefined, z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().email().optional(),
    phone: z.string().trim().min(8).max(30),
    postalCode: z.string().trim().max(12).optional(),
    address: z.string().trim().max(160).optional(),
    number: z.string().trim().max(30).optional(),
    complement: z.string().trim().max(100).optional(),
    district: z.string().trim().max(100).optional(),
    city: z.string().trim().max(100).optional(),
    state: z.string().trim().length(2).optional(),
  })),
  notes: z.string().trim().max(500).optional(),
});

export async function getPublicStore(req: Request, res: Response) {
  try {
    const config = await prisma.lojaVirtualConfig.findUnique({
      where: { slug: req.params.slug },
      include: { Conta: { select: { nome: true, nomeFantasia: true, profile: true, telefone: true } } },
    });
    if (!config) return ResponseHandler(res, "Loja não encontrada", null, 404);
    const active = await contaHasActiveModule(config.contaId, "loja-virtual");
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
    res.setHeader("ETag", `W/\"store-${config.id}-${config.updatedAt.getTime()}\"`);
    return ResponseHandler(res, "Loja encontrada", {
      identity: { name: config.Conta.nomeFantasia || config.Conta.nome, logo: config.Conta.profile },
      ...publicStoreConfig(config, active ? "LOJA" : "CATALOGO"),
    });
  } catch (error) {
    return sendCommerceError(res, error);
  }
}

export async function getPublicProducts(req: Request, res: Response) {
  try {
    const limit = Math.min(48, Math.max(1, Number(req.query.limit) || 24));
    const cursor = req.query.cursor ? Number(req.query.cursor) : undefined;
    const config = await prisma.lojaVirtualConfig.findUnique({ where: { slug: req.params.slug } });
    if (!config) return ResponseHandler(res, "Loja não encontrada", null, 404);
    const products = await prisma.produto.findMany({
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      where: {
        contaId: config.contaId,
        status: "ATIVO",
        mostrarNoCatalogo: true,
        ...(req.query.search ? { OR: [{ nome: { contains: String(req.query.search) } }, { ProdutoBase: { nome: { contains: String(req.query.search) } } }] } : {}),
        ...(req.query.category ? { ProdutoBase: { Categoria: { nome: String(req.query.category) } } } : {}),
      },
      include: { ProdutoBase: { include: { Categoria: true } } },
      orderBy: { id: "asc" },
    });
    const hasNext = products.length > limit;
    const page = products.slice(0, limit);
    const data = await Promise.all(page.map(async (product) => {
      const reserved = product.controlaEstoque ? await getReservedQuantity(prisma as any, config.contaId, product.id) : 0;
      return {
        id: product.id,
        baseId: product.produtoBaseId,
        name: product.ProdutoBase?.nome ?? product.nome,
        description: product.ProdutoBase?.descricao ?? product.descricao,
        variant: product.nomeVariante,
        category: product.ProdutoBase?.Categoria?.nome ?? null,
        price: Number(product.preco),
        image: product.imagem,
        unit: product.unidade,
        sku: product.codigoProduto ?? product.codigo,
        controlsStock: product.controlaEstoque ?? false,
        available: product.controlaEstoque ? calculateAvailableStock(product.estoque, reserved) : null,
      };
    }));
    return ResponseHandler(res, "Produtos encontrados", { data, nextCursor: hasNext ? page.at(-1)?.id : null });
  } catch (error) {
    return sendCommerceError(res, error);
  }
}

export async function previewCheckout(req: Request, res: Response) {
  try {
    const input = orderSchema.parse(req.body);
    return ResponseHandler(res, "Checkout recalculado", await previewStoreOrder(req.params.slug, input));
  } catch (error) { return sendCommerceError(res, error); }
}

export async function createPublicOrder(req: Request, res: Response) {
  try {
    const input = orderSchema.parse(req.body);
    const result = await placeStoreOrder(req.params.slug, input, String(req.header("Idempotency-Key") || ""), (req as any).storeCustomer?.id);
    return ResponseHandler(res, result.replayed ? "Pedido recuperado" : "Pedido criado", result, result.replayed ? 200 : 201);
  } catch (error) { return sendCommerceError(res, error); }
}

export async function retryPublicOrder(req: Request, res: Response) {
  try {
    const token = String(req.header("X-Order-Token") || req.body?.accessToken || "");
    const data = await retryStoreCheckout(req.params.slug, req.params.publicId, token, String(req.header("Idempotency-Key") || ""));
    return ResponseHandler(res, "Checkout retomado", { nextAction: data });
  } catch (error) { return sendCommerceError(res, error); }
}

export async function showPublicOrder(req: Request, res: Response) {
  try {
    const token = String(req.header("X-Order-Token") || req.query.accessToken || "");
    return ResponseHandler(res, "Pedido encontrado", await getPublicOrder(req.params.slug, req.params.publicId, token, (req as any).storeCustomer?.id));
  } catch (error) { return sendCommerceError(res, error); }
}
