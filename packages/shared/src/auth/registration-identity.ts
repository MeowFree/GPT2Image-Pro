import { randomUUID } from "node:crypto";
import { db, registrationIdentity, user } from "@repo/database";
import { eq, sql } from "drizzle-orm";
import { canonicalizeEmailForIdentity } from "./email-domain";

export async function isRegistrationEmailTaken(email: string) {
  const normalizedEmail = canonicalizeEmailForIdentity(email);

  if (!normalizedEmail) {
    return false;
  }

  const [identity] = await db
    .select({ id: registrationIdentity.id })
    .from(registrationIdentity)
    .where(eq(registrationIdentity.email, normalizedEmail))
    .limit(1);

  if (identity) {
    return true;
  }

  const [existingUser] = await db
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(${user.email}) = ${normalizedEmail}`)
    .limit(1);

  return Boolean(existingUser);
}

export async function recordRegistrationIdentity(
  email: string,
  userId?: string | null
) {
  const normalizedEmail = canonicalizeEmailForIdentity(email);
  const now = new Date();

  if (!normalizedEmail) {
    return;
  }

  await db
    .insert(registrationIdentity)
    .values({
      id: randomUUID(),
      email: normalizedEmail,
      userId: userId ?? null,
      firstRegisteredAt: now,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: registrationIdentity.email,
      set: {
        userId: userId ?? null,
        lastSeenAt: now,
        updatedAt: now,
      },
    });
}

export async function markRegistrationIdentityDeleted(
  email: string,
  userId?: string | null
) {
  const normalizedEmail = canonicalizeEmailForIdentity(email);
  const now = new Date();

  if (!normalizedEmail) {
    return;
  }

  await db
    .insert(registrationIdentity)
    .values({
      id: randomUUID(),
      email: normalizedEmail,
      userId: userId ?? null,
      firstRegisteredAt: now,
      lastSeenAt: now,
      deletedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: registrationIdentity.email,
      set: {
        userId: userId ?? null,
        lastSeenAt: now,
        deletedAt: now,
        updatedAt: now,
      },
    });
}
