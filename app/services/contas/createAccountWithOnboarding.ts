import type { Prisma } from "../../../generated/client";
import type { z } from "zod";
import type { onboardingCadastroSchema } from "../../schemas/onboarding";
import { activateFreeOnboardingModules, previewOnboarding, readOnboardingCatalog } from "./onboardingService";

type RegistrationTx = Pick<Prisma.TransactionClient, "modulosAdicionais" | "moduloOnConta" | "parametrosConta">;
type OnboardingCadastro = z.infer<typeof onboardingCadastroSchema>;

// Caller owns the transaction: catalog validation must precede account/user inserts.
export async function createAccountWithOnboarding<
  Account extends { id: number; vencimento: Date },
  User extends { id: number; nome: string; email: string },
>(tx: RegistrationTx, onboarding: OnboardingCadastro | undefined, createRecords: () => Promise<{ created: Account; user: User }>) {
  const catalog = onboarding ? await readOnboardingCatalog(tx) : [];
  const preview = onboarding ? previewOnboarding(onboarding, catalog) : undefined;
  const { created, user } = await createRecords();
  await tx.parametrosConta.create({
    data: {
      contaId: created.id, estiloUi: "SIDEV2",
      ...(onboarding && preview ? {
        menusVisiveis: preview.menusEfetivos,
        temaPersonalizado: onboarding.temaPersonalizado,
        onboardingPerfil: {
          version: 1, respostas: onboarding.respostas, modulosSelecionados: onboarding.modulosSelecionados,
          menusConfirmados: preview.menusEfetivos, concluidoEm: new Date().toISOString(),
        },
      } : {}),
    },
  });
  if (preview) await activateFreeOnboardingModules(tx, created.id, created.vencimento, preview, catalog);
  return { created, user: { id: user.id, nome: user.nome, email: user.email }, ...(preview ? { onboarding: preview } : {}) };
}
