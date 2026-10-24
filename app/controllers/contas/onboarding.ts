import type { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { handleError } from "../../utils/handleError";
import { onboardingPreviewSchema } from "../../schemas/onboarding";
import { onboardingConfig, OnboardingCatalogChanged, previewOnboarding, readOnboardingCatalog } from "../../services/contas/onboardingService";
export async function getOnboardingConfig(_req: Request, res: Response) {
  try { res.json({ data: onboardingConfig(await readOnboardingCatalog(prisma)) }); }
  catch (err) { handleError(res, err); }
}
export async function postOnboardingPreview(req: Request, res: Response) {
  const parsed = onboardingPreviewSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: "Dados de onboarding inválidos", fieldErrors: parsed.error.flatten().fieldErrors }); return; }
  try { res.json({ data: previewOnboarding(parsed.data, await readOnboardingCatalog(prisma)) }); }
  catch (err) {
    if (err instanceof OnboardingCatalogChanged) { res.status(409).json({ message: err.message, code: err.code }); return; }
    handleError(res, err);
  }
}
