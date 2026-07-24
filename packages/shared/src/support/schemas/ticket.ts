import { z } from "zod";

export const MAX_TICKET_ATTACHMENTS = 4;
export const MAX_TICKET_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const ticketAttachmentIdsSchema = z
  .array(z.string().uuid("附件ID无效"))
  .max(MAX_TICKET_ATTACHMENTS, `每条消息最多上传${MAX_TICKET_ATTACHMENTS}张图片`)
  .refine((ids) => new Set(ids).size === ids.length, "附件不能重复")
  .default([]);

/**
 * 工单类别选项
 */
export const ticketCategories = [
  { value: "billing", label: "账单问题" },
  { value: "technical", label: "技术支持" },
  { value: "bug", label: "Bug 报告" },
  { value: "feature", label: "功能建议" },
  { value: "other", label: "其他" },
] as const;

/**
 * 工单优先级选项
 */
export const ticketPriorities = [
  { value: "low", label: "低", color: "bg-green-500" },
  { value: "medium", label: "中", color: "bg-yellow-500" },
  { value: "high", label: "高", color: "bg-red-500" },
] as const;

/**
 * 工单状态选项
 */
export const ticketStatuses = [
  { value: "open", label: "待处理", color: "bg-blue-500" },
  { value: "in_progress", label: "处理中", color: "bg-yellow-500" },
  { value: "resolved", label: "已解决", color: "bg-green-500" },
  { value: "closed", label: "已关闭", color: "bg-gray-500" },
] as const;

/**
 * 创建工单 Schema
 */
export const createTicketSchema = z.object({
  /** 工单主题 */
  subject: z
    .string()
    .min(5, "主题至少需要5个字符")
    .max(200, "主题最多200个字符"),
  /** 工单类别 */
  category: z.enum(["billing", "technical", "bug", "feature", "other"]),
  /** 优先级 */
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  /** 初始消息内容 */
  message: z
    .string()
    .min(10, "消息内容至少需要10个字符")
    .max(5000, "消息内容最多5000个字符"),
  /** 初始消息图片附件 */
  attachmentIds: ticketAttachmentIdsSchema,
});

/**
 * 添加工单消息 Schema
 */
export const addTicketMessageSchema = z.object({
  /** 工单 ID */
  ticketId: z.string().min(1, "工单ID不能为空"),
  /** 消息内容 */
  content: z
    .string()
    .min(1, "消息内容不能为空")
    .max(5000, "消息内容最多5000个字符"),
  /** 消息图片附件 */
  attachmentIds: ticketAttachmentIdsSchema,
});

/**
 * 更新工单状态 Schema (管理员)
 */
export const updateTicketStatusSchema = z.object({
  /** 工单 ID */
  ticketId: z.string().min(1, "工单ID不能为空"),
  /** 新状态 */
  status: z.enum(["open", "in_progress", "resolved", "closed"]),
});

/**
 * 类型导出
 */
export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type AddTicketMessageInput = z.infer<typeof addTicketMessageSchema>;
export type UpdateTicketStatusInput = z.infer<typeof updateTicketStatusSchema>;
