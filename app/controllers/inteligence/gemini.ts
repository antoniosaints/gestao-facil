import { handleError } from "../../utils/handleError";
import { callChatGeminiService, decideCoreIaAction } from "../../external/gemini/callGemini";
import { contaHasActiveModule } from "../../services/contas/storeModulesService";
import { iaUsageService, IaQuotaExcededError } from "../../services/ia/iaUsageService";
import { createCoreIaChatHandler } from "../../services/ia/coreIaHttpHandler";

export const callChatGemini = createCoreIaChatHandler({
  access: request => contaHasActiveModule(request.contaId, "core-ia"),
  quota: contaId => iaUsageService.assertWithinQuota(contaId),
  chat: callChatGeminiService,
  decide: decideCoreIaAction,
  onError(res, error) {
    if (error instanceof IaQuotaExcededError) { res.status(429).json({ message: error.message }); return; }
    handleError(res, error);
  },
});
