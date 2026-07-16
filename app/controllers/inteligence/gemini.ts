import { Request, Response } from "express";
import { handleError } from "../../utils/handleError";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { z } from "zod";
import { callChatGeminiService } from "../../external/gemini/callGemini";
import { ResponseHandler } from "../../utils/response";
import { contaHasActiveModule } from "../../services/contas/storeModulesService";
import { iaUsageService, IaQuotaExcededError } from "../../services/ia/iaUsageService";

export const callChatGemini = async (req: Request, res: Response): Promise<any> => {
    try {
        const custom = getCustomRequest(req).customData;
        const hasAccess = await contaHasActiveModule(custom.contaId, "core-ia");

        if (!hasAccess) {
            return res.status(403).json({
                message: "O app CORE IA não está ativo no seu plano.",
            });
        }

        const body = z.object({
            prompt: z.string(),
            history: z.any(),
            image: z.object({
                data: z.string().max(12 * 1024 * 1024),
                mimeType: z.string().regex(/^image\//),
                name: z.string().optional(),
            }).optional(),
        }, {
            required_error: "Preencha o objeto JSON com os campos prompt e history",
            invalid_type_error: "Preencha o objeto JSON com os campos prompt e history"
        })
        const {success, data, error} = body.safeParse(req.body)

        if (!success) {
            return handleError(res, error);
        }

        await iaUsageService.assertWithinQuota(custom.contaId);

        const result = await callChatGeminiService(custom, data.prompt, data.history, data.image);

        return ResponseHandler(res, "Sucesso", result);
    }catch (err: any) {
        if (err instanceof IaQuotaExcededError) {
            return res.status(429).json({ message: err.message });
        }
        handleError(res, err);
    }
};
