import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { db, user as userTable } from "@repo/database";
import { eq } from "drizzle-orm";
import {
  getAllowedRegistrationEmailMessage,
  isAllowedRegistrationEmail,
  normalizeEmail,
} from "./email-domain";
import {
  isRegistrationEmailTaken,
  markRegistrationIdentityDeleted,
  recordRegistrationIdentity,
} from "./registration-identity";
import { verifyRegistrationCode } from "./registration-verification";

function assertAllowedRegistrationEmail(email: string) {
  if (!isAllowedRegistrationEmail(email)) {
    throw new APIError("BAD_REQUEST", {
      message: getAllowedRegistrationEmailMessage(),
      code: "EMAIL_DOMAIN_NOT_ALLOWED",
    });
  }
}

async function assertEmailNotRegistered(email: string) {
  const normalizedEmail = normalizeEmail(email);

  if (await isRegistrationEmailTaken(normalizedEmail)) {
    throw new APIError("BAD_REQUEST", {
      message: "Email already registered",
      code: "EMAIL_ALREADY_REGISTERED",
    });
  }
}

async function assertUserCanAuthenticate(userId: string) {
  const [existingUser] = await db
    .select({
      id: userTable.id,
      banned: userTable.banned,
      bannedReason: userTable.bannedReason,
    })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);

  if (existingUser?.banned && existingUser.bannedReason === "account_deleted") {
    throw new APIError("FORBIDDEN", {
      message: "Account has been deleted",
      code: "ACCOUNT_DELETED",
    });
  }
}

export const registrationVerificationPlugin = (): BetterAuthPlugin => ({
  id: "registration-verification",
  hooks: {
    before: [
      {
        matcher: (context) => context.path === "/sign-up/email",
        handler: createAuthMiddleware(async (ctx) => {
          const email =
            typeof ctx.body.email === "string" ? ctx.body.email : "";
          const verificationCode =
            typeof ctx.body.verificationCode === "string"
              ? ctx.body.verificationCode
              : "";
          const normalizedEmail = normalizeEmail(email);

          assertAllowedRegistrationEmail(normalizedEmail);
          await assertEmailNotRegistered(normalizedEmail);

          if (!verificationCode) {
            throw new APIError("BAD_REQUEST", {
              message: "Verification code is required",
              code: "VERIFICATION_CODE_REQUIRED",
            });
          }

          const valid = await verifyRegistrationCode(
            normalizedEmail,
            verificationCode
          );

          if (!valid) {
            throw new APIError("BAD_REQUEST", {
              message: "Invalid or expired verification code",
              code: "INVALID_VERIFICATION_CODE",
            });
          }

          delete ctx.body.verificationCode;
          ctx.body.email = normalizedEmail;
          ctx.body.emailVerified = true;
        }),
      },
    ],
  },
  init: () => ({
    options: {
      databaseHooks: {
        user: {
          create: {
            before: async (user, context) => {
              const normalizedEmail = normalizeEmail(user.email);

              assertAllowedRegistrationEmail(normalizedEmail);
              await assertEmailNotRegistered(normalizedEmail);

              if (context?.path === "/sign-up/email") {
                return {
                  data: {
                    ...user,
                    email: normalizedEmail,
                    emailVerified: true,
                  },
                };
              }

              return {
                data: {
                  ...user,
                  email: normalizedEmail,
                },
              };
            },
            after: async (user) => {
              await recordRegistrationIdentity(user.email, user.id);
            },
          },
          delete: {
            after: async (user) => {
              await markRegistrationIdentityDeleted(user.email, user.id);
            },
          },
        },
        account: {
          create: {
            before: async (account) => {
              await assertUserCanAuthenticate(account.userId);
              return { data: account };
            },
          },
        },
        session: {
          create: {
            before: async (session) => {
              await assertUserCanAuthenticate(session.userId);
              return { data: session };
            },
          },
        },
      },
    },
  }),
});
