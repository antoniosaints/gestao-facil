import { Request, Response } from "express";
import { handleError } from "../../utils/handleError";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { z } from "zod";
import { callChatGeminiService } from "../../external/callGemini";
import { ResponseHandler } from "../../utils/response";

export const callChatGemini = async (req: Request, res: Response): Promise<any> => {
    try {
        const custom = getCustomRequest(req).customData;
        const body = z.object({
            prompt: z.string(),
            history: z.any()
        })
        const {success, data, error} = body.safeParse(req.body)

        if (!success) {
            return handleError(res, error);
        }

        const result = await callChatGeminiService(data.prompt, data.history)

        return ResponseHandler(res, "Sucesso", result);
    }catch (err: any) {
        handleError(res, err);
    }
};