import { Response } from "express";

export const ResponseHandler = (response: Response, message: string, body?: any, code: number = 200) => {
    return response.status(code).json({
        status: code,
        message,
        data: body || null,
    });
}