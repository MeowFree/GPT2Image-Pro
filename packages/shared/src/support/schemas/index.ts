// 工单 Schema 模块导出
export {
  type AddTicketMessageInput,
  addTicketMessageSchema,
  // 类型
  type CreateTicketInput,
  // Schema
  createTicketSchema,
  MAX_TICKET_ATTACHMENT_BYTES,
  MAX_TICKET_ATTACHMENTS,
  // 选项配置
  ticketCategories,
  ticketPriorities,
  ticketStatuses,
  type UpdateTicketStatusInput,
  updateTicketStatusSchema,
} from "./ticket";
