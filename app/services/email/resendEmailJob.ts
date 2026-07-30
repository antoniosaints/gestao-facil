export interface ResendEmailJobData {
  provider: "resend";
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
}

export function createResendEmailJob(
  input: Omit<ResendEmailJobData, "provider">,
): ResendEmailJobData {
  return {
    provider: "resend",
    ...input,
    to: Array.isArray(input.to) ? [...input.to] : input.to,
  };
}

export function isResendEmailJobData(value: unknown): value is ResendEmailJobData {
  if (!value || typeof value !== "object") {
    return false;
  }

  const job = value as Partial<ResendEmailJobData>;
  const hasValidRecipient =
    typeof job.to === "string" ||
    (Array.isArray(job.to) &&
      job.to.length > 0 &&
      job.to.every((item) => typeof item === "string"));

  return (
    job.provider === "resend" &&
    hasValidRecipient &&
    typeof job.subject === "string" &&
    typeof job.html === "string"
  );
}
