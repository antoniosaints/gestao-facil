import { enqueueResendEmail } from "../../queues/emailScheduleQueue";
import { prisma } from "../../utils/prisma";
import { createTextEmailJob } from "../email/resendEmailJob";
import { emailNotificationSelect, getNotificationEmail, type EmailNotificationEvent } from "./notificationChannelPolicy";

export async function emailNotificationRecipient(contaId: number, event: EmailNotificationEvent) {
  const preferences = await prisma.parametrosConta.findUnique({
    where: { contaId },
    select: emailNotificationSelect,
  });
  return getNotificationEmail(preferences, event);
}

export async function enqueueEmailNotification(
  event: EmailNotificationEvent,
  payload: { title: string; body: string },
  contaId: number,
) {
  const to = await emailNotificationRecipient(contaId, event);
  if (!to) return false;
  await enqueueResendEmail({
    ...createTextEmailJob({ to, subject: payload.title, text: payload.body }),
    notification: { contaId, event },
  });
  return true;
}
