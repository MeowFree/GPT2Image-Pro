import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { db, user as userTable } from "@repo/database";
import { eq } from "drizzle-orm";
import {
  getRegistrationEmailErrorCode,
  getRegistrationEmailRejectionMessage,
  getRegistrationEmailRejectionReason,
  normalizeEmail,
} from "./email-domain";
import { getRuntimeRegistrationEmailPolicy } from "./registration-email-policy";
import {
  isRegistrationEmailTaken,
  markRegistrationIdentityDeleted,
  recordRegistrationIdentity,
} from "./registration-identity";
import { verifyRegistrationCode } from "./registration-verification";
import { isSelfUseModeEnabled } from "./self-use-mode";

function isPublicRegistrationPath(path?: string) {
  return (
    path === "/sign-up/email" ||
    path === "/sign-in/social" ||
    Boolean(path?.startsWith("/callback/"))
  );
}

async function assertRegistrationOpen() {
  if (await isSelfUseModeEnabled()) {
    throw new APIError("FORBIDDEN", {
      message: "Registration is disabled in self-use mode",
      code: "REGISTRATION_DISABLED",
    });
  }
}

async function assertAllowedRegistrationEmail(email: string) {
  const policy = await getRuntimeRegistrationEmailPolicy();
  const reason = getRegistrationEmailRejectionReason(email, policy);
  if (reason) {
    throw new APIError("BAD_REQUEST", {
      message: getRegistrationEmailRejectionMessage(reason, policy),
      code: getRegistrationEmailErrorCode(reason),
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

  if (!existingUser?.banned) return;

  // 任意 banned=true 都拒绝创建会话/账户，不再只拦 account_deleted。
  // 否则管理员的普通封禁（banUserAction 写入的 banned=true + 普通原因）在 Web 通道形同摆设，
  // 被封用户重新登录即可创建新会话照常调用受保护操作（生图/扣费/工单/设置）。
  if (existingUser.bannedReason === "account_deleted") {
    throw new APIError("FORBIDDEN", {
      message: "Account has been deleted",
      code: "ACCOUNT_DELETED",
    });
  }

  throw new APIError("FORBIDDEN", {
    message: "Account has been banned",
    code: "ACCOUNT_BANNED",
  });
}

export const registrationVerificationPlugin = (): BetterAuthPlugin => ({
  id: "registration-verification",
  hooks: {
    before: [
      {
        matcher: (context) => context.path === "/sign-up/email",
        handler: createAuthMiddleware(async (ctx) => {
          await assertRegistrationOpen();

          const email =
            typeof ctx.body.email === "string" ? ctx.body.email : "";
          const verificationCode =
            typeof ctx.body.verificationCode === "string"
              ? ctx.body.verificationCode
              : "";
          const normalizedEmail = normalizeEmail(email);

          await assertAllowedRegistrationEmail(normalizedEmail);
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
              if (isPublicRegistrationPath(context?.path)) {
                await assertRegistrationOpen();
              }

              const normalizedEmail = normalizeEmail(user.email);

              await assertAllowedRegistrationEmail(normalizedEmail);
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
