import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db, account, user } from "@repo/database";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";

import { normalizeUserRole } from "./roles";
import {
  isSelfUseModeEnabled,
  LOCAL_SUPER_ADMIN_EMAIL,
} from "./self-use-mode";

let bootstrapped = false;

function generatePassword() {
  return randomBytes(24).toString("base64url");
}

function credentialsPath() {
  return (
    process.env.GPT2IMAGE_BOOTSTRAP_CREDENTIALS_PATH?.trim() ||
    path.join(process.cwd(), ".gpt2image", "super-admin-credentials.txt")
  );
}

async function persistInitialCredentials(input: {
  email: string;
  password: string;
  userId: string;
}) {
  const filePath = credentialsPath();
  const body = [
    "GPT2IMAGE self-use super admin credentials",
    "",
    `createdAt=${new Date().toISOString()}`,
    `email=${input.email}`,
    `password=${input.password}`,
    `userId=${input.userId}`,
    "",
    "Keep this file private. Delete it after saving the password elsewhere.",
    "",
  ].join("\n");

  try {
    await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    await writeFile(filePath, body, { encoding: "utf8", mode: 0o600 });
    console.warn(
      `[GPT2IMAGE] Self-use super admin initialized. Email: ${input.email}. Password written to credentials file: ${filePath}`
    );
  } catch (error) {
    console.warn(
      `[GPT2IMAGE] Self-use super admin initialized. Email: ${input.email}. Failed to write credentials file (${
        error instanceof Error ? error.message : String(error)
      }); re-run after fixing file permissions to capture the generated password.`
    );
  }
}

async function findLocalAdmin() {
  const [record] = await db
    .select({
      id: user.id,
      email: user.email,
      role: user.role,
    })
    .from(user)
    .where(eq(user.email, LOCAL_SUPER_ADMIN_EMAIL))
    .limit(1);

  return record;
}

async function hasCredentialAccount(userId: string) {
  const [record] = await db
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
    .limit(1);

  return Boolean(record);
}

async function createCredentialAccount(userId: string, password: string) {
  await db.insert(account).values({
    id: randomUUID(),
    accountId: userId,
    providerId: "credential",
    userId,
    password: await hashPassword(password),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

export async function bootstrapSelfUseSuperAdmin() {
  if (bootstrapped) return;
  bootstrapped = true;

  try {
    if (!(await isSelfUseModeEnabled())) return;

    const [existingSuperAdmin] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.role, "super_admin"))
      .limit(1);

    if (existingSuperAdmin) return;

    const existingLocalAdmin = await findLocalAdmin();
    if (existingLocalAdmin) {
      if (normalizeUserRole(existingLocalAdmin.role) !== "super_admin") {
        await db
          .update(user)
          .set({
            role: "super_admin",
            emailVerified: true,
            updatedAt: new Date(),
          })
          .where(eq(user.id, existingLocalAdmin.id));
      }

      if (!(await hasCredentialAccount(existingLocalAdmin.id))) {
        const password = generatePassword();
        await createCredentialAccount(existingLocalAdmin.id, password);
        await persistInitialCredentials({
          email: LOCAL_SUPER_ADMIN_EMAIL,
          password,
          userId: existingLocalAdmin.id,
        });
      }
      return;
    }

    const userId = randomUUID();
    const password = generatePassword();
    await db.insert(user).values({
      id: userId,
      name: "GPT2IMAGE Super Admin",
      email: LOCAL_SUPER_ADMIN_EMAIL,
      emailVerified: true,
      role: "super_admin",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await createCredentialAccount(userId, password);
    await persistInitialCredentials({
      email: LOCAL_SUPER_ADMIN_EMAIL,
      password,
      userId,
    });
  } catch (error) {
    console.warn(
      `[GPT2IMAGE] Self-use super admin bootstrap skipped: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
