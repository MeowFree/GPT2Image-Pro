/**
 * UOL 操作注册 - storage（对象存储）领域
 *
 * 职责：注册所有 storage 领域的操作定义到全局注册表。
 * 包含用户面（上传/删除/读取）与系统内部（put/get/delete/signedUrl）操作。
 *
 * 使用方：应用启动时通过 operations/index.ts 统一导入完成注册。
 * 关键依赖：../registry（defineOperation）、zod（schema 校验）
 *
 * 注意：
 * - 所有 execute 均为 stub，待后续接入实际 service 层实现。
 * - 本域不涉及扣费，存储操作天然幂等。
 * - local provider 下 getSignedUploadUrl 返回的是 GET 路由（不可 PUT），
 *   预签名直传仅 S3 可用。
 */
import { z } from "zod";

import { defineOperation } from "../registry";

// ---------------------------------------------------------------------------
// 1. storage.getSignedUploadUrl
//    获取头像/用户文件的预签名上传 URL（S3 直传）
// ---------------------------------------------------------------------------
export const getSignedUploadUrl = defineOperation({
  name: "storage.getSignedUploadUrl",
  domain: "storage",
  title: "获取预签名上传 URL",
  description:
    "为已认证用户生成预签名的对象存储上传 URL（头像/用户文件）。" +
    "S3 后端返回可直传的 PUT URL；local 后端返回 GET 路由地址（不可 PUT）。" +
    "需验证桶白名单与套餐能力。",
  input: z.object({
    bucket: z.string().min(1),
    key: z.string().min(1),
    contentType: z.string().min(1),
  }),
  output: z.object({
    url: z.string(),
    key: z.string(),
  }),
  access: { kind: "protected" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: ["storage"],
  execute: async () => {
    throw new Error("Not yet wired: storage.getSignedUploadUrl");
  },
});

// ---------------------------------------------------------------------------
// 2. storage.deleteFile
//    删除用户文件（需归属校验）
// ---------------------------------------------------------------------------
export const deleteFile = defineOperation({
  name: "storage.deleteFile",
  domain: "storage",
  title: "删除用户文件",
  description:
    "删除用户拥有的存储文件。需验证桶白名单与文件归属（owner）。" +
    "操作幂等：删除不存在的 key 不报错。",
  input: z.object({
    bucket: z.string().min(1),
    key: z.string().min(1),
  }),
  output: z.object({
    success: z.boolean(),
  }),
  access: { kind: "owner", resource: "storage-file" },
  readOnly: false,
  destructive: true,
  idempotency: { kind: "natural" },
  sideEffects: ["storage"],
  execute: async () => {
    throw new Error("Not yet wired: storage.deleteFile");
  },
});

// ---------------------------------------------------------------------------
// 3. storage.readObject
//    读取存储对象（GET 代理），权限因桶而异
// ---------------------------------------------------------------------------
export const readObject = defineOperation({
  name: "storage.readObject",
  domain: "storage",
  title: "读取存储对象",
  description:
    "通过 GET 代理读取对象存储中的文件。权限因桶而异：" +
    "avatars 桶公开访问；generations 桶需已认证 + 属主校验。" +
    "执行桶白名单与路径防穿越校验。",
  input: z.object({
    bucket: z.string().min(1),
    key: z.string().min(1),
  }),
  output: z.object({
    data: z.instanceof(Uint8Array).or(z.unknown()),
    contentType: z.string().optional(),
    contentLength: z.number().optional(),
  }),
  access: { kind: "protected" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  execute: async () => {
    throw new Error("Not yet wired: storage.readObject");
  },
});

// ---------------------------------------------------------------------------
// 4. storage.createPresignedUpload
//    创建预签名上传 URL（文档上传，独立于 shared storage provider）
// ---------------------------------------------------------------------------
export const createPresignedUpload = defineOperation({
  name: "storage.createPresignedUpload",
  domain: "storage",
  title: "创建预签名上传 URL（文档上传）",
  description:
    "为已认证用户创建文档上传的预签名 URL。独立于 shared storage provider，" +
    "直接使用 S3Client。Content-Type 由服务端派生以防 XSS。" +
    "fileKey 含随机部分，操作天然幂等。",
  input: z.object({
    filename: z.string().min(1),
    contentType: z.string().min(1),
    contentLength: z.number().positive(),
  }),
  output: z.object({
    url: z.string(),
    fileKey: z.string(),
  }),
  access: { kind: "protected" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: ["storage"],
  execute: async () => {
    throw new Error("Not yet wired: storage.createPresignedUpload");
  },
});

// ---------------------------------------------------------------------------
// 5. storage.putObject
//    写入对象到存储（系统内部调用，管线调用方已完成鉴权与扣费）
// ---------------------------------------------------------------------------
export const putObject = defineOperation({
  name: "storage.putObject",
  domain: "storage",
  title: "写入存储对象",
  description:
    "将数据写入对象存储（S3 PutObject / local writeFile）。" +
    "仅供系统内部调用（图像管线等），调用方已完成鉴权与扣费。" +
    "key 含随机 nanoid，覆盖写天然幂等。",
  input: z.object({
    bucket: z.string().min(1),
    key: z.string().min(1),
    data: z.unknown(),
    contentType: z.string().optional(),
  }),
  output: z.object({
    success: z.boolean(),
    key: z.string(),
  }),
  access: { kind: "system" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: ["storage"],
  execute: async () => {
    throw new Error("Not yet wired: storage.putObject");
  },
});

// ---------------------------------------------------------------------------
// 6. storage.getObject
//    从存储读取对象（系统内部调用）
// ---------------------------------------------------------------------------
export const getObject = defineOperation({
  name: "storage.getObject",
  domain: "storage",
  title: "读取存储对象（内部）",
  description:
    "从对象存储读取文件内容（S3 GetObject / local readFile）。" +
    "仅供系统内部调用，调用方负责桶限制与防穿越校验。",
  input: z.object({
    bucket: z.string().min(1),
    key: z.string().min(1),
  }),
  output: z.object({
    data: z.unknown(),
    contentType: z.string().optional(),
    contentLength: z.number().optional(),
  }),
  access: { kind: "system" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  execute: async () => {
    throw new Error("Not yet wired: storage.getObject");
  },
});

// ---------------------------------------------------------------------------
// 7. storage.deleteObject
//    删除存储对象（系统内部，维护任务批量清理）
// ---------------------------------------------------------------------------
export const deleteObject = defineOperation({
  name: "storage.deleteObject",
  domain: "storage",
  title: "删除存储对象（内部维护）",
  description:
    "从对象存储删除文件（批量清理过期生成图等维护任务）。" +
    "仅供系统内部 cron/admin 调用。操作幂等：删除不存在的 key 不报错。",
  input: z.object({
    bucket: z.string().min(1),
    key: z.string().min(1),
  }),
  output: z.object({
    success: z.boolean(),
  }),
  access: { kind: "system" },
  readOnly: false,
  destructive: true,
  idempotency: { kind: "natural" },
  sideEffects: ["storage"],
  hasMaintenanceWrite: true,
  execute: async () => {
    throw new Error("Not yet wired: storage.deleteObject");
  },
});

// ---------------------------------------------------------------------------
// 8. storage.getSignedReadUrl
//    获取预签名读取 URL（系统内部调用）
// ---------------------------------------------------------------------------
export const getSignedReadUrl = defineOperation({
  name: "storage.getSignedReadUrl",
  domain: "storage",
  title: "获取预签名读取 URL（内部）",
  description:
    "为存储对象生成临时可读的预签名 URL。" +
    "S3 后端使用 getSignedUrl；local 后端拼接本地路由地址。" +
    "仅供系统内部调用。",
  input: z.object({
    bucket: z.string().min(1),
    key: z.string().min(1),
    expiresIn: z.number().positive().optional(),
  }),
  output: z.object({
    url: z.string(),
  }),
  access: { kind: "system" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  execute: async () => {
    throw new Error("Not yet wired: storage.getSignedReadUrl");
  },
});
