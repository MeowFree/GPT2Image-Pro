/**
 * UOL Operations - Support & Announcements Domain
 *
 * 职责：注册客服工单与公告相关的全部操作定义（19 个）。
 * 使用方：UOL registry 全局注册表，经 invokeOperation 网关调用。
 * 关键依赖：registry.ts (defineOperation)、zod (schema 校验)
 *
 * 所有 execute 均为 stub，待后续接线实际 service 函数。
 */
import { z } from "zod";

import { defineOperation } from "../registry";

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

/**
 * support.createTicket - 用户创建客服工单
 *
 * 权限：protected（登录用户）
 * 副作用：email（通知管理员）
 * 幂等：none（允许重复创建不同工单）
 */
export const createTicket = defineOperation({
  name: "support.createTicket",
  domain: "support",
  title: "Create Support Ticket",
  description:
    "Create a new support ticket for the authenticated user.",
  input: z.object({
    subject: z.string().min(1).max(200),
    message: z.string().min(1).max(5000),
    category: z
      .enum(["bug", "feature", "billing", "account", "other"])
      .optional(),
  }),
  output: z.object({
    ticketId: z.string(),
    createdAt: z.string(),
  }),
  access: { kind: "protected" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["email"],
  execute: async () => {
    throw new Error("Not yet wired: support.createTicket");
  },
});

/**
 * support.getMyTickets - 获取当前用户的工单列表
 *
 * 权限：protected（登录用户）
 * 只读操作
 */
export const getMyTickets = defineOperation({
  name: "support.getMyTickets",
  domain: "support",
  title: "Get My Tickets",
  description:
    "List all support tickets belonging to the authenticated user.",
  input: z.object({
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(1).max(100).optional(),
    status: z
      .enum(["open", "closed", "pending"])
      .optional(),
  }),
  output: z.object({
    tickets: z.array(
      z.object({
        id: z.string(),
        subject: z.string(),
        status: z.string(),
        createdAt: z.string(),
        updatedAt: z.string(),
        hasUnread: z.boolean(),
      }),
    ),
    total: z.number(),
  }),
  access: { kind: "protected" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  execute: async () => {
    throw new Error("Not yet wired: support.getMyTickets");
  },
});

/**
 * support.getTicketDetail - 获取工单详情（用户侧）
 *
 * 权限：protected + owner（需校验工单归属）
 * 只读但有副作用：标记用户已读
 */
export const getTicketDetail = defineOperation({
  name: "support.getTicketDetail",
  domain: "support",
  title: "Get Ticket Detail",
  description:
    "Get full detail of a ticket including messages. Marks user messages as read (side-effect).",
  input: z.object({
    ticketId: z.string().min(1),
  }),
  output: z.object({
    id: z.string(),
    subject: z.string(),
    status: z.string(),
    category: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    messages: z.array(
      z.object({
        id: z.string(),
        content: z.string(),
        sender: z.enum(["user", "admin"]),
        createdAt: z.string(),
        isRead: z.boolean(),
      }),
    ),
  }),
  access: { kind: "owner", resource: "ticket" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: ["cache"],
  hasMaintenanceWrite: true,
  execute: async () => {
    throw new Error("Not yet wired: support.getTicketDetail");
  },
});

/**
 * support.addMessage - 用户在工单中追加消息
 *
 * 权限：protected + owner（需校验工单归属）
 * 副作用：email（通知管理员）
 */
export const addMessage = defineOperation({
  name: "support.addMessage",
  domain: "support",
  title: "Add Ticket Message",
  description:
    "Add a message to an existing ticket owned by the authenticated user.",
  input: z.object({
    ticketId: z.string().min(1),
    message: z.string().min(1).max(5000),
  }),
  output: z.object({
    messageId: z.string(),
    createdAt: z.string(),
  }),
  access: { kind: "owner", resource: "ticket" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["email"],
  execute: async () => {
    throw new Error("Not yet wired: support.addMessage");
  },
});

/**
 * support.getAllTickets - 管理员获取所有工单
 *
 * 权限：admin
 * 只读操作
 */
export const getAllTickets = defineOperation({
  name: "support.getAllTickets",
  domain: "support",
  title: "Get All Tickets (Admin)",
  description:
    "List all support tickets across all users. Admin only.",
  input: z.object({
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(1).max(100).optional(),
    status: z
      .enum(["open", "closed", "pending"])
      .optional(),
    search: z.string().optional(),
  }),
  output: z.object({
    tickets: z.array(
      z.object({
        id: z.string(),
        subject: z.string(),
        status: z.string(),
        userId: z.string(),
        userName: z.string().optional(),
        createdAt: z.string(),
        updatedAt: z.string(),
        hasUnread: z.boolean(),
      }),
    ),
    total: z.number(),
  }),
  access: { kind: "admin" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  execute: async () => {
    throw new Error("Not yet wired: support.getAllTickets");
  },
});

/**
 * support.getAdminUnreadCount - 管理员未读工单计数
 *
 * 权限：admin
 * 只读操作
 */
export const getAdminUnreadCount = defineOperation({
  name: "support.getAdminUnreadCount",
  domain: "support",
  title: "Get Admin Unread Ticket Count",
  description:
    "Get the count of tickets with unread user messages for admin.",
  input: z.object({}),
  output: z.object({
    count: z.number().int().min(0),
  }),
  access: { kind: "admin" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  execute: async () => {
    throw new Error("Not yet wired: support.getAdminUnreadCount");
  },
});

/**
 * support.getMyUnreadCount - 用户未读消息计数
 *
 * 权限：protected（登录用户）
 * 只读操作
 */
export const getMyUnreadCount = defineOperation({
  name: "support.getMyUnreadCount",
  domain: "support",
  title: "Get My Unread Ticket Count",
  description:
    "Get the count of tickets with unread admin replies for the authenticated user.",
  input: z.object({}),
  output: z.object({
    count: z.number().int().min(0),
  }),
  access: { kind: "protected" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  execute: async () => {
    throw new Error("Not yet wired: support.getMyUnreadCount");
  },
});

/**
 * support.getAdminTicketDetail - 管理员查看工单详情
 *
 * 权限：admin
 * 只读但有副作用：标记管理员已读
 */
export const getAdminTicketDetail = defineOperation({
  name: "support.getAdminTicketDetail",
  domain: "support",
  title: "Get Admin Ticket Detail",
  description:
    "Get full detail of any ticket for admin. Marks admin messages as read (side-effect).",
  input: z.object({
    ticketId: z.string().min(1),
  }),
  output: z.object({
    id: z.string(),
    subject: z.string(),
    status: z.string(),
    category: z.string().optional(),
    userId: z.string(),
    userName: z.string().optional(),
    userEmail: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    messages: z.array(
      z.object({
        id: z.string(),
        content: z.string(),
        sender: z.enum(["user", "admin"]),
        createdAt: z.string(),
        isRead: z.boolean(),
      }),
    ),
  }),
  access: { kind: "admin" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: ["cache"],
  hasMaintenanceWrite: true,
  execute: async () => {
    throw new Error("Not yet wired: support.getAdminTicketDetail");
  },
});

/**
 * support.adminReply - 管理员回复工单
 *
 * 权限：admin
 * 副作用：email（通知用户）
 */
export const adminReply = defineOperation({
  name: "support.adminReply",
  domain: "support",
  title: "Admin Reply to Ticket",
  description: "Admin sends a reply message to a support ticket.",
  input: z.object({
    ticketId: z.string().min(1),
    message: z.string().min(1).max(5000),
  }),
  output: z.object({
    messageId: z.string(),
    createdAt: z.string(),
  }),
  access: { kind: "admin" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: ["email"],
  execute: async () => {
    throw new Error("Not yet wired: support.adminReply");
  },
});

/**
 * support.updateTicketStatus - 管理员更新工单状态
 *
 * 权限：admin
 */
export const updateTicketStatus = defineOperation({
  name: "support.updateTicketStatus",
  domain: "support",
  title: "Update Ticket Status",
  description:
    "Admin updates the status of a support ticket (open/closed/pending).",
  input: z.object({
    ticketId: z.string().min(1),
    status: z.enum(["open", "closed", "pending"]),
  }),
  output: z.object({
    ticketId: z.string(),
    status: z.string(),
    updatedAt: z.string(),
  }),
  access: { kind: "admin" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: [],
  execute: async () => {
    throw new Error("Not yet wired: support.updateTicketStatus");
  },
});

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

/**
 * support.listAnnouncements - 用户获取活跃公告列表
 *
 * 权限：protected（登录用户）
 * 只读操作
 */
export const listAnnouncements = defineOperation({
  name: "support.listAnnouncements",
  domain: "support",
  title: "List Active Announcements",
  description:
    "List all active (published) announcements visible to the authenticated user.",
  input: z.object({
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(1).max(50).optional(),
  }),
  output: z.object({
    announcements: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        content: z.string(),
        publishedAt: z.string(),
        isRead: z.boolean(),
      }),
    ),
    total: z.number(),
  }),
  access: { kind: "protected" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  execute: async () => {
    throw new Error("Not yet wired: support.listAnnouncements");
  },
});

/**
 * support.countUnreadAnnouncements - 用户未读公告计数
 *
 * 权限：protected（登录用户）
 * 只读操作
 */
export const countUnreadAnnouncements = defineOperation({
  name: "support.countUnreadAnnouncements",
  domain: "support",
  title: "Count Unread Announcements",
  description:
    "Get the count of unread announcements for the authenticated user.",
  input: z.object({}),
  output: z.object({
    count: z.number().int().min(0),
  }),
  access: { kind: "protected" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  execute: async () => {
    throw new Error(
      "Not yet wired: support.countUnreadAnnouncements",
    );
  },
});

/**
 * support.markAnnouncementRead - 标记单条公告为已读
 *
 * 权限：protected（登录用户）
 */
export const markAnnouncementRead = defineOperation({
  name: "support.markAnnouncementRead",
  domain: "support",
  title: "Mark Announcement Read",
  description:
    "Mark a single announcement as read for the authenticated user.",
  input: z.object({
    announcementId: z.string().min(1),
  }),
  output: z.object({
    success: z.boolean(),
  }),
  access: { kind: "protected" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  execute: async () => {
    throw new Error("Not yet wired: support.markAnnouncementRead");
  },
});

/**
 * support.markAllAnnouncementsRead - 标记所有公告为已读
 *
 * 权限：protected（登录用户）
 */
export const markAllAnnouncementsRead = defineOperation({
  name: "support.markAllAnnouncementsRead",
  domain: "support",
  title: "Mark All Announcements Read",
  description:
    "Mark all announcements as read for the authenticated user.",
  input: z.object({}),
  output: z.object({
    success: z.boolean(),
    markedCount: z.number().int().min(0),
  }),
  access: { kind: "protected" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  execute: async () => {
    throw new Error(
      "Not yet wired: support.markAllAnnouncementsRead",
    );
  },
});

/**
 * support.getAdminAnnouncements - 管理员获取全部公告（含未发布）
 *
 * 权限：admin
 * 只读操作
 */
export const getAdminAnnouncements = defineOperation({
  name: "support.getAdminAnnouncements",
  domain: "support",
  title: "Get Admin Announcements",
  description:
    "List all announcements (including unpublished) for admin management.",
  input: z.object({
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(1).max(100).optional(),
    published: z.boolean().optional(),
  }),
  output: z.object({
    announcements: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        content: z.string(),
        isPublished: z.boolean(),
        publishedAt: z.string().nullable(),
        createdAt: z.string(),
        updatedAt: z.string(),
      }),
    ),
    total: z.number(),
  }),
  access: { kind: "admin" },
  readOnly: true,
  destructive: false,
  idempotency: { kind: "natural" },
  sideEffects: [],
  execute: async () => {
    throw new Error("Not yet wired: support.getAdminAnnouncements");
  },
});

/**
 * support.createAnnouncement - 管理员创建公告
 *
 * 权限：admin
 */
export const createAnnouncement = defineOperation({
  name: "support.createAnnouncement",
  domain: "support",
  title: "Create Announcement",
  description: "Admin creates a new announcement.",
  input: z.object({
    title: z.string().min(1).max(200),
    content: z.string().min(1).max(10000),
    isPublished: z.boolean().optional(),
  }),
  output: z.object({
    id: z.string(),
    createdAt: z.string(),
  }),
  access: { kind: "admin" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: [],
  execute: async () => {
    throw new Error("Not yet wired: support.createAnnouncement");
  },
});

/**
 * support.updateAnnouncement - 管理员更新公告
 *
 * 权限：admin
 */
export const updateAnnouncement = defineOperation({
  name: "support.updateAnnouncement",
  domain: "support",
  title: "Update Announcement",
  description: "Admin updates an existing announcement.",
  input: z.object({
    announcementId: z.string().min(1),
    title: z.string().min(1).max(200).optional(),
    content: z.string().min(1).max(10000).optional(),
  }),
  output: z.object({
    id: z.string(),
    updatedAt: z.string(),
  }),
  access: { kind: "admin" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: [],
  execute: async () => {
    throw new Error("Not yet wired: support.updateAnnouncement");
  },
});

/**
 * support.deleteAnnouncement - 管理员删除公告（不可逆）
 *
 * 权限：admin
 * 破坏性操作：agent 应二次确认
 */
export const deleteAnnouncement = defineOperation({
  name: "support.deleteAnnouncement",
  domain: "support",
  title: "Delete Announcement",
  description:
    "Admin permanently deletes an announcement. This action is irreversible.",
  input: z.object({
    announcementId: z.string().min(1),
  }),
  output: z.object({
    success: z.boolean(),
  }),
  access: { kind: "admin" },
  readOnly: false,
  destructive: true,
  idempotency: { kind: "none" },
  sideEffects: [],
  execute: async () => {
    throw new Error("Not yet wired: support.deleteAnnouncement");
  },
});

/**
 * support.toggleAnnouncementPublish - 管理员切换公告发布状态
 *
 * 权限：admin
 */
export const toggleAnnouncementPublish = defineOperation({
  name: "support.toggleAnnouncementPublish",
  domain: "support",
  title: "Toggle Announcement Publish",
  description:
    "Admin toggles the published/unpublished state of an announcement.",
  input: z.object({
    announcementId: z.string().min(1),
    isPublished: z.boolean(),
  }),
  output: z.object({
    id: z.string(),
    isPublished: z.boolean(),
    updatedAt: z.string(),
  }),
  access: { kind: "admin" },
  readOnly: false,
  destructive: false,
  idempotency: { kind: "none" },
  sideEffects: [],
  execute: async () => {
    throw new Error(
      "Not yet wired: support.toggleAnnouncementPublish",
    );
  },
});
