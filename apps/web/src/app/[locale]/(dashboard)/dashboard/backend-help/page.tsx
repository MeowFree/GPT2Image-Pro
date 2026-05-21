import { getCurrentUser } from "@repo/shared/auth/server";
import { Badge } from "@repo/ui/components/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import {
  ArrowDown,
  ArrowRight,
  Check,
  CircleHelp,
  ExternalLink,
  X,
} from "lucide-react";
import { getLocale } from "next-intl/server";
import { redirect } from "next/navigation";

const sections = {
  zh: {
    title: "系统文档",
    subtitle:
      "这里按当前代码真实链路说明：六个入口都是协议适配层，不互相 HTTP 调用，最终统一进入同一套生成、扣费、调度和存储链路。",
    flow: {
      title: "请求路由图",
      note:
        "用户自接 API 目前仍保留最高优先级；没有可用的用户自接 API 时，才进入平台后端池。外接接口不会反向请求站内 /api/images/*。",
      entryTitle: "入口",
      resolverTitle: "统一处理",
      groupTitle: "分组选择",
      backendTitle: "后端落点",
      entries: [
        {
          label: "页面文生图",
          path: "POST /api/images/generate",
          kind: "image_generation",
        },
        {
          label: "页面图生图",
          path: "POST /api/images/edit",
          kind: "image_edit",
        },
        {
          label: "页面对话生图",
          path: "POST /api/images/chat",
          kind: "chat",
        },
        {
          label: "外部文生图 API",
          path: "POST /v1/images/generations",
          kind: "image_generation",
        },
        {
          label: "外部图生图 API",
          path: "POST /v1/images/edits",
          kind: "image_edit",
        },
        {
          label: "外部 Responses API",
          path: "POST /v1/responses",
          kind: "responses",
        },
      ],
      resolver: [
        "校验登录态或外部 API Key",
        "把页面表单或 OpenAI 兼容请求转换为统一运行参数",
        "计算积分和审核成本",
        "调用 runImageGenerationForUser 进入统一生成链路",
      ],
      groups: [
        "外部 API Key 绑定分组优先",
        "其次使用用户在设置里选择的生图后端分组",
        "没有显式选择时使用默认启用分组",
        "分组会检查套餐权限、是否启用、内容安全开关",
      ],
      backends: [
        {
          title: "用户自接 API",
          description:
            "如果用户设置了自己的 OpenAI 兼容 API，会先直接使用它；这是过渡保留逻辑。",
        },
        {
          title: "Web 账号池",
          description:
            "通过 ChatGPT Web 链路承接页面文生图、图生图和对话生图。",
        },
        {
          title: "Codex/Responses 账号池",
          description:
            "通过 Responses 语义承接 responses，也能把 image generation/edit 转成 responses 请求。",
        },
        {
          title: "外接 API 后端",
          description:
            "管理员配置的 OpenAI 兼容 Base URL/API Key；按当前请求类型调用 images 或 responses 端点。",
        },
      ],
    },
    routeTables: {
      title: "入口到后端的映射",
      pageTitle: "页面请求",
      apiTitle: "外接 API 请求",
      headers: ["入口", "站内接口", "调度类型", "后端池行为"],
      apiHeaders: ["入口", "兼容接口", "调度类型", "后端池行为"],
      pageRows: [
        [
          "创作页文生图",
          "/api/images/generate",
          "image_generation",
          "可命中用户自接 API、Web 账号、Codex/Responses 账号或外接 API 后端。",
        ],
        [
          "创作页图生图",
          "/api/images/edit",
          "image_edit",
          "参考图先进入站内接口，再按选中的后端分组调度。",
        ],
        [
          "创作页对话生图",
          "/api/images/chat",
          "chat",
          "按 chat 类型选择后端；可命中 Web 账号、Codex/Responses 账号或支持 /responses 的外接 API 后端。",
        ],
      ],
      apiRows: [
        [
          "OpenAI images generation",
          "/v1/images/generations",
          "image_generation",
          "验证 API Key 和套餐后进入同一生成链路；默认返回 b64_json，可显式请求 url。",
        ],
        [
          "OpenAI images edit",
          "/v1/images/edits",
          "image_edit",
          "multipart 图片会被转成统一图片输入，再按分组调度。",
        ],
        [
          "OpenAI Responses",
          "/v1/responses",
          "responses",
          "无 tools 时平台补 image_generation；显式传 tools 时必须包含 image_generation。按 responses 类型只调度 Codex/Responses 分组或外接 /responses API。",
        ],
        [
          "OpenAI models",
          "/v1/models",
          "-",
          "只返回当前套餐/API Key 可见模型，不触发后端池调度。",
        ],
      ],
    },
    relationship: {
      title: "六个接口的关系",
      rows: [
        [
          "页面三接口",
          "/api/images/generate、/api/images/edit、/api/images/chat",
          "浏览器登录态入口，只负责页面表单、参考图和站内流式事件适配。",
        ],
        [
          "外接三接口",
          "/v1/images/generations、/v1/images/edits、/v1/responses",
          "/api/v1/* 是同一 handler 的别名；只负责 API Key、OpenAI 兼容请求和响应格式适配。",
        ],
        [
          "共同核心",
          "runImageGenerationForUser",
          "扣费、审核、排队、账号池选择、错误标记、冷却、失败退款和图片存储都在这一层。",
        ],
        [
          "后端执行",
          "generateImage / editImage / generateChatImage",
          "按命中的成员转换成 ChatGPT Web、Codex/Responses 或外接 API 请求。",
        ],
      ],
      note:
        "所以关系不是“外接 API 调页面 API”，而是“六个入口共享同一个 service 层”。",
    },
    externalDocs: {
      title: "外接 API 详细文档",
      subtitle:
        "以下按 OpenAI 官方接口形态整理本站当前支持范围。粗体字段为本站扩展或兼容增强，不属于标准 OpenAI 字段。",
      commonTitle: "通用规则",
      baseUrlTitle: "Base URL",
      baseUrl: "https://gpt2image.superapi.buzz",
      examplesTitle: "请求示例",
      responseExampleTitle: "响应示例",
      common: [
        "所有外接接口都需要 Authorization: Bearer <本站 API Key>。",
        "图片生成和图片编辑接口需要入门版及以上；Responses 接口需要专业版及以上。",
        "/api/v1/* 与 /v1/* 使用同一套 handler，只是路径别名。",
        "错误响应采用 OpenAI 风格 error 对象；本站可能额外返回 generation_id、generationId、credits_consumed 方便排查和对账。",
        "外接 API Key 绑定的后端分组优先；未绑定时使用用户默认分组，再回退默认启用分组。",
      ],
      officialRefsTitle: "官方参考",
      officialRefs: [
        {
          label: "Images API",
          href: "https://developers.openai.com/api/reference/resources/images",
        },
        {
          label: "Responses API",
          href: "https://developers.openai.com/api/reference/resources/responses/methods/create",
        },
        {
          label: "Models API",
          href: "https://developers.openai.com/api/reference/resources/models/methods/list",
        },
      ],
      fieldHeaders: ["字段", "要求", "说明"],
      responseHeaders: ["返回字段", "说明"],
      requestTitle: "请求字段",
      responseTitle: "返回与流式",
      notesTitle: "实现说明",
      customLabel: "本站扩展",
      docs: [
        {
          title: "List models",
          method: "GET",
          path: "/v1/models",
          contentType: "无请求体",
          description:
            "兼容 OpenAI List models，用于列出当前 API Key 所属用户可见的图片模型和 Responses 模型。",
          example: `curl https://gpt2image.superapi.buzz/v1/models \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY"`,
          responseExample: `{
  "object": "list",
  "data": [
    {
      "id": "gpt-image-2",
      "object": "model",
      "created": 0,
      "owned_by": "gpt2image"
    }
  ]
}`,
          fields: [
            {
              name: "Authorization",
              requirement: "必填 header",
              description: "Bearer <本站 API Key>。",
            },
          ],
          responses: [
            {
              name: "object",
              description: "固定为 list。",
            },
            {
              name: "data[].id",
              description:
                "模型 ID。包含本站开放的图片模型以及当前套餐可用的 Responses 模型。",
            },
            {
              name: "data[].object / created / owned_by",
              description: "兼容 OpenAI model object 结构。",
            },
          ],
          notes: [
            "本站当前只实现模型列表，不实现 /v1/models/{model} 详情。",
            "返回模型会按套餐过滤；Ultra 用户可见更多 Responses 模型。",
          ],
        },
        {
          title: "Create image",
          method: "POST",
          path: "/v1/images/generations",
          contentType: "application/json",
          description:
            "兼容 OpenAI Images generation。请求会转换成 image_generation 调度类型，进入统一生成链路。",
          example: `curl https://gpt2image.superapi.buzz/v1/images/generations \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-image-1.5",
    "prompt": "一张赛博朋克城市夜景，雨后霓虹反光",
    "size": "1024x1024",
    "quality": "medium",
    "response_format": "url"
  }'`,
          responseExample: `{
  "created": 1713833628,
  "data": [
    {
      "url": "https://gpt2image.superapi.buzz/api/storage/generations/..."
    }
  ]
}`,
          fields: [
            {
              name: "prompt",
              requirement: "必填",
              description: "图片提示词，最多 4000 字符。",
            },
            {
              name: "model",
              requirement: "可选",
              description:
                "图片模型。本站只接受 gpt-image-* 类图片模型；Responses 对话模型请使用 /v1/responses。",
            },
            {
              name: "n",
              requirement: "可选",
              description: "生成数量，1 到 10。",
            },
            {
              name: "size",
              requirement: "可选",
              description:
                "目标尺寸。支持本站分辨率校验规则，非法尺寸会返回参数错误。",
            },
            {
              name: "quality",
              requirement: "可选",
              description: "auto、low、medium、high。",
            },
            {
              name: "moderation",
              requirement: "可选",
              description: "auto 或 low。",
            },
            {
              name: "response_format",
              requirement: "可选",
              description:
                "url 或 b64_json。默认 b64_json；url 会返回本站存储 URL。",
            },
            {
              name: "stream",
              requirement: "可选",
              description: "true 时返回 text/event-stream。",
            },
            {
              name: "promptOptimization / prompt_optimization",
              requirement: "可选",
              custom: true,
              description:
                "控制平台是否继续优化 prompt。若 prompt 已是优化后的最终提示词，建议传 false。",
            },
            {
              name: "gptModel / gpt_model",
              requirement: "可选",
              custom: true,
              description:
                "当命中 Codex/Responses 账号池时，作为 Responses 顶层 GPT 模型；普通 Images API 后端可能忽略。",
            },
            {
              name: "thinking",
              requirement: "可选",
              custom: true,
              description:
                "minimal、none、low、medium、high、xhigh。仅针对 Codex/Responses 后端；Web 或普通 Images API 后端可能忽略。",
            },
          ],
          responses: [
            {
              name: "created",
              description: "Unix 秒时间戳。",
            },
            {
              name: "data[].b64_json / data[].url",
              description: "按 response_format 返回 base64 或 URL。",
            },
            {
              name: "data[].revised_prompt",
              description: "上游返回的改写提示词，若有则返回。",
            },
            {
              name: "SSE image_generation.partial_image",
              description: "流式局部图片事件，包含 partial_image_index 和 b64_json/url。",
            },
            {
              name: "SSE image_generation.completed",
              description:
                "流式完成事件；本站额外带 generation_id、generationId、credits_consumed、model、size。",
              custom: true,
            },
          ],
          notes: [
            "该接口不会调用页面 /api/images/generate，而是直接进入共享 service 层。",
            "如果命中 Responses 账号池，内部会把图片请求转换成 Responses image_generation tool 请求。",
            "如果实际生成尺寸与请求尺寸不一致，本站会按检测到的实际尺寸修正记录和计费。",
            "官方 Images API 可能返回 usage；本站当前非流式 JSON 响应暂不返回 usage，流式完成和错误事件会带 credits_consumed。",
          ],
        },
        {
          title: "Create image edit",
          method: "POST",
          path: "/v1/images/edits",
          contentType: "multipart/form-data 或 application/json",
          description:
            "兼容 OpenAI Images edit。multipart 可上传图片；JSON 可使用公网图片 URL。",
          example: `curl https://gpt2image.superapi.buzz/v1/images/edits \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -F model="gpt-image-2" \\
  -F prompt="把参考图改成电影海报风格" \\
  -F size="1024x1024" \\
  -F response_format="url" \\
  -F image[]="@/path/to/reference.png"`,
          responseExample: `{
  "created": 1713833628,
  "data": [
    {
      "url": "https://gpt2image.superapi.buzz/api/storage/generations/...",
      "revised_prompt": "..."
    }
  ]
}`,
          fields: [
            {
              name: "prompt",
              requirement: "必填",
              description: "编辑提示词，最多 4000 字符。",
            },
            {
              name: "image / image[] / image_*",
              requirement: "multipart 必填",
              description: "参考图文件，最多 16 张。",
            },
            {
              name: "images",
              requirement: "JSON 可选",
              description:
                "图片引用数组。本站支持字符串 URL 或 { image_url/url }；file_id 当前不支持。",
            },
            {
              name: "mask",
              requirement: "可选",
              description:
                "PNG mask 文件；JSON 中可传 URL 形式的 mask 引用。",
            },
            {
              name: "model",
              requirement: "可选",
              description: "图片模型，需为 gpt-image-* 类图片模型。",
            },
            {
              name: "n",
              requirement: "可选",
              description: "生成数量，1 到 10。",
            },
            {
              name: "size",
              requirement: "可选",
              description: "目标尺寸。",
            },
            {
              name: "quality",
              requirement: "可选",
              description: "auto、low、medium、high。",
            },
            {
              name: "moderation",
              requirement: "可选",
              description: "auto 或 low。",
            },
            {
              name: "response_format",
              requirement: "可选",
              description: "url 或 b64_json。默认 b64_json。",
            },
            {
              name: "stream",
              requirement: "可选",
              description: "true 时返回 text/event-stream。",
            },
            {
              name: "image_url / image_urls",
              requirement: "JSON 或表单可选",
              custom: true,
              description:
                "兼容快捷字段。推荐使用 images；若同时传入，本站会合并到同一参考图列表并按 URL 去重。",
            },
            {
              name: "mask_url / mask_image_url",
              requirement: "JSON 或表单可选",
              custom: true,
              description: "本站便捷写法：直接传 mask 图片 URL。",
            },
            {
              name: "promptOptimization / prompt_optimization",
              requirement: "可选",
              custom: true,
              description:
                "控制平台是否继续优化 prompt。若 prompt 已是优化后的最终提示词，建议传 false。",
            },
            {
              name: "gptModel / gpt_model",
              requirement: "可选",
              custom: true,
              description: "同文生图接口。",
            },
            {
              name: "thinking",
              requirement: "可选",
              custom: true,
              description:
                "minimal、none、low、medium、high、xhigh。仅针对 Codex/Responses 后端；Web 或普通 Images API 后端可能忽略。",
            },
          ],
          responses: [
            {
              name: "created / data[]",
              description: "与 /v1/images/generations 相同。",
            },
            {
              name: "SSE image_edit.partial_image",
              description: "流式局部编辑图片事件。",
            },
            {
              name: "SSE image_edit.completed",
              description:
                "流式完成事件；本站额外带 generation_id、generationId、credits_consumed、model、size。",
              custom: true,
            },
          ],
          notes: [
            "URL 图片会先由本站服务端下载并校验公网可访问性、类型和大小。",
            "不支持私网、localhost、metadata/internal 域名或带用户名密码的 URL。",
            "官方 JSON file_id 图片引用当前未实现，请使用公网 image_url 或 multipart 上传。",
          ],
        },
        {
          title: "Create response",
          method: "POST",
          path: "/v1/responses",
          contentType: "application/json",
          description:
            "基于 OpenAI Responses API 的生图适配入口。它会按 responses 调度类型选择 Codex/Responses 账号池或外接 /responses API 后端。",
          example: `curl https://gpt2image.superapi.buzz/v1/responses \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-5.4",
    "input": "生成一张 1:1 的未来感产品渲染图",
    "tools": [{ "type": "image_generation", "size": "1024x1024" }]
  }'`,
          responseExample: `{
  "id": "resp_...",
  "object": "response",
  "created_at": 1713833628,
  "status": "completed",
  "model": "gpt-5.4",
  "output": [
    {
      "id": "ig_...",
      "type": "image_generation_call",
      "status": "completed",
      "result": "..."
    }
  ],
  "usage": null,
  "metadata": {
    "generation_id": "...",
    "credits_consumed": 1.31,
    "size": "1024x1024"
  }
}`,
          fields: [
            {
              name: "model",
              requirement: "可选",
              description:
                "Responses 顶层模型。可用模型以 /v1/models 返回和套餐权限为准。",
            },
            {
              name: "input",
              requirement: "必填",
              description:
                "字符串，或消息数组。消息 content 支持字符串、input_text/output_text，以及 input_image.image_url。",
            },
            {
              name: "previous_response_id",
              requirement: "可选",
              description:
                "续接上一轮 response。本站会读取内部保存的 webConversation/fallbackHistory 延续上下文。",
            },
            {
              name: "tools",
              requirement: "可选",
              description:
                "若显式传入，必须包含 { type: \"image_generation\" }；未传时本站会自动补 image_generation。",
            },
            {
              name: "tool_choice",
              requirement: "可选",
              description:
                "兼容接收字段。本站调度只要求 tools 包含 image_generation；是否按 tool_choice 执行取决于命中的 Responses 上游。",
            },
            {
              name: "stream",
              requirement: "可选",
              description: "true 时返回 Responses 风格 SSE 事件。",
            },
            {
              name: "store",
              requirement: "可选",
              description:
                "兼容接收字段；本站内部会自行保存必要续聊状态，不保证按官方 store 语义透传。",
            },
            {
              name: "reasoning.effort",
              requirement: "可选",
              description: "low、medium、high 等思考强度。",
            },
            {
              name: "size",
              requirement: "可选",
              custom: true,
              description:
                "本站便捷字段：未在 image_generation tool 内指定尺寸时，作为本次生图 size 使用。",
            },
            {
              name: "quality",
              requirement: "可选",
              custom: true,
              description:
                "本站便捷字段：作为本次生图 quality 运行参数使用。",
            },
            {
              name: "moderation",
              requirement: "可选",
              custom: true,
              description:
                "本站便捷字段：作为本次生图 moderation 运行参数使用。",
            },
            {
              name: "tools[].model",
              requirement: "可选",
              custom: true,
              description:
                "当 image_generation tool 中提供 model 时，本站将其作为图片模型。",
            },
            {
              name: "reasoning.effort",
              requirement: "可选",
              description:
                "支持 minimal、none、low、medium、high、xhigh；最终是否生效取决于命中的后端。",
            },
          ],
          responses: [
            {
              name: "id / object / created_at / status / model / output",
              description: "兼容 Responses response 对象的基本结构。",
            },
            {
              name: "output[].type = image_generation_call",
              description: "图片结果放在 result 字段，值为 b64_json。",
            },
            {
              name: "output[].type = message",
              description: "若上游返回文本，会以 output_text 返回。",
            },
            {
              name: "metadata.generation_id / credits_consumed / size",
              description: "本站生成记录、扣费和尺寸信息。",
              custom: true,
            },
            {
              name: "SSE response.output_item.done / response.completed",
              description: "流式输出项完成和整体完成事件。",
            },
            {
              name: "SSE response.output_text.delta / response.reasoning_summary_text.delta",
              description: "文本和思考摘要增量事件。",
            },
          ],
          notes: [
            "该接口需要专业版或更高套餐。",
            "该接口不是通用 Chat Completions；/v1/chat/completions 当前仍不支持。",
            "input_image 只支持 image_url/data URL；file_id/file 输入当前不会作为参考图使用。",
            "显式传 tools 但不包含 image_generation 会返回错误，避免模型只产出文本而不生图。",
          ],
        },
      ],
    },
    web: {
      title: "Web 账号",
      description:
        "Web 后端走 ChatGPT 网页接口，可用于页面文生图、图生图和对话生图，主要可控的是主 GPT 对话模型和思考强度。",
      valid: [
        "GPT 模型会作为 Web 主对话模型传入。",
        "Web 生图没有稳定的独立图片模型字段；本站不会把图片模型映射成 Web 生图模型。",
        "思考强度会作为 paragen_thinking_level 传入。",
        "关闭提示词优化时，会发送原始提示词，并把 Web 思考强度压到 instant。",
      ],
      invalid: [
        "Web 账号不提供原生 Responses API 能力。",
        "上游 Web 不一定接受所有 Responses 模型名；不可用时由后端调度和错误标记处理。",
        "外部 /v1/responses 按 responses 类型调度，不会选择 Web 账号。",
        "关闭提示词优化不能保证上游完全不理解或改写提示词，只能尽量减少平台侧改动。",
      ],
    },
    codex: {
      title: "Codex / Responses 账号",
      description:
        "Codex 后端走 Responses 语义，既能接 Responses 请求，也能把 image 请求转换成 Responses 请求。",
      valid: [
        "GPT 模型作为 Responses 顶层 model。",
        "图片模型作为 image_generation 工具的 model。",
        "image generation 和 edit 请求都会按当前图片、尺寸、质量、审核强度组装。",
        "当账号返回限流、额度不足、无效凭据时，调度器会尝试轮换并标记异常账号。",
      ],
      invalid: [
        "Codex 账号不是 ChatGPT Web 账号，不能使用 Web 专属字段。",
        "如果分组没有可用账号，应被视为不可调度；成功请求通常说明命中了其他可用后端或外接 API。",
      ],
    },
    api: {
      title: "外接 API 后端",
      description:
        "外接 API 用于兼容 OpenAI 风格接口，平台尽量透传用户请求。",
      valid: [
        "image generation / edit 使用图片模型字段。",
        "Responses 请求按 Responses API 请求体透传。",
        "API Key、Base URL、模型支持情况由外接服务决定。",
      ],
      invalid: [
        "普通 image API 不一定识别平台的 GPT 模型或 Web 思考强度字段。",
        "外接服务如果自行优化提示词，平台侧关闭提示词优化无法覆盖它。",
      ],
    },
    prompt: {
      title: "提示词优化与思考强度",
      rows: [
        ["开启提示词优化", "平台可使用优化后的提示词，Web 思考强度按选择值传入。"],
        ["关闭提示词优化", "平台发送原始提示词，Web 强制使用 instant，尽量减少改写。"],
        ["Codex/Responses", "按请求字段传入，具体是否改写由上游模型和工具决定。"],
        ["外接 API", "平台尽量透传，最终行为取决于外接服务。"],
      ],
    },
  },
  en: {
    title: "System Docs",
    subtitle:
      "The six endpoints are protocol adapters. They do not call each other over HTTP; they enter the same generation, billing, scheduling, and storage path.",
    flow: {
      title: "Request Routing Diagram",
      note:
        "User custom API keeps the highest priority for now; when unavailable, the request enters the platform backend pool. External endpoints do not call internal /api/images/* routes.",
      entryTitle: "Entry",
      resolverTitle: "Unified Handler",
      groupTitle: "Group Selection",
      backendTitle: "Backend Target",
      entries: [
        {
          label: "Page text-to-image",
          path: "POST /api/images/generate",
          kind: "image_generation",
        },
        {
          label: "Page image edit",
          path: "POST /api/images/edit",
          kind: "image_edit",
        },
        {
          label: "Page image chat",
          path: "POST /api/images/chat",
          kind: "chat",
        },
        {
          label: "External image API",
          path: "POST /v1/images/generations",
          kind: "image_generation",
        },
        {
          label: "External edit API",
          path: "POST /v1/images/edits",
          kind: "image_edit",
        },
        {
          label: "External Responses API",
          path: "POST /v1/responses",
          kind: "responses",
        },
      ],
      resolver: [
        "Validate session or external API key",
        "Convert page forms or OpenAI-compatible requests into unified run parameters",
        "Calculate credits and moderation cost",
        "Call runImageGenerationForUser for the shared generation path",
      ],
      groups: [
        "External API key bound group first",
        "Then the user's selected image backend group",
        "Then the enabled default group",
        "Group checks plan access, enabled state, and content safety setting",
      ],
      backends: [
        {
          title: "User Custom API",
          description:
            "If the user configured an OpenAI-compatible API, it is used first; this is kept as transition behavior.",
        },
        {
          title: "Web Account Pool",
          description:
            "Uses the ChatGPT Web path for page generation, edit, and image chat.",
        },
        {
          title: "Codex/Responses Pool",
          description:
            "Uses Responses semantics for responses and can convert image generation/edit into responses requests.",
        },
        {
          title: "External API Backend",
          description:
            "Admin-configured OpenAI-compatible Base URL/API Key; calls images or responses endpoints by request type.",
        },
      ],
    },
    routeTables: {
      title: "Entry To Backend Mapping",
      pageTitle: "Page Requests",
      apiTitle: "External API Requests",
      headers: ["Entry", "Internal Endpoint", "Request Kind", "Backend Behavior"],
      apiHeaders: ["Entry", "Compatible Endpoint", "Request Kind", "Backend Behavior"],
      pageRows: [
        [
          "Create page generation",
          "/api/images/generate",
          "image_generation",
          "Can route to user custom API, Web account, Codex/Responses account, or external API backend.",
        ],
        [
          "Create page edit",
          "/api/images/edit",
          "image_edit",
          "Reference images enter the internal endpoint first, then route through the selected backend group.",
        ],
        [
          "Create page image chat",
          "/api/images/chat",
          "chat",
          "Uses chat routing; can select Web accounts, Codex/Responses accounts, or external API backends that support /responses.",
        ],
      ],
      apiRows: [
        [
          "OpenAI images generation",
          "/v1/images/generations",
          "image_generation",
          "Validates API key and plan, then enters the same generation path; b64_json is the default response format, url can be requested explicitly.",
        ],
        [
          "OpenAI images edit",
          "/v1/images/edits",
          "image_edit",
          "Multipart images are converted into unified image inputs before backend routing.",
        ],
        [
          "OpenAI Responses",
          "/v1/responses",
          "responses",
          "Adds the image_generation tool when tools are omitted; explicit tools must include image_generation. Responses routing selects Codex/Responses groups or external /responses API backends.",
        ],
        [
          "OpenAI models",
          "/v1/models",
          "-",
          "Only lists models visible to the current plan/API key and does not trigger backend pool routing.",
        ],
      ],
    },
    relationship: {
      title: "How The Six Endpoints Relate",
      rows: [
        [
          "Three page endpoints",
          "/api/images/generate, /api/images/edit, /api/images/chat",
          "Browser-session entrypoints that adapt page forms, reference images, and internal stream events.",
        ],
        [
          "Three external endpoints",
          "/v1/images/generations, /v1/images/edits, /v1/responses",
          "/api/v1/* is an alias to the same handlers; these adapt API keys and OpenAI-compatible request/response formats.",
        ],
        [
          "Shared core",
          "runImageGenerationForUser",
          "Credits, moderation, queueing, backend pool selection, error marking, cooldowns, refunds, and storage live here.",
        ],
        [
          "Backend execution",
          "generateImage / editImage / generateChatImage",
          "The selected member is converted to a ChatGPT Web, Codex/Responses, or external API request.",
        ],
      ],
      note:
        "The relationship is not external API -> page API. It is six adapters -> one shared service layer.",
    },
    externalDocs: {
      title: "External API Reference",
      subtitle:
        "This documents the currently supported OpenAI-compatible surface. Bold fields are GPT2IMAGE extensions or compatibility additions, not standard OpenAI fields.",
      commonTitle: "Common Rules",
      baseUrlTitle: "Base URL",
      baseUrl: "https://gpt2image.superapi.buzz",
      examplesTitle: "Request Example",
      responseExampleTitle: "Response Example",
      common: [
        "All external endpoints require Authorization: Bearer <GPT2IMAGE API key>.",
        "Image generation and image edits require Starter or higher; Responses requires Pro or higher.",
        "/api/v1/* and /v1/* use the same handlers; they are path aliases.",
        "Error responses use an OpenAI-style error object. GPT2IMAGE may also return generation_id, generationId, and credits_consumed for debugging and reconciliation.",
        "A backend group bound to the external API key wins first. Otherwise the user's default group is used, then the enabled platform default group.",
      ],
      officialRefsTitle: "Official References",
      officialRefs: [
        {
          label: "Images API",
          href: "https://developers.openai.com/api/reference/resources/images",
        },
        {
          label: "Responses API",
          href: "https://developers.openai.com/api/reference/resources/responses/methods/create",
        },
        {
          label: "Models API",
          href: "https://developers.openai.com/api/reference/resources/models/methods/list",
        },
      ],
      fieldHeaders: ["Field", "Requirement", "Notes"],
      responseHeaders: ["Response field", "Notes"],
      requestTitle: "Request Fields",
      responseTitle: "Response And Streaming",
      notesTitle: "Implementation Notes",
      customLabel: "Extension",
      docs: [
        {
          title: "List models",
          method: "GET",
          path: "/v1/models",
          contentType: "No request body",
          description:
            "Compatible with OpenAI List models. Lists image models and Responses models visible to the current API key's user.",
          example: `curl https://gpt2image.superapi.buzz/v1/models \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY"`,
          responseExample: `{
  "object": "list",
  "data": [
    {
      "id": "gpt-image-2",
      "object": "model",
      "created": 0,
      "owned_by": "gpt2image"
    }
  ]
}`,
          fields: [
            {
              name: "Authorization",
              requirement: "Required header",
              description: "Bearer <GPT2IMAGE API key>.",
            },
          ],
          responses: [
            {
              name: "object",
              description: "Always list.",
            },
            {
              name: "data[].id",
              description:
                "Model ID. Includes exposed image models and Responses models available to the current plan.",
            },
            {
              name: "data[].object / created / owned_by",
              description: "Compatible with the OpenAI model object shape.",
            },
          ],
          notes: [
            "Only model listing is implemented; /v1/models/{model} is not implemented.",
            "Returned models are filtered by plan. Ultra users can see additional Responses models.",
          ],
        },
        {
          title: "Create image",
          method: "POST",
          path: "/v1/images/generations",
          contentType: "application/json",
          description:
            "Compatible with OpenAI Images generation. Requests become image_generation jobs in the shared generation path.",
          example: `curl https://gpt2image.superapi.buzz/v1/images/generations \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-image-1.5",
    "prompt": "A cyberpunk city at night after rain, neon reflections",
    "size": "1024x1024",
    "quality": "medium",
    "response_format": "url"
  }'`,
          responseExample: `{
  "created": 1713833628,
  "data": [
    {
      "url": "https://gpt2image.superapi.buzz/api/storage/generations/..."
    }
  ]
}`,
          fields: [
            {
              name: "prompt",
              requirement: "Required",
              description: "Image prompt, up to 4000 characters.",
            },
            {
              name: "model",
              requirement: "Optional",
              description:
                "Image model. GPT2IMAGE accepts gpt-image-* style image models here. Use /v1/responses for Responses chat models.",
            },
            {
              name: "n",
              requirement: "Optional",
              description: "Number of images, 1 to 10.",
            },
            {
              name: "size",
              requirement: "Optional",
              description:
                "Target size. GPT2IMAGE validates the size and rejects invalid values.",
            },
            {
              name: "quality",
              requirement: "Optional",
              description: "auto, low, medium, or high.",
            },
            {
              name: "moderation",
              requirement: "Optional",
              description: "auto or low.",
            },
            {
              name: "response_format",
              requirement: "Optional",
              description:
                "url or b64_json. Defaults to b64_json. url returns a GPT2IMAGE storage URL.",
            },
            {
              name: "stream",
              requirement: "Optional",
              description: "true returns text/event-stream.",
            },
            {
              name: "promptOptimization / prompt_optimization",
              requirement: "Optional",
              custom: true,
              description:
                "Controls whether GPT2IMAGE may further optimize prompt. If prompt is already the final optimized prompt, pass false.",
            },
            {
              name: "gptModel / gpt_model",
              requirement: "Optional",
              custom: true,
              description:
                "When routed to Codex/Responses accounts, this is the top-level Responses GPT model. Plain Images API backends may ignore it.",
            },
            {
              name: "thinking",
              requirement: "Optional",
              custom: true,
              description:
                "minimal, none, low, medium, high, or xhigh. Only applies to Codex/Responses backends; Web or plain Images API backends may ignore it.",
            },
          ],
          responses: [
            {
              name: "created",
              description: "Unix timestamp in seconds.",
            },
            {
              name: "data[].b64_json / data[].url",
              description: "Base64 or URL according to response_format.",
            },
            {
              name: "data[].revised_prompt",
              description: "Returned when the upstream provides a revised prompt.",
            },
            {
              name: "SSE image_generation.partial_image",
              description:
                "Streaming partial image event with partial_image_index and b64_json/url.",
            },
            {
              name: "SSE image_generation.completed",
              description:
                "Streaming completion event. GPT2IMAGE also includes generation_id, generationId, credits_consumed, model, and size.",
              custom: true,
            },
          ],
          notes: [
            "This endpoint does not call page /api/images/generate; it directly enters the shared service layer.",
            "When routed to a Responses account, the image request is converted into a Responses image_generation tool request.",
            "If the actual generated dimensions differ from the requested size, GPT2IMAGE records and bills using the detected actual size.",
            "The official Images API may return usage. GPT2IMAGE does not currently include usage in non-stream JSON responses; streaming completion and error events include credits_consumed.",
          ],
        },
        {
          title: "Create image edit",
          method: "POST",
          path: "/v1/images/edits",
          contentType: "multipart/form-data or application/json",
          description:
            "Compatible with OpenAI Images edit. multipart uploads files; JSON can reference public image URLs.",
          example: `curl https://gpt2image.superapi.buzz/v1/images/edits \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -F model="gpt-image-2" \\
  -F prompt="Turn the reference image into a cinematic poster" \\
  -F size="1024x1024" \\
  -F response_format="url" \\
  -F image[]="@/path/to/reference.png"`,
          responseExample: `{
  "created": 1713833628,
  "data": [
    {
      "url": "https://gpt2image.superapi.buzz/api/storage/generations/...",
      "revised_prompt": "..."
    }
  ]
}`,
          fields: [
            {
              name: "prompt",
              requirement: "Required",
              description: "Edit prompt, up to 4000 characters.",
            },
            {
              name: "image / image[] / image_*",
              requirement: "Required for multipart",
              description: "Reference image files, up to 16 images.",
            },
            {
              name: "images",
              requirement: "Optional for JSON",
              description:
                "Image reference array. GPT2IMAGE accepts string URLs or { image_url/url }. file_id is not supported.",
            },
            {
              name: "mask",
              requirement: "Optional",
              description:
                "PNG mask file; JSON can provide a mask URL reference.",
            },
            {
              name: "model",
              requirement: "Optional",
              description: "Image model; must be a gpt-image-* style image model.",
            },
            {
              name: "n",
              requirement: "Optional",
              description: "Number of outputs, 1 to 10.",
            },
            {
              name: "size",
              requirement: "Optional",
              description: "Target size.",
            },
            {
              name: "quality",
              requirement: "Optional",
              description: "auto, low, medium, or high.",
            },
            {
              name: "moderation",
              requirement: "Optional",
              description: "auto or low.",
            },
            {
              name: "response_format",
              requirement: "Optional",
              description: "url or b64_json. Defaults to b64_json.",
            },
            {
              name: "stream",
              requirement: "Optional",
              description: "true returns text/event-stream.",
            },
            {
              name: "image_url / image_urls",
              requirement: "Optional JSON or form field",
              custom: true,
              description:
                "Compatibility shortcut fields. Prefer images; when both are provided, GPT2IMAGE merges them into one reference list and deduplicates by URL.",
            },
            {
              name: "mask_url / mask_image_url",
              requirement: "Optional JSON or form field",
              custom: true,
              description: "Convenience fields for a mask image URL.",
            },
            {
              name: "promptOptimization / prompt_optimization",
              requirement: "Optional",
              custom: true,
              description:
                "Controls whether GPT2IMAGE may further optimize prompt. If prompt is already the final optimized prompt, pass false.",
            },
            {
              name: "gptModel / gpt_model",
              requirement: "Optional",
              custom: true,
              description: "Same as Create image.",
            },
            {
              name: "thinking",
              requirement: "Optional",
              custom: true,
              description:
                "minimal, none, low, medium, high, or xhigh. Only applies to Codex/Responses backends; Web or plain Images API backends may ignore it.",
            },
          ],
          responses: [
            {
              name: "created / data[]",
              description: "Same as /v1/images/generations.",
            },
            {
              name: "SSE image_edit.partial_image",
              description: "Streaming partial edited image event.",
            },
            {
              name: "SSE image_edit.completed",
              description:
                "Streaming completion event. GPT2IMAGE also includes generation_id, generationId, credits_consumed, model, and size.",
              custom: true,
            },
          ],
          notes: [
            "URL images are downloaded server-side and checked for public reachability, type, and size.",
            "Private networks, localhost, metadata/internal hosts, and URLs with credentials are rejected.",
            "Official JSON file_id image references are not implemented. Use public image_url or multipart uploads.",
          ],
        },
        {
          title: "Create response",
          method: "POST",
          path: "/v1/responses",
          contentType: "application/json",
          description:
            "A GPT2IMAGE image-generation adapter based on the OpenAI Responses API. It routes as responses and selects Codex/Responses groups or external /responses API backends.",
          example: `curl https://gpt2image.superapi.buzz/v1/responses \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-5.4",
    "input": "Generate a 1:1 futuristic product render",
    "tools": [{ "type": "image_generation", "size": "1024x1024" }]
  }'`,
          responseExample: `{
  "id": "resp_...",
  "object": "response",
  "created_at": 1713833628,
  "status": "completed",
  "model": "gpt-5.4",
  "output": [
    {
      "id": "ig_...",
      "type": "image_generation_call",
      "status": "completed",
      "result": "..."
    }
  ],
  "usage": null,
  "metadata": {
    "generation_id": "...",
    "credits_consumed": 1.31,
    "size": "1024x1024"
  }
}`,
          fields: [
            {
              name: "model",
              requirement: "Optional",
              description:
                "Top-level Responses model. Availability is determined by /v1/models and the current plan.",
            },
            {
              name: "input",
              requirement: "Required",
              description:
                "A string or message array. Message content supports strings, input_text/output_text, and input_image.image_url.",
            },
            {
              name: "previous_response_id",
              requirement: "Optional",
              description:
                "Continues a previous response. GPT2IMAGE loads stored webConversation/fallbackHistory continuation state.",
            },
            {
              name: "tools",
              requirement: "Optional",
              description:
                "If provided, must include { type: \"image_generation\" }. If omitted, GPT2IMAGE adds image_generation automatically.",
            },
            {
              name: "tool_choice",
              requirement: "Optional",
              description:
                "Accepted for compatibility. GPT2IMAGE scheduling only requires tools to include image_generation; actual tool_choice behavior depends on the selected Responses upstream.",
            },
            {
              name: "stream",
              requirement: "Optional",
              description: "true returns Responses-style SSE events.",
            },
            {
              name: "store",
              requirement: "Optional",
              description:
                "Accepted for compatibility. GPT2IMAGE stores continuation state internally and does not guarantee official store semantics.",
            },
            {
              name: "reasoning.effort",
              requirement: "Optional",
              description: "low, medium, high, etc.",
            },
            {
              name: "size",
              requirement: "Optional",
              custom: true,
              description:
                "Convenience field used as the run-time image size when the image_generation tool does not provide one.",
            },
            {
              name: "quality",
              requirement: "Optional",
              custom: true,
              description:
                "Convenience field used as the run-time image quality.",
            },
            {
              name: "moderation",
              requirement: "Optional",
              custom: true,
              description:
                "Convenience field used as the run-time image moderation setting.",
            },
            {
              name: "tools[].model",
              requirement: "Optional",
              custom: true,
              description:
                "When provided on the image_generation tool, GPT2IMAGE treats it as the image model.",
            },
            {
              name: "reasoning.effort",
              requirement: "Optional",
              description:
                "Supports minimal, none, low, medium, high, and xhigh. Actual support depends on the selected backend.",
            },
          ],
          responses: [
            {
              name: "id / object / created_at / status / model / output",
              description: "Compatible with the basic Responses response object.",
            },
            {
              name: "output[].type = image_generation_call",
              description: "Image result is returned in result as b64_json.",
            },
            {
              name: "output[].type = message",
              description: "Upstream text, when present, is returned as output_text.",
            },
            {
              name: "metadata.generation_id / credits_consumed / size",
              description: "GPT2IMAGE generation record, billing, and size metadata.",
              custom: true,
            },
            {
              name: "SSE response.output_item.done / response.completed",
              description: "Streaming output item and completion events.",
            },
            {
              name: "SSE response.output_text.delta / response.reasoning_summary_text.delta",
              description: "Text and reasoning summary delta events.",
            },
          ],
          notes: [
            "This endpoint requires Pro plan or higher.",
            "This is not Chat Completions. /v1/chat/completions is still unsupported.",
            "input_image supports image_url/data URLs. file_id/file inputs are not used as references today.",
            "If tools is provided without image_generation, GPT2IMAGE returns an error to avoid text-only responses.",
          ],
        },
      ],
    },
    web: {
      title: "Web Accounts",
      description:
        "Web backends use the ChatGPT web interface for page generation, edit, and image chat. The controllable fields are mainly the main GPT conversation model and thinking level.",
      valid: [
        "GPT model is sent as the main Web conversation model.",
        "Web image generation has no stable separate image model field; this service does not map image models into Web image model slugs.",
        "Thinking is sent as paragen_thinking_level.",
        "When prompt optimization is off, the original prompt is sent and Web thinking is forced to instant.",
      ],
      invalid: [
        "Web accounts do not provide native Responses API capability.",
        "The upstream Web endpoint may not accept every Responses model name; backend routing and error marking handle unavailable accounts.",
        "External /v1/responses uses responses routing and does not select Web accounts.",
        "Disabling prompt optimization cannot guarantee the upstream never interprets or revises the prompt.",
      ],
    },
    codex: {
      title: "Codex / Responses Accounts",
      description:
        "Codex backends use Responses semantics and can receive Responses requests or converted image requests.",
      valid: [
        "GPT model is the top-level Responses model.",
        "Image model is the image_generation tool model.",
        "Generation and edit requests include current images, size, quality, and moderation strength.",
        "On limits, invalid credentials, or quota errors, the scheduler retries other accounts and marks bad ones.",
      ],
      invalid: [
        "Codex accounts are not ChatGPT Web accounts and cannot use Web-only fields.",
        "If a group has no usable accounts it should not be schedulable; a successful request usually means another backend or external API was used.",
      ],
    },
    api: {
      title: "External API Backends",
      description:
        "External APIs are OpenAI-compatible targets; the platform passes requests through as much as possible.",
      valid: [
        "Image generation / edit uses the image model field.",
        "Responses requests follow the Responses API body.",
        "API Key, Base URL, and model support depend on the external service.",
      ],
      invalid: [
        "Plain image APIs may ignore GPT model or Web thinking fields.",
        "If the external service optimizes prompts internally, this platform cannot override it.",
      ],
    },
    prompt: {
      title: "Prompt Optimization And Thinking",
      rows: [
        ["Prompt optimization on", "Optimized prompt may be used; Web thinking follows the selected value."],
        ["Prompt optimization off", "Original prompt is sent; Web is forced to instant to minimize changes."],
        ["Codex/Responses", "Fields are passed when supported; final behavior depends on upstream model/tool behavior."],
        ["External API", "The platform passes through where possible; the external service decides final behavior."],
      ],
    },
  },
} as const;

type TableRow = readonly [string, string, string, string];
type RelationshipRow = readonly [string, string, string];
type ExternalApiField = {
  name: string;
  requirement?: string;
  description: string;
  custom?: boolean;
};
type ExternalApiResponseField = {
  name: string;
  description: string;
  custom?: boolean;
};
type ExternalApiDoc = {
  title: string;
  method: string;
  path: string;
  contentType: string;
  description: string;
  example: string;
  responseExample: string;
  fields: readonly ExternalApiField[];
  responses: readonly ExternalApiResponseField[];
  notes: readonly string[];
};

function ListBlock({
  items,
  type,
}: {
  items: readonly string[];
  type: "valid" | "invalid";
}) {
  const Icon = type === "valid" ? Check : X;
  const color = type === "valid" ? "text-emerald-600" : "text-amber-600";
  return (
    <ul className="space-y-2 text-sm text-muted-foreground">
      {items.map((item) => (
        <li className="flex gap-2" key={item}>
          <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function RouteDiagram({
  flow,
}: {
  flow: (typeof sections.zh.flow) | (typeof sections.en.flow);
}) {
  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle className="text-base">{flow.title}</CardTitle>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {flow.note}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-[1.2fr_auto_1fr_auto_1fr_auto_1.15fr] lg:items-stretch">
          <RouteColumn title={flow.entryTitle}>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
              {flow.entries.map((entry) => (
                <div className="rounded-md border bg-background p-3" key={entry.path}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{entry.label}</span>
                    <Badge variant="secondary" className="rounded-sm font-mono text-[10px]">
                      {entry.kind}
                    </Badge>
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                    {entry.path}
                  </div>
                </div>
              ))}
            </div>
          </RouteColumn>

          <RouteArrow />

          <RouteColumn title={flow.resolverTitle}>
            <NumberedItems items={flow.resolver} />
          </RouteColumn>

          <RouteArrow />

          <RouteColumn title={flow.groupTitle}>
            <NumberedItems items={flow.groups} />
          </RouteColumn>

          <RouteArrow />

          <RouteColumn title={flow.backendTitle}>
            <div className="space-y-2">
              {flow.backends.map((backend) => (
                <div className="rounded-md border bg-background p-3" key={backend.title}>
                  <div className="text-sm font-medium">{backend.title}</div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {backend.description}
                  </p>
                </div>
              ))}
            </div>
          </RouteColumn>
        </div>
      </CardContent>
    </Card>
  );
}

function RouteColumn({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

function RouteArrow() {
  return (
    <div className="flex items-center justify-center text-muted-foreground">
      <ArrowDown className="h-5 w-5 lg:hidden" />
      <ArrowRight className="hidden h-5 w-5 lg:block" />
    </div>
  );
}

function NumberedItems({ items }: { items: readonly string[] }) {
  return (
    <ol className="space-y-2 text-sm text-muted-foreground">
      {items.map((item, index) => (
        <li className="flex gap-2" key={item}>
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-background text-[11px] font-medium text-foreground">
            {index + 1}
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  );
}

function RouteTable({
  title,
  headers,
  rows,
}: {
  title: string;
  headers: readonly string[];
  rows: readonly TableRow[];
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="overflow-hidden rounded-md border">
        <div className="hidden grid-cols-[1fr_1.15fr_0.8fr_1.8fr] border-b bg-muted/40 text-xs font-medium text-muted-foreground md:grid">
          {headers.map((header) => (
            <div className="px-3 py-2" key={header}>
              {header}
            </div>
          ))}
        </div>
        {rows.map(([entry, endpoint, kind, behavior]) => (
          <div
            className="grid gap-2 border-b p-3 text-sm last:border-b-0 md:grid-cols-[1fr_1.15fr_0.8fr_1.8fr]"
            key={`${entry}-${endpoint}`}
          >
            <div className="font-medium text-foreground">{entry}</div>
            <div className="font-mono text-xs text-muted-foreground">
              {endpoint}
            </div>
            <div>
              <Badge variant="outline" className="rounded-sm font-mono text-[10px]">
                {kind}
              </Badge>
            </div>
            <div className="text-muted-foreground">{behavior}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RelationshipTable({
  relationship,
}: {
  relationship:
    | (typeof sections.zh.relationship)
    | (typeof sections.en.relationship);
}) {
  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle className="text-base">{relationship.title}</CardTitle>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {relationship.note}
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-md border">
          {relationship.rows.map(([name, endpoints, description]: RelationshipRow) => (
            <div
              className="grid gap-2 border-b p-3 text-sm last:border-b-0 md:grid-cols-[160px_1.3fr_1.7fr]"
              key={name}
            >
              <div className="font-medium text-foreground">{name}</div>
              <div className="font-mono text-xs leading-relaxed text-muted-foreground">
                {endpoints}
              </div>
              <div className="text-muted-foreground">{description}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ExternalApiDocs({
  docs,
}: {
  docs: (typeof sections.zh.externalDocs) | (typeof sections.en.externalDocs);
}) {
  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle className="text-base">{docs.title}</CardTitle>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {docs.subtitle}
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-md border p-4">
            <div className="rounded-md bg-muted/50 p-3">
              <div className="text-xs font-medium text-muted-foreground">
                {docs.baseUrlTitle}
              </div>
              <div className="mt-1 font-mono text-sm text-foreground">
                {docs.baseUrl}
              </div>
            </div>
            <h3 className="mt-4 text-sm font-medium">{docs.commonTitle}</h3>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              {docs.common.map((item) => (
                <li className="flex gap-2" key={item}>
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-md border p-4">
            <h3 className="text-sm font-medium">{docs.officialRefsTitle}</h3>
            <div className="mt-3 space-y-2">
              {docs.officialRefs.map((ref) => (
                <a
                  className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
                  href={ref.href}
                  key={ref.href}
                  rel="noreferrer"
                  target="_blank"
                >
                  <span>{ref.label}</span>
                  <ExternalLink className="h-4 w-4 text-muted-foreground" />
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-5">
          {docs.docs.map((doc) => (
            <ExternalEndpointDoc
              customLabel={docs.customLabel}
              doc={doc}
              fieldHeaders={docs.fieldHeaders}
              key={doc.path}
              notesTitle={docs.notesTitle}
              examplesTitle={docs.examplesTitle}
              responseExampleTitle={docs.responseExampleTitle}
              requestTitle={docs.requestTitle}
              responseHeaders={docs.responseHeaders}
              responseTitle={docs.responseTitle}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function CustomMarker({ label }: { label: string }) {
  return (
    <Badge variant="secondary" className="rounded-sm text-[10px]">
      {label}
    </Badge>
  );
}

function FieldName({
  field,
  customLabel,
}: {
  field: ExternalApiField | ExternalApiResponseField;
  customLabel: string;
}) {
  return (
    <div className="space-y-1">
      <div
        className={`font-mono text-xs leading-relaxed ${
          field.custom ? "font-bold text-foreground" : "text-muted-foreground"
        }`}
      >
        {field.name}
      </div>
      {field.custom && <CustomMarker label={customLabel} />}
    </div>
  );
}

function ExternalEndpointDoc({
  doc,
  fieldHeaders,
  responseHeaders,
  requestTitle,
  responseTitle,
  notesTitle,
  examplesTitle,
  responseExampleTitle,
  customLabel,
}: {
  doc: ExternalApiDoc;
  fieldHeaders: readonly string[];
  responseHeaders: readonly string[];
  requestTitle: string;
  responseTitle: string;
  notesTitle: string;
  examplesTitle: string;
  responseExampleTitle: string;
  customLabel: string;
}) {
  return (
    <section className="overflow-hidden rounded-md border">
      <div className="space-y-3 border-b bg-muted/20 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="rounded-sm font-mono">
            {doc.method}
          </Badge>
          <span className="font-mono text-sm font-medium">{doc.path}</span>
          <Badge variant="secondary" className="rounded-sm font-mono text-[10px]">
            {doc.contentType}
          </Badge>
        </div>
        <div>
          <h3 className="text-base font-medium">{doc.title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {doc.description}
          </p>
        </div>
      </div>

      <div className="space-y-5 p-4">
        <div>
          <h4 className="text-sm font-medium">{examplesTitle}</h4>
          <pre className="mt-2 overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs leading-relaxed">
            <code>{doc.example}</code>
          </pre>
        </div>
        <div>
          <h4 className="text-sm font-medium">{responseExampleTitle}</h4>
          <pre className="mt-2 overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs leading-relaxed">
            <code>{doc.responseExample}</code>
          </pre>
        </div>
        <EndpointFieldTable
          customLabel={customLabel}
          fields={doc.fields}
          headers={fieldHeaders}
          title={requestTitle}
        />
        <EndpointResponseTable
          customLabel={customLabel}
          fields={doc.responses}
          headers={responseHeaders}
          title={responseTitle}
        />
        <div>
          <h4 className="text-sm font-medium">{notesTitle}</h4>
          <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
            {doc.notes.map((note) => (
              <li className="flex gap-2" key={note}>
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
                <span>{note}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function EndpointFieldTable({
  title,
  headers,
  fields,
  customLabel,
}: {
  title: string;
  headers: readonly string[];
  fields: readonly ExternalApiField[];
  customLabel: string;
}) {
  return (
    <div>
      <h4 className="text-sm font-medium">{title}</h4>
      <div className="mt-2 overflow-hidden rounded-md border">
        <div className="hidden grid-cols-[1.1fr_0.75fr_1.8fr] border-b bg-muted/40 text-xs font-medium text-muted-foreground md:grid">
          {headers.map((header) => (
            <div className="px-3 py-2" key={header}>
              {header}
            </div>
          ))}
        </div>
        {fields.map((field) => (
          <div
            className="grid gap-2 border-b p-3 text-sm last:border-b-0 md:grid-cols-[1.1fr_0.75fr_1.8fr]"
            key={field.name}
          >
            <FieldName customLabel={customLabel} field={field} />
            <div className="text-muted-foreground">
              {field.requirement || "-"}
            </div>
            <div className="text-muted-foreground">{field.description}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EndpointResponseTable({
  title,
  headers,
  fields,
  customLabel,
}: {
  title: string;
  headers: readonly string[];
  fields: readonly ExternalApiResponseField[];
  customLabel: string;
}) {
  return (
    <div>
      <h4 className="text-sm font-medium">{title}</h4>
      <div className="mt-2 overflow-hidden rounded-md border">
        <div className="hidden grid-cols-[1.2fr_2fr] border-b bg-muted/40 text-xs font-medium text-muted-foreground md:grid">
          {headers.map((header) => (
            <div className="px-3 py-2" key={header}>
              {header}
            </div>
          ))}
        </div>
        {fields.map((field) => (
          <div
            className="grid gap-2 border-b p-3 text-sm last:border-b-0 md:grid-cols-[1.2fr_2fr]"
            key={field.name}
          >
            <FieldName customLabel={customLabel} field={field} />
            <div className="text-muted-foreground">{field.description}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function BackendHelpPage() {
  const user = await getCurrentUser();
  const locale = await getLocale();
  if (!user) redirect(`/${locale}/sign-in`);

  const content = locale === "zh" ? sections.zh : sections.en;

  return (
    <div className="container mx-auto max-w-5xl space-y-6 px-4 py-6 md:px-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <CircleHelp className="h-5 w-5 text-muted-foreground" />
          <h1 className="font-serif text-2xl font-medium tracking-tight">
            {content.title}
          </h1>
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          {content.subtitle}
        </p>
      </div>

      <RouteDiagram flow={content.flow} />

      <RelationshipTable relationship={content.relationship} />

      <ExternalApiDocs docs={content.externalDocs} />

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="text-base">
            {content.routeTables.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <RouteTable
            title={content.routeTables.pageTitle}
            headers={content.routeTables.headers}
            rows={content.routeTables.pageRows}
          />
          <RouteTable
            title={content.routeTables.apiTitle}
            headers={content.routeTables.apiHeaders}
            rows={content.routeTables.apiRows}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {[content.web, content.codex, content.api].map((section) => (
          <Card className="rounded-lg" key={section.title}>
            <CardHeader>
              <CardTitle className="text-base">{section.title}</CardTitle>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {section.description}
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <ListBlock items={section.valid} type="valid" />
              <ListBlock items={section.invalid} type="invalid" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="text-base">{content.prompt.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-md border">
            {content.prompt.rows.map(([label, description]) => (
              <div
                className="grid gap-2 border-b p-3 text-sm last:border-b-0 md:grid-cols-[180px_1fr]"
                key={label}
              >
                <div className="font-medium text-foreground">{label}</div>
                <div className="text-muted-foreground">{description}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
