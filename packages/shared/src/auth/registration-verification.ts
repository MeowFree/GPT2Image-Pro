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
import { isSelfUseModeEnabled } from "./self-use-mode";

const PURPOSE = "registration-email-code";
const CODE_LENGTH = 6;
const EXPIRES_IN_MINUTES = 10;
const MAX_VERIFY_ATTEMPTS = 5;

function getIdentifier(email: string) {
  return `${PURPOSE}:${normalizeEmail(email)}`;
}

function generateCode() {
  return Array.from({ length: CODE_LENGTH }, () => randomInt(0, 10)).join("");
}

// value 字段编码为 `code|attempts`，用于在不新增列的前提下记录错误尝试次数。
// 仅本模块（PURPOSE 前缀的 identifier）使用该编码。
function encodeCodeValue(code: string, attempts: number) {
  return `${code}|${attempts}`;
}

function decodeCodeValue(value: string): { code: string; attempts: number } {
  const separatorIndex = value.lastIndexOf("|");
  if (separatorIndex < 0) {
    return { code: value, attempts: 0 };
  }
  const code = value.slice(0, separatorIndex);
  const attempts = Number(value.slice(separatorIndex + 1));
  return { code, attempts: Number.isFinite(attempts) ? attempts : 0 };
}

export async function sendRegistrationVerificationCode(email: string) {
  if (await isSelfUseModeEnabled()) {
    throw new Error("Registration is disabled in self-use mode");
  }

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
    value: encodeCodeValue(code, 0),
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

  const { code: storedCode, attempts } = decodeCodeValue(record.value);

  // 超过最大错误次数：作废验证码，阻断暴力破解（6 位码空间仅 10^6）。
  if (attempts >= MAX_VERIFY_ATTEMPTS) {
    await db.delete(verification).where(eq(verification.id, record.id));
    return false;
  }

  const valid = storedCode === normalizedCode;

  if (valid) {
    await db.delete(verification).where(eq(verification.id, record.id));
    return true;
  }

  // 记录一次失败尝试；达到上限即作废。
  const nextAttempts = attempts + 1;
  if (nextAttempts >= MAX_VERIFY_ATTEMPTS) {
    await db.delete(verification).where(eq(verification.id, record.id));
  } else {
    await db
      .update(verification)
      .set({ value: encodeCodeValue(storedCode, nextAttempts) })
      .where(eq(verification.id, record.id));
  }

  return false;
}
