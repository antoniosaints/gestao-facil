import nodemailer from "nodemailer";
import { env } from "./dotenv";

// export const emailSender = nodemailer.createTransport({
//   host: "mail.cas.net.br",
//   port: 587,
//   secure: false, // Use false for STARTTLS
//   auth: {
//     user: "antonio.santos@cas.net.br",
//     pass: "cas20182018",
//   },
// });
export const emailSender = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: env.EMAIL_SENDER,
    pass: env.EMAIL_PASSWORD,
  },
});

export const sendEmailQueue = async (
  to: string,
  subject: string,
  text: string
) => {
  try {
    emailSender.verify((error, success) => {
      if (error) {
        console.error("Erro ao verificar o transporte de email:", error);
        throw new Error("Erro ao verificar o transporte de email");
      }
    });

    const info = await emailSender.sendMail({
      from: '"Antonio Santos" <antonio.santos@cas.net.br>',
      to,
      subject,
      text,
    });
    console.log("Email enviado: %s", info.messageId);
  } catch (error) {
    console.error("Erro ao enviar o email:", error);
    throw error;
  }
};
