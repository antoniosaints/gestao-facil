import type { Request, Response } from "express";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { hasPermission } from "../../helpers/userPermission";
import { prisma } from "../../utils/prisma";
import { ResponseHandler } from "../../utils/response";

type LayoutItem = { id: string; visible: boolean; order: number; span: number };

function parseLayout(value: unknown): LayoutItem[] | null {
  if (!Array.isArray(value) || value.length > 40) return null;

  const parsed: LayoutItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const candidate = item as Record<string, unknown>;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const order = Number(candidate.order);
    const span = Number(candidate.span);
    if (!id || id.length > 80 || typeof candidate.visible !== "boolean" || !Number.isInteger(order) || !Number.isInteger(span)) {
      return null;
    }
    parsed.push({ id, visible: candidate.visible, order, span: Math.min(6, Math.max(1, span)) });
  }

  return parsed;
}

export async function getDashboardLayout(req: Request, res: Response) {
  try {
    const customData = getCustomRequest(req).customData;
    const [usuario, conta, canCustomize] = await Promise.all([
      prisma.usuarios.findFirst({
        where: { id: customData.userId, contaId: customData.contaId },
        select: { dashboardLayout: true },
      }),
      prisma.contas.findUnique({
        where: { id: customData.contaId },
        select: { dashboardLayoutPadrao: true },
      }),
      hasPermission(customData, 4),
    ]);

    // Um layout pessoal só é aplicável enquanto o usuário ainda tem papel de administrador.
    // Ao perder a permissão, ele volta imediatamente ao padrão da conta (ou ao layout nativo).
    const personalLayout = canCustomize ? usuario?.dashboardLayout : null;
    const layout = personalLayout ?? conta?.dashboardLayoutPadrao ?? null;
    const source = personalLayout ? "USER" : conta?.dashboardLayoutPadrao ? "CONTA" : "DEFAULT";
    return ResponseHandler(res, "Layout da dashboard", { layout, source, canCustomize });
  } catch {
    return ResponseHandler(res, "Não foi possível carregar o layout da dashboard", null, 500);
  }
}

export async function saveDashboardLayout(req: Request, res: Response) {
  try {
    const customData = getCustomRequest(req).customData;
    if (!(await hasPermission(customData, 4))) {
      return ResponseHandler(res, "Apenas administradores podem personalizar a dashboard", null, 403);
    }

    const layout = parseLayout(req.body?.layout);
    if (!layout) return ResponseHandler(res, "Layout da dashboard inválido", null, 422);

    await prisma.usuarios.update({
      where: { id: customData.userId },
      data: { dashboardLayout: layout },
    });
    return ResponseHandler(res, "Layout pessoal salvo", { layout });
  } catch {
    return ResponseHandler(res, "Não foi possível salvar o layout da dashboard", null, 500);
  }
}

export async function saveDefaultDashboardLayout(req: Request, res: Response) {
  try {
    const customData = getCustomRequest(req).customData;
    if (!(await hasPermission(customData, 4))) {
      return ResponseHandler(res, "Apenas administradores podem definir o layout padrão", null, 403);
    }

    const layout = parseLayout(req.body?.layout);
    if (!layout) return ResponseHandler(res, "Layout da dashboard inválido", null, 422);

    await prisma.contas.update({
      where: { id: customData.contaId },
      data: { dashboardLayoutPadrao: layout },
    });
    return ResponseHandler(res, "Layout padrão da conta salvo", { layout });
  } catch {
    return ResponseHandler(res, "Não foi possível salvar o layout padrão da dashboard", null, 500);
  }
}
