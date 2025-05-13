import { ZodSchema } from "zod";

export function validate<T>(schema: ZodSchema<T>, body: unknown): { data?: T; error?: string } {
    const result = schema.safeParse(body);

    if (result.success) {
        return { data: result.data };
    } else {
        const errorMessages = result.error.errors.map(err => `${err.path.join('.')}: ${err.message}`).join(', ');
        return { error: errorMessages };
    }
}