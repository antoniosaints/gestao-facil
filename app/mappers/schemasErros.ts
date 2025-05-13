import { ZodError } from "zod";
interface ErrorMessage {
    message: string;
}
export const mapperErrorSchema = (erros: ZodError): ErrorMessage[] => {
    const errors = erros.issues.map((error) => {
        return {
            message: error.message,
        };
    });
    return errors;
}