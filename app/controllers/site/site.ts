import { Request, Response } from "express";
import { z } from "zod";

import { getCustomRequest } from "../../helpers/getCustomRequest";
import { handleError } from "../../utils/handleError";
import { assertSuperAdmin } from "../administracao/assinantes";
import {
  getPlatformSiteConfig,
  savePlatformSiteConfig,
} from "../../services/site/siteConfigService";

const text = (max = 300) => z.string().trim().max(max);

const siteConfigSchema = z.object({
  hero: z.object({
    badge: text(120),
    title: text(180),
    highlight: text(120),
    subtitle: text(500),
    monthlyPrice: z.coerce.number().min(0),
    trialDays: z.coerce.number().int().min(0),
    imageUrl: text(600),
    imageAlt: text(180),
    stats: z.array(z.object({
      value: text(30),
      label: text(60),
    })).max(8),
  }),
  features: z.array(z.object({
    title: text(100),
    description: text(400),
    icon: text(40),
  })).max(16),
  apps: z.array(z.object({
    title: text(100),
    category: text(80),
    description: text(400),
    price: z.coerce.number().min(0),
    icon: text(40),
  })).max(16),
  benefits: z.array(text(160)).max(16),
  adaptBenefits: z.array(text(160)).max(16),
  included: z.array(text(160)).max(24),
  faqs: z.array(z.object({
    q: text(180),
    a: text(700),
  })).max(20),
});

export async function getPublicSiteConfig(_req: Request, res: Response): Promise<any> {
  try {
    const data = await getPlatformSiteConfig();
    return res.json({ data });
  } catch (error) {
    return handleError(res, error);
  }
}

export async function getAdminSiteConfig(req: Request, res: Response): Promise<any> {
  try {
    const customData = getCustomRequest(req).customData;
    if (!(await assertSuperAdmin(customData.userId))) {
      return res.status(403).json({ message: "Usuário não tem permissão para gerenciar o site." });
    }

    const data = await getPlatformSiteConfig(customData.contaId);
    return res.json({ data });
  } catch (error) {
    return handleError(res, error);
  }
}

export async function saveAdminSiteConfig(req: Request, res: Response): Promise<any> {
  try {
    const customData = getCustomRequest(req).customData;
    if (!(await assertSuperAdmin(customData.userId))) {
      return res.status(403).json({ message: "Usuário não tem permissão para gerenciar o site." });
    }

    const parsed = siteConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }

    const data = await savePlatformSiteConfig(customData.contaId, parsed.data);
    return res.json({
      message: "Configurações do site atualizadas com sucesso.",
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
}
