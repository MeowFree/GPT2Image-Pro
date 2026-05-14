import { randomInt, randomUUID } from "node:crypto";
import { db, verification } from "@repo/database";
import { eq } from "drizzle-orm";
import {
  getAllowedRegistrationEmailMessage,
  isAllowedRegistrationEmail,
  normalizeEmail,
} from "./email-domain";
import { isRegistrationEmailTaken } from "./registration-identity";
import { RegistrationVerificationCodeEmail } from "../mail/templates/primary-action-email";
import { sendEmail } from "../mail/utils";

const PURPOSE = "registration-email-code";
const CODE_LENGTH = 6;
const EXPIRES_IN_MINUTES = 10;

function getIdentifier(email: string) {
  return `${PURPOSE}:${normalizeEmail(email)}`;
}

function generateCode() {
  return Array.from({ length: CODE_LENGTH }, () => randomInt(0, 10)).join("");
}

export async function sendRegistrationVerificationCode(email: string) {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error("Invalid email address");
  }

  if (!isAllowedRegistrationEmail(normalizedEmail)) {
    throw new Error(getAllowedRegistrationEmailMessage());
  }

  if (await isRegistrationEmailTaken(normalizedEmail)) {
    throw new Error("Email already registered");
  }

  const identifier = getIdentifier(normalizedEmail);
  const code = generateCode();
  const expiresAt = new Date(Date.now() + EXPIRES_IN_MINUTES * 60 * 1000);

  await db.delete(verification).where(eq(verification.identifier, identifier));
  await db.insert(verification).values({
    id: randomUUID(),
    identifier,
    value: code,
    expiresAt,
  });

  const result = await sendEmail({
    to: normalizedEmail,
    subject: "Your GPT2IMAGE verification code",
    react: RegistrationVerificationCodeEmail({
      code,
      expiresIn: `${EXPIRES_IN_MINUTES} minutes`,
    }),
  });

  if (!result.success) {
    await db
      .delete(verification)
      .where(eq(verification.identifier, identifier));
    throw new Error(result.error || "Failed to send verification code");
  }

  return { simulated: result.simulated ?? false };
}

export async function verifyRegistrationCode(email: string, code: string) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedCode = code.trim();

  if (!normalizedEmail || !normalizedCode) {
    return false;
  }

  const identifier = getIdentifier(normalizedEmail);
  const [record] = await db
    .select()
    .from(verification)
    .where(eq(verification.identifier, identifier))
    .limit(1);

  if (!record) {
    return false;
  }

  if (record.expiresAt.getTime() < Date.now()) {
    await db.delete(verification).where(eq(verification.id, record.id));
    return false;
  }

  const valid = record.value === normalizedCode;

  if (valid) {
    await db.delete(verification).where(eq(verification.id, record.id));
  }

  return valid;
}
