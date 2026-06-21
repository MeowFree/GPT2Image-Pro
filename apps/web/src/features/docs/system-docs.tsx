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

const sections = {
  zh: {
    title: "系统文档",
    subtitle:
      "这里按当前代码真实链路说明：页面入口和外接入口都是协议适配层，不互相 HTTP 调用，最终统一进入同一套生成、扣费、调度和存储链路。默认部署启用自用模式：关闭公开注册，首次启动补本地随机密码超管。",
    flow: {
      title: "请求路由图",
      note: "普通 image/chat/responses 请求中，用户自接 API 目前仍保留最高优先级；命中用户自接 API 时不扣本站积分，也不占用本站外接 API Key 额度。Agent 或明确要求 Codex/Responses 的入口会忽略用户自接 API。外接接口不会反向请求站内 /api/images/*。",
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
          label: "页面 Agent 生图",
          path: "POST /api/images/chat",
          kind: "agent",
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
          label: "外部视频 API",
          path: "POST /v1/videos/generations",
          kind: "video",
        },
        {
          label: "外部异步图片任务",
          path: "GET /v1/images/{task_id}",
          kind: "image_generation",
        },
        {
          label: "外部 Responses API",
          path: "POST /v1/responses",
          kind: "responses",
        },
        {
          label: "外部 Agent 生图 API",
          path: "POST /v1/agents/images",
          kind: "agent",
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
        "外部 API Key 未绑定分组时使用平台默认分组",
        "网页端创作才使用用户在设置里选择的生图后端分组",
        "分组会检查套餐权限、是否启用、内容安全开关",
      ],
      backends: [
        {
          title: "用户自接 API",
          description:
            "如果用户设置了自己的 OpenAI 兼容 API，普通 image/chat/responses 请求会先直接使用它；命中时 useCredits=false，不扣本站余额，也不增加本站 API Key 已用额度。",
        },
        {
          title: "Web 账号池",
          description:
            "通过 ChatGPT Web 链路承接页面文生图、图生图和对话生图。",
        },
        {
          title: "Codex/Responses 账号池",
          description:
            "chat / agent / responses 走 Responses 语义（image_generation 工具循环、多轮）。普通图像生成与图生图改走该账号的 /images/generations、/images/edits 直连端点（同一 OAuth 凭据，JSON 体、size 走顶层；图生图的输入图/mask 以 base64 data URL 放在 images[].image_url / mask.image_url），以确定性遵循 size 等尺寸参数；Codex 托管的 image_generation 工具不尊重 size，故纯生成/编辑不再用它（codex images 端点要 JSON,不接受 multipart）。",
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
        [
          "创作页 Agent 生图",
          "/api/images/chat",
          "agent",
          "同一站内接口，但强制走 Codex/Responses 能力；默认提供 image_generation、web_search、continue_generation 等工具，并展示工具任务卡。",
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
          "Adobe Firefly video",
          "/v1/videos/generations",
          "video",
          "本站扩展。固定路由到 Adobe（Firefly）后端的长任务，keep-alive 撑住连接直到出片，返回产物视频 URL。",
        ],
        [
          "Async image task",
          "/v1/images/{task_id}",
          "image_generation",
          "查询 async=true 创建的内存异步任务，任务 30 分钟后自动过期。",
        ],
        [
          "OpenAI chat completions",
          "/v1/chat/completions",
          "chat",
          "验证 externalApi.chat.completions 后进入页面 Chat 的非 Agent 链路；可命中 Web、Codex/Responses 或支持 /responses 的外接 API 后端。",
        ],
        [
          "OpenAI Responses",
          "/v1/responses",
          "responses",
          "无 tools 时平台补 image_generation；显式传 tools 时必须包含 image_generation。用户自接 API 可用时仍优先；否则按 responses 类型调度 Codex/Responses 分组或外接 /responses API。",
        ],
        [
          "GPT2IMAGE Agent image run",
          "/v1/agents/images",
          "agent",
          "本站扩展接口。验证 externalApi.agent 能力后走 Codex/Responses 调度，不会选择 Web 后端；可流式返回 Agent 任务事件和多轮成图。",
        ],
        [
          "OpenAI models",
          "/v1/models",
          "-",
          "只返回当前套餐/API Key 可见模型，不触发后端池调度。",
        ],
        [
          "GPT2IMAGE credits",
          "/v1/credits",
          "-",
          "返回当前 API Key 的限额、已用、剩余以及所属账户余额，不触发后端池调度。",
        ],
      ],
    },
    relationship: {
      title: "外接与页面接口的关系",
      rows: [
        [
          "页面三接口",
          "/api/images/generate、/api/images/edit、/api/images/chat",
          "浏览器登录态入口，只负责页面表单、参考图和站内流式事件适配。",
        ],
        [
          "Agent 模式",
          "/api/images/chat + agentMode=true",
          "页面 Chat 接口内开启 Codex 风格工具循环和自动迭代。",
        ],
        [
          "外接 API 入口",
          "/v1/chat/completions、/v1/images/generations、/v1/images/edits、/v1/videos/generations、/v1/images/{task_id}、/v1/responses、/v1/agents/images",
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
      note: "所以关系不是“外接 API 调页面 API”，而是“各入口共享同一个 service 层”。",
    },
    moderationRepair: {
      title: "审核失败自动修剪重试",
      description:
        "开启后，系统检测到本地审核拦截、上游安全拒绝或安全拒绝导致的无图输出时，会先用 Responses 纯文本请求修剪提示词，再在同一个生成任务内重新审核并重新发起生图。",
      valid: [
        "该能力需要至少一个可用的 Codex/Responses 账号，或一个支持 /responses 的外接 API 后端；纯 Web 分组也会临时借用 Responses 后端完成提示词修剪。",
        "最大重试轮数由 IMAGE_MODERATION_PROMPT_REPAIR_MAX_RETRIES 控制，0 表示关闭；IMAGE_MODERATION_PROMPT_REPAIR_ENABLED 可控制总开关。",
        "修剪重试不会新建第二条生成记录，成功后仍按最终图片和原任务计费；状态监控会按第几次修剪统计尝试、成功和失败。",
        "修剪成功时，页面和外接 API 会通过独立说明提示用户“原提示词因审核被拒，系统已进行更多修改后生成本次结果”；该说明不会写入 revised_prompt。",
        "如果没有可用 Responses 后端，或修剪后仍被审核拦截，系统会保留原审核失败信息并按失败结算规则处理。",
      ],
      invalid: [
        "审核服务本身不可用、上游限流、余额不足、模型权限不足等平台或用户请求错误不会触发提示词修剪。",
        "修剪只改写文本提示词，不会修改用户上传的参考图、蒙版或附件内容。",
      ],
    },
    agent: {
      title: "页面 Agent 模式",
      description:
        "Agent 是 Codex 风格自动执行模式。页面端复用 /api/images/chat 并展示任务卡；外接版使用 /v1/agents/images，以 SSE/JSON 形式返回任务事件和图片结果。",
      valid: [
        "仅在 Codex/Responses 能力可用时启用；Web 分支不会开启 Agent 工具循环。",
        "默认工具包含 image_generation、web_search 和 continue_generation；后端不会强制 tool_choice，避免阻断联网和生图等多工具组合。",
        "每轮会展示 Agent 任务卡：联网、工具兼容性调整、生图、流式预览、继续/停止决策等事件。",
        "支持上传文本/代码类附件作为上下文读取；不会读取用户在提示词中写入的服务器本地路径。",
        "可配置最大轮数；开启强制轮数时会跑满用户选择的轮数，否则模型可通过 continue_generation 决定是否继续。",
        "多轮生成的草稿图会作为迭代版本保存，最后一张作为默认最终图。",
        "计费分为 Agent 每轮基础积分和图片实际输出积分；默认 Agent 每轮 3 积分，最终以套餐能力矩阵配置为准。",
      ],
      invalid: [
        "外部 /v1/responses 不等于 Agent；它只做 OpenAI Responses 兼容协议适配，不会自动开启 Agent 工具循环。",
        "当前没有接入 generate_image_batch 并发批量工具，避免破坏 Responses 粘性会话和线性迭代状态。",
      ],
    },
    externalDocs: {
      title: "外接 API 详细文档",
      subtitle:
        "以下按 OpenAI 官方接口形态整理本站当前支持范围。粗体字段为本站扩展或兼容增强，不属于标准 OpenAI 字段。",
      commonTitle: "通用规则",
      baseUrlTitle: "Base URL",
      baseUrl: "https://your-domain.example",
      examplesTitle: "请求示例",
      responseExampleTitle: "响应示例",
      common: [
        "所有外接接口都需要 Authorization: Bearer <本站 API Key>。",
        "Chat Completions、图片生成和图片编辑接口需要入门版及以上；Responses 接口需要专业版及以上；Agent 生图接口默认需要旗舰版及以上。具体门槛可在套餐能力矩阵中调整 externalApi.*。",
        "/api/v1/* 与 /v1/* 使用同一套 handler，只是路径别名。",
        "response_format 控制返回 URL 或 base64；output_format 才控制图片文件格式，二者不是同一个字段。",
        "错误响应采用 OpenAI 风格 error 对象；本站可能额外返回 generation_id、generationId、credits_consumed 方便排查和对账。",
        "外接 API Key 绑定的后端分组优先；未绑定时使用平台默认分组，再回退默认启用分组。页面创作才使用用户选择的默认分组。",
        "分组计费倍率会参与预扣、结算、退款和用量记录；mixed 父分组命中子分组成员时，父分组倍率与子分组倍率相乘生效。",
        "外接 API Key 可设置独立积分限额；GET /v1/credits 可查询 Key 限额、已用额度和账户余额。",
        "用户已启用“接入其他站 API”时，普通 /v1/chat/completions、/v1/images/generations、/v1/images/edits 和 /v1/responses 仍优先使用用户自接 API；命中时 credits_consumed 为 0，不扣本站余额，也不增加本站 API Key 已用额度。",
        "/v1/agents/images 和需要 Codex/Responses 能力的页面功能会忽略用户自接 API，按平台后端池或外接后端池结算本站积分。",
        "image 接口的 web_first / webFirst / force_web / forceWeb（chat 对应 mix_web_first）是 Web-first 优先路由，不是硬性只走 Web，且默认开启。开启时（不传或显式 true）按 Web-first 像素区间（IMAGE_FORCE_WEB_MIN_PIXELS / IMAGE_FORCE_WEB_MAX_PIXELS，默认 0.66MP-2MP）判定：尺寸落在区间内才优先 Web、失败回退 Codex/Responses，超出区间（如 4K）则走正常调度；auto 或无法解析的尺寸视为可优先 Web。显式传 false 则不优先 Web。该路由只对 mixed 后端分组生效（纯 Web / 纯 Codex-Responses 分组无此概念），不会覆盖用户自接 API；agent 始终走 Codex/Responses，不受此项影响。",
        "Adobe（Firefly）后端：作为特殊成员按 priority 挂入分组同池调度——firefly-* 模型或 force_firefly=true 会把候选收敛到仅 Adobe；普通请求则只有当组内 web/codex/api 限流/耗尽/可切换失败时才兜底到 Adobe（取决于 Adobe 是否在该组及其优先级，priority 越大越靠后）。是否进 Adobe、计费倍率均随 admin「Adobe 后端」tab 配置变化。图像计费 = 尺寸基础积分 × 模型族倍率 × Adobe 后端倍率 × 分组倍率；视频计费见 /v1/videos/generations。路由兜底详见 docs/adobe-firefly-routing.md，兼容转换（站内参数→Adobe 字段、被忽略参数、算例）详见 docs/adobe-firefly-compat.md。",
      ],
      officialRefsTitle: "官方参考",
      officialRefs: [
        {
          label: "Chat Completions API",
          href: "https://developers.openai.com/api/reference/chat/create",
        },
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
          example: `curl https://your-domain.example/v1/models \\
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
          title: "Get credits",
          method: "GET",
          path: "/v1/credits",
          contentType: "无请求体",
          description:
            "查询当前 Bearer API Key 的限额、已用额度、剩余额度，以及所属账户当前积分余额。",
          example: `curl https://your-domain.example/v1/credits \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY"`,
          responseExample: `{
  "object": "credit_balance",
  "account": {
    "balance": 15702.45,
    "total_earned": 20000,
    "total_spent": 4297.55,
    "status": "active"
  },
  "api_key": {
    "credit_limit": 1000,
    "credits_used": 12.7,
    "credits_remaining": 987.3,
    "unlimited": false
  }
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
              name: "account.balance",
              description: "所属用户账户当前可用积分余额。",
            },
            {
              name: "api_key.credit_limit",
              description: "当前 API Key 总限额；null 表示不限额。",
            },
            {
              name: "api_key.credits_used / credits_remaining",
              description:
                "当前 API Key 已用和剩余额度；不限额时 credits_remaining 为 null。",
            },
          ],
          notes: [
            "API Key 限额只限制该 Key 自身；走本站平台计费路径时仍必须有足够账户积分。",
            "命中用户自接 API 时不扣本站账户积分，也不增加 Key 已用额度。",
            "生成失败退款、审核拦截结算和实际尺寸后修正会同步修正 Key 已用额度。",
          ],
        },
        {
          title: "Create chat completion",
          method: "POST",
          path: "/v1/chat/completions",
          contentType: "application/json",
          description:
            "兼容 OpenAI Chat Completions 的生图对话入口。它复用页面 Chat 的非 Agent 模式，不启用 Agent 工具循环。",
          example: `# 1. 普通对话生图；默认返回 URL，content 中会追加 Markdown 图片链接
curl https://your-domain.example/v1/chat/completions \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-5.4",
    "image_model": "gpt-image-2",
    "messages": [
      { "role": "system", "content": "你是专业视觉海报设计师。" },
      { "role": "user", "content": "生成一张科技企业宣传海报，16:9，蓝白配色" }
    ],
    "size": "1536x864",
    "quality": "high",
    "response_format": "url"
  }'

# 2. 多模态输入，image_url 会作为本轮真实参考图输入
curl https://your-domain.example/v1/chat/completions \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-5.4-mini",
    "image_model": "gpt-image-2",
    "messages": [
      {
        "role": "user",
        "content": [
          { "type": "text", "text": "参考这张产品图，生成一张电商主图" },
          { "type": "image_url", "image_url": { "url": "https://example.com/product.png" } }
        ]
      }
    ],
    "size": "1024x1024",
    "response_format": "url"
  }'

# 3. 流式返回；文本走 chat.completion.chunk，自定义 partial_image 事件返回流式预览
curl -N https://your-domain.example/v1/chat/completions \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Accept: text/event-stream" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-5.4",
    "messages": [
      { "role": "user", "content": "生成一张未来城市概念图" }
    ],
    "size": "1024x1024",
    "stream": true
  }'`,
          responseExample: `{
  "id": "chatcmpl_...",
  "object": "chat.completion",
  "created": 1713833628,
  "model": "gpt-5.4",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "已生成图片。\\n\\n![generated image 1](https://your-domain.example/api/storage/generations/...)",
        "images": [
          {
            "url": "https://your-domain.example/api/storage/generations/...",
            "revised_prompt": "...",
            "generation_id": "gen_..."
          }
        ]
      },
      "finish_reason": "stop"
    }
  ],
  "images": [
    {
      "url": "https://your-domain.example/api/storage/generations/...",
      "generation_id": "gen_..."
    }
  ],
  "generation_id": "gen_...",
  "generationId": "gen_...",
  "credits_consumed": 2.31,
  "usage": null
}

# stream=true 时的 SSE 片段
data: {"id":"chatcmpl_...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"正在生成..."},"finish_reason":null}]}

event: chat.completion.partial_image
data: {"type":"chat.completion.partial_image","index":0,"partial_image_index":0,"url":"https://your-domain.example/api/storage/generations/..."}

data: {"id":"chatcmpl_...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"generation_id":"gen_...","credits_consumed":2.31}
`,
          fields: [
            {
              name: "messages",
              requirement: "必填",
              description:
                "OpenAI Chat Completions 消息数组。最后一条 user 文本会作为本轮 prompt，之前的 user/assistant 会作为页面 Chat 历史上下文。",
            },
            {
              name: "messages[].content[].image_url",
              requirement: "可选",
              description:
                "支持公网 http(s) 图片 URL 或 data:image URL；最后一条 user 中的图片会作为本轮真实参考图输入。",
            },
            {
              name: "model",
              requirement: "可选",
              description:
                "GPT 对话模型。Web/Codex/Responses 后端会按各自能力处理；不可用模型会返回错误或由后端调度处理。",
            },
            {
              name: "n",
              requirement: "可选",
              description:
                "返回 choice 数量。每个 choice 会创建一次 Chat 生图任务并独立计费。",
            },
            {
              name: "size / quality / moderation",
              requirement: "可选",
              description: "与图片接口相同，作为本轮 Chat 生图运行参数。",
            },
            {
              name: "stream",
              requirement: "可选",
              description: "true 时返回 text/event-stream。",
            },
            {
              name: "response_format",
              requirement: "可选",
              custom: true,
              description:
                "本站扩展：url 或 b64_json。默认 url，避免 Chat Completions 响应体过大。",
            },
            {
              name: "image_model / imageModel",
              requirement: "可选",
              custom: true,
              description:
                "本站扩展：图片模型，需为 gpt-image-*；命中 Web 后端时不会映射成 Web 独立图片模型。",
            },
            {
              name: "promptOptimization / prompt_optimization",
              requirement: "可选",
              custom: true,
              description: "控制是否使用本站提示词优化。",
            },
            {
              name: "promptRepair / prompt_repair",
              requirement: "可选",
              custom: true,
              description:
                "本站扩展：审核改写重试开关。false 时审核失败直接返回真实错误，不自动改写提示词重试；与 /v1/images/generations 同义。",
            },
            {
              name: "background",
              requirement: "可选",
              description:
                "transparent、opaque、auto。与 /v1/images/generations 同义；chat 模式适用，不含 agent 分层。",
            },
            {
              name: "transparent_matte",
              requirement: "可选",
              custom: true,
              description:
                "默认 false。仅当 background=transparent 且显式设为 true 时生效：命中的后端不支持透明返回 400 时自动改不透明重绘，再在服务端用 ISNet 抠图得到透明 PNG；agent 分层模式下不生效。详见 /v1/images/generations 说明。",
            },
            {
              name: "thinking / reasoning.effort",
              requirement: "可选",
              custom: true,
              description:
                "minimal、none、low、medium、high、xhigh；主要针对 Codex/Responses 后端。",
            },
            {
              name: "mixWebFirst / mix_web_first",
              requirement: "可选",
              custom: true,
              description:
                "本站扩展（仅 mixed 分组生效）：Web-first 默认开启。开启时（不传或显式 true）按 Web-first 像素区间判定——尺寸落在区间内才优先 Web、失败回退 Codex/Responses，超出区间（如 4K）走正常调度；auto 或无法解析的尺寸视为可优先 Web。显式传 false 则不优先 Web。区间由 IMAGE_FORCE_WEB_MIN_PIXELS / IMAGE_FORCE_WEB_MAX_PIXELS 配置，默认 0.66MP-2MP。",
            },
            {
              name: "requiresResponsesBackend / requires_responses_backend",
              requirement: "可选",
              custom: true,
              description:
                "本站扩展：强制本次 Chat 走 Codex/Responses 能力，不走 Web。",
            },
          ],
          responses: [
            {
              name: "choices[].message.content",
              description:
                "兼容 Chat Completions 文本内容；当返回 URL 图片时会追加 Markdown 图片链接。",
            },
            {
              name: "choices[].message.images / images",
              description:
                "本站扩展。结构化图片结果，包含 url 或 b64_json、generation_id、revised_prompt。",
              custom: true,
            },
            {
              name: "generation_id / generationId / credits_consumed",
              description:
                "本站扩展字段。返回生成记录 ID 和本次 Chat 轮次加图片输出后的结算积分。",
              custom: true,
            },
            {
              name: "SSE chat.completion.chunk",
              description: "OpenAI 风格 Chat Completions 流式文本块。",
            },
            {
              name: "SSE chat.completion.partial_image",
              description:
                "本站扩展。仅流式模式返回；表示生图过程中的流式预览图片。",
              custom: true,
            },
          ],
          notes: [
            "上游 API 配置有两个独立开关：Images 上游控制 /v1/images/generations 与 /v1/images/edits 命中后请求上游 /images/* 还是转换到 /responses + image_generation tool；Chat Completions 上游只控制 /v1/chat/completions 命中后请求上游 /chat/completions 还是 /responses。",
            "选择 chat_completions 后，本站 /v1/chat/completions 会请求命中上游的 /chat/completions；这更适合纯聊天兼容，但是否能返回图片取决于上游实现。Agent 和 /v1/responses 不受该配置影响。",
            "OpenAI 官方 Chat Completions 并不定义“生成图片”的标准返回字段；本站为了兼容对话生图，在 Chat Completions 外形上扩展 choices[].message.images、顶层 images，并在 content 中追加 Markdown 图片链接。严格按官方生图协议接入时，建议使用 /v1/images/generations、/v1/images/edits 或 /v1/responses。",
            "该接口走页面 Chat 的非 Agent 模式，不会注入 web_search、continue_generation，也不会展示 Agent 多轮任务卡。",
            "调度类型是 chat，可命中 Web 账号、Codex/Responses 账号或支持 /responses 的外接 API 后端；用户自接 API 可用时仍保持最高优先级。",
            "计费等同页面 Chat：先收 Chat 每轮基础积分，再按最终图片实际尺寸和数量追加图片积分、审核积分和分组倍率。",
          ],
        },
        {
          title: "Create image",
          method: "POST",
          path: "/v1/images/generations",
          contentType: "application/json",
          description:
            "兼容 OpenAI Images generation。请求会转换成 image_generation 调度类型，进入统一生成链路。",
          example: `# 1. 官方 Images 风格，默认返回 b64_json
curl https://your-domain.example/v1/images/generations \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-image-2",
    "prompt": "A cute baby sea otter",
    "n": 1,
    "size": "1024x1024",
    "quality": "medium",
    "moderation": "auto",
    "background": "auto"
  }'

# 2. 返回 URL，并关闭本站提示词优化
curl https://your-domain.example/v1/images/generations \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-image-1.5",
    "prompt": "一张赛博朋克城市夜景，雨后霓虹反光",
    "n": 2,
    "size": "1024x1024",
    "quality": "high",
    "moderation": "low",
    "response_format": "url",
    "output_format": "webp",
    "output_compression": 85,
    "background": "transparent",
    "prompt_optimization": false
  }'

# 3. Codex/Responses 后端专用参数；普通 Images API 后端可能忽略
curl https://your-domain.example/v1/images/generations \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-image-2",
    "prompt": "生成一张 16:9 产品海报",
    "size": "1536x864",
    "response_format": "url",
    "output_format": "jpeg",
    "output_compression": 90,
    "gptModel": "gpt-5.4",
    "thinking": "high",
    "promptOptimization": false
  }'

# 4. mixed 分组按可配置像素区间优先尝试 Web；失败或耗尽后降级 Codex/Responses
curl https://your-domain.example/v1/images/generations \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-image-2",
    "prompt": "一张 1:1 头像海报",
    "size": "1024x1024",
    "response_format": "url",
    "web_first": true
  }'

# 5. 流式返回；也可用 Accept: text/event-stream 触发
curl -N https://your-domain.example/v1/images/generations \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Accept: text/event-stream" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-image-2",
    "prompt": "一张透明玻璃材质的未来感咖啡杯",
    "size": "1024x1024",
    "response_format": "url",
    "stream": true
  }'

# 6. 异步模式；也可在 URL 后追加 ?async=true。callback_url 可选
curl https://your-domain.example/v1/images/generations \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-image-1.5",
    "prompt": "一张透明背景的产品图标",
    "size": "1024x1024",
    "response_format": "url",
    "output_format": "png",
    "background": "transparent",
    "async": true,
    "callback_url": "https://your-server.example/callback"
  }'

# 7. 本站扩展：透明背景 + ISNet 兜底抠图，并关闭审核改写重试
curl https://your-domain.example/v1/images/generations \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-image-2",
    "prompt": "一张透明背景的产品图标",
    "size": "1024x1024",
    "response_format": "url",
    "output_format": "png",
    "background": "transparent",
    "transparent_matte": true,
    "prompt_repair": false
  }'`,
          responseExample: `{
  "created": 1713833628,
  "data": [
    {
      "url": "https://your-domain.example/api/storage/generations/...",
      "revised_prompt": "..."
    }
  ],
  "generation_id": "gen_...",
  "generationId": "gen_...",
  "credits_consumed": 1.31,
  "usage": null
}

# stream=true 时的 SSE 片段
event: image_generation.partial_image
data: {"type":"image_generation.partial_image","index":0,"partial_image_index":0,"url":"https://your-domain.example/api/storage/generations/..."}

event: image_generation.completed
data: {"type":"image_generation.completed","index":0,"generation_id":"...","generationId":"...","model":"gpt-image-2","size":"1024x1024","credits_consumed":1.31,"url":"https://your-domain.example/api/storage/generations/...","data":[{"url":"https://your-domain.example/api/storage/generations/...","revised_prompt":"..."}]}

# async=true 的立即响应
{
  "id": "task_...",
  "object": "image.generation",
  "model": "gpt-image-2",
  "status": "processing",
  "created": 1713833628,
  "created_at": "2026-05-28T00:00:00.000Z",
  "generation_id": "gen_..."
}

# 查询任务
curl https://your-domain.example/v1/images/task_... \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY"

# 完成后的任务响应或回调 payload
{
  "id": "task_...",
  "object": "image",
  "model": "gpt-image-2",
  "status": "completed",
  "created": 1713833628,
  "created_at": "2026-05-28T00:00:00.000Z",
  "completed": 1713833700,
  "completed_at": "2026-05-28T00:01:12.000Z",
  "data": [{"url": "https://your-domain.example/api/storage/generations/..."}],
  "generation_id": "gen_...",
  "generationId": "gen_...",
  "credits_consumed": 1.31,
  "usage": null
}
`,
          fields: [
            {
              name: "prompt",
              requirement: "必填",
              description: "图片提示词，最多 32000 字符。",
            },
            {
              name: "model",
              requirement: "可选",
              description:
                "图片模型。本站接受 gpt-image-* 类图片模型；也接受 Adobe Firefly 模型 id（firefly-<family>-<resolution>-<ratio>，如 firefly-nano-banana-pro-2k-16x9，或只写族名如 firefly-gpt-image-2），命中后路由到 Adobe（Firefly）后端。family ∈ gpt-image-2、gpt-image-1.5、nano-banana、nano-banana2、nano-banana-pro；resolution ∈ 1k、2k、4k；ratio ∈ 1x1、16x9、9x16、4x3、3x4。Responses 对话模型请使用 /v1/responses。",
            },
            {
              name: "force_firefly / forceFirefly",
              requirement: "可选",
              custom: true,
              description:
                "本站扩展：true 时把候选收敛到仅 Adobe（Firefly）后端，使用标准参数（你的 prompt/size/quality/model）。未传 firefly-* 模型时默认族为 gpt-image-2；size 映射到 firefly 宽高比/分辨率（长边≤1024→1k、≤2048→2k、否则 4k），quality 的 low/medium/high→detailLevel 1/3/5、auto→后端 gpt_image_quality；不支持的参数（output_format、background、thinking、moderation 等级、output_compression）静默忽略。完整映射表与算例见 docs/adobe-firefly-compat.md。",
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
              name: "output_format",
              requirement: "可选",
              description:
                "png、jpeg、webp。控制实际输出图片格式；不同上游支持情况可能不同。",
            },
            {
              name: "output_compression",
              requirement: "可选",
              description:
                "0 到 100，仅对 jpeg/webp 有意义；数值越高质量越高。",
            },
            {
              name: "background",
              requirement: "可选",
              description:
                "transparent、opaque、auto。透明背景需要命中的上游模型支持，通常还需要 output_format 为 png 或 webp；不支持的模型会返回类似 “Transparent background is not supported for this model” 的 400 错误。若希望在不支持的后端也拿到透明结果，可同时传 transparent_matte=true（见下一项）。无法确认支持时建议使用 auto 或 opaque。",
            },
            {
              name: "transparent_matte",
              requirement: "可选",
              custom: true,
              description:
                "默认 false。仅当 background=transparent 且显式设为 true 时生效：若命中的后端不支持透明而返回 400，则自动改为不透明重新生成，再在服务端用 ISNet 抠图得到透明 PNG。关闭时透明请求直接透传，后端不支持即返回真实 400 错误。注意只对单张生成/编辑/对话生效，不含 agent 分层模式。",
            },
            {
              name: "stream",
              requirement: "可选",
              description: "true 时返回 text/event-stream。",
            },
            {
              name: "async",
              requirement: "可选",
              description:
                "true 时立即返回 task_...，后台执行生成任务；也可用 URL 参数 ?async=true。不能与 stream 同时使用。",
            },
            {
              name: "callback_url",
              requirement: "可选",
              description:
                "异步任务完成或失败后 POST 完整任务结果到该地址，请求头包含 X-Tokens-Callback: true。仅允许公网 http/https 地址。",
            },
            {
              name: "promptOptimization / prompt_optimization",
              requirement: "可选",
              custom: true,
              description:
                "控制平台是否继续优化 prompt。若 prompt 已是优化后的最终提示词，建议传 false。",
            },
            {
              name: "promptRepair / prompt_repair",
              requirement: "可选",
              custom: true,
              description:
                "审核改写重试开关（issue #24）。默认按平台设置（通常启用）：本地审核拦截或上游安全拒绝导致无图输出时，系统会先用 Responses 改写提示词，再在同一生成任务内重新审核并重试；显式传 false 时关闭该自动改写重试，审核失败直接返回真实错误，不再改写提示词。详见下方“审核失败自动修剪重试”说明。",
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
            {
              name: "web_first / webFirst / force_web / forceWeb",
              requirement: "可选",
              custom: true,
              description:
                "仅 image 接口支持。推荐使用 web_first / webFirst；force_web / forceWeb 保留兼容，但实际语义同样是 Web-first 优先路由，不是硬性只走 Web。用户自接 API 优先时忽略；进入平台账号池、命中的后端分组为 mixed，且请求尺寸总像素在 IMAGE_FORCE_WEB_MIN_PIXELS 到 IMAGE_FORCE_WEB_MAX_PIXELS 之间时，优先调度 Web 账号。Web 不可用、失败或耗尽后会降级 Codex/Responses。默认区间为 0.66MP-2MP；非 mixed 或不在区间内会忽略该字段。",
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
              name: "generation_id / generationId / credits_consumed",
              description:
                "本站扩展字段。非流式成功响应会在顶层返回本次生成记录 ID 和本站结算积分；批量请求会返回 generation_ids / generationIds 以及合计 credits_consumed。命中用户自接 API 时为 0。",
              custom: true,
            },
            {
              name: "SSE image_generation.partial_image",
              description:
                "仅 stream=true 或 Accept: text/event-stream 时返回；表示一张局部图片。",
            },
            {
              name: "SSE image_generation.completed",
              description:
                "仅流式模式返回；表示单张图片已完成，事件 data 会带 generation_id、credits_consumed、model、size 和最终图片。",
            },
          ],
          notes: [
            "该接口不会调用页面 /api/images/generate，而是直接进入共享 service 层。",
            "如果命中 Responses 账号池，内部会把图片请求转换成 Responses image_generation tool 请求。",
            "n/count 批量张数属于一次 HTTP 请求；一次 10 张会创建 10 条生成记录并按 10 张计费。运行时按套餐的生图并发受限并行，超过并发上限的图片会在本批次内排队等待。",
            "并发与排队：底层只有一条进程内生图队列，任务按套餐队列优先级排序，同优先级先进先出；队列同时受全局并发和单用户生图并发限制。全局并发可在后台「系统设置 > 模型 > 全局生图并发」配置，环境变量 IMAGE_GENERATION_GLOBAL_CONCURRENCY 只作为兜底默认值。批量请求额外有请求内 runner，只启动套餐允许的并发数，剩余图片留在本批次内等待，不会一次性塞满底层队列。",
            "排队等待阶段不会创建 generation，也不会扣图像生成积分；底层队列排队超过 IMAGE_GENERATION_QUEUE_TIMEOUT_MS 会返回 429 类错误。单张任务开始执行后才进入 20 分钟运行超时，运行超时按失败结算规则处理积分。",
            "Web 后端无法严格控制输出尺寸和输出格式；本站保存时会按实际图片头识别扩展名和 MIME。",
            "background=transparent 并非所有模型都支持；OpenAI 官方文档当前列出 gpt-image-1.5、gpt-image-1、gpt-image-1-mini 支持透明背景，且通常还要求 png 或 webp 输出。不支持的上游可能直接返回 HTTP 400，而不是自动降级。",
            "async 任务当前为进程内状态，30 分钟后过期；服务重启或多实例切换会导致未完成任务无法继续查询，callback 已发送的结果不受影响。",
            "如果实际生成尺寸与请求尺寸不一致，本站会按检测到的实际尺寸修正记录和计费。",
            "官方 Images API 可能返回 usage；本站当前 usage 通常为 null，但会通过顶层 credits_consumed、错误对象或流式完成事件返回本站结算积分。命中用户自接 API 时不扣本站积分。",
          ],
        },
        {
          title: "Create image edit",
          method: "POST",
          path: "/v1/images/edits",
          contentType: "multipart/form-data 或 application/json",
          description:
            "兼容 OpenAI Images edit。multipart 可上传图片；JSON 可使用公网图片 URL。",
          example: `# 1. multipart 上传参考图
curl https://your-domain.example/v1/images/edits \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -F model="gpt-image-2" \\
  -F prompt="把参考图改成电影海报风格" \\
  -F n="1" \\
  -F size="1024x1024" \\
  -F quality="high" \\
  -F moderation="auto" \\
  -F response_format="url" \\
  -F output_format="jpeg" \\
  -F output_compression="90" \\
  -F background="opaque" \\
  -F 'image[]=@/path/to/reference.png'

# 2. multipart 多参考图 + mask + Codex/Responses 参数
curl https://your-domain.example/v1/images/edits \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -F model="gpt-image-2" \\
  -F prompt="只重绘 mask 区域，保持人物脸部不变" \\
  -F size="1536x1024" \\
  -F quality="medium" \\
  -F response_format="b64_json" \\
  -F promptOptimization="false" \\
  -F gpt_model="gpt-5.4" \\
  -F thinking="medium" \\
  -F 'image[]=@/path/to/person.png' \\
  -F 'image_2=@/path/to/style.png' \\
  -F mask="@/path/to/mask.png"

# 3. JSON 图片 URL；推荐 images，image_url/image_urls 只是兼容快捷字段
curl https://your-domain.example/v1/images/edits \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-image-2",
    "prompt": "把参考图改成干净的电商主图",
    "images": [
      "https://example.com/reference.png",
      { "image_url": "https://example.com/detail.webp" }
    ],
    "image_url": "https://example.com/single-reference.png",
    "image_urls": ["https://example.com/extra.jpg"],
    "mask_url": "https://example.com/mask.png",
    "mask_image_url": "https://example.com/mask-alt.png",
    "n": 1,
    "size": "1024x1024",
    "quality": "auto",
    "moderation": "low",
    "response_format": "url",
    "output_format": "webp",
    "output_compression": 80,
    "background": "transparent",
    "prompt_optimization": false,
    "gptModel": "gpt-5.4-mini",
    "thinking": "low"
  }'

# 4. mixed 分组按可配置像素区间优先尝试 Web；失败或耗尽后降级 Codex/Responses
curl https://your-domain.example/v1/images/edits \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-image-2",
    "prompt": "保留人物，改成电影剧照质感",
    "images": ["https://example.com/reference.png"],
    "size": "1024x1024",
    "response_format": "url",
    "web_first": true
  }'

# 5. 流式图生图
curl -N https://your-domain.example/v1/images/edits \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Accept: text/event-stream" \\
  -F model="gpt-image-2" \\
  -F prompt="保留构图，改成水彩插画风格" \\
  -F size="1024x1024" \\
  -F response_format="url" \\
  -F stream="true" \\
  -F 'image=@/path/to/reference.png'

# 6. 异步图生图；也可在 URL 后追加 ?async=true。callback_url 可选
curl https://your-domain.example/v1/images/edits \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -F model="gpt-image-1.5" \\
  -F prompt="去除背景，输出透明 PNG" \\
  -F size="1024x1024" \\
  -F response_format="url" \\
  -F output_format="png" \\
  -F background="transparent" \\
  -F async="true" \\
  -F callback_url="https://your-server.example/callback" \\
  -F 'image=@/path/to/reference.png'`,
          responseExample: `{
  "created": 1713833628,
  "data": [
    {
      "url": "https://your-domain.example/api/storage/generations/...",
      "revised_prompt": "..."
    }
  ],
  "generation_id": "gen_...",
  "generationId": "gen_...",
  "credits_consumed": 1.31,
  "usage": null
}

# stream=true 时的 SSE 片段
event: image_edit.partial_image
data: {"type":"image_edit.partial_image","index":0,"partial_image_index":0,"url":"https://your-domain.example/api/storage/generations/..."}

event: image_edit.completed
data: {"type":"image_edit.completed","index":0,"generation_id":"...","generationId":"...","model":"gpt-image-2","size":"1024x1024","credits_consumed":1.31,"url":"https://your-domain.example/api/storage/generations/...","data":[{"url":"https://your-domain.example/api/storage/generations/...","revised_prompt":"..."}]}

# async=true 的任务查询和回调响应格式同 /v1/images/generations
`,
          fields: [
            {
              name: "prompt",
              requirement: "必填",
              description: "编辑提示词，最多 32000 字符。",
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
              description: "PNG mask 文件；JSON 中可传 URL 形式的 mask 引用。",
            },
            {
              name: "model",
              requirement: "可选",
              description:
                "图片模型，需为 gpt-image-* 类图片模型；也接受 Adobe Firefly 模型 id（firefly-<family>-<resolution>-<ratio>，或只写族名如 firefly-gpt-image-2），命中后路由到 Adobe（Firefly）后端。取值范围同 /v1/images/generations。",
            },
            {
              name: "force_firefly / forceFirefly",
              requirement: "可选",
              custom: true,
              description:
                "本站扩展：true 时把候选收敛到仅 Adobe（Firefly）后端，使用标准参数。未传 firefly-* 模型时默认族为 gpt-image-2；size 映射 firefly 宽高比/分辨率，quality low/medium/high→detailLevel 1/3/5；不支持的参数静默忽略。详见 /v1/images/generations 与 docs/adobe-firefly-compat.md。",
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
              name: "output_format",
              requirement: "可选",
              description:
                "png、jpeg、webp。控制实际输出图片格式；不同上游支持情况可能不同。",
            },
            {
              name: "output_compression",
              requirement: "可选",
              description:
                "0 到 100，仅对 jpeg/webp 有意义；数值越高质量越高。",
            },
            {
              name: "background",
              requirement: "可选",
              description:
                "transparent、opaque、auto。透明背景需要命中的上游模型支持，通常还需要 output_format 为 png 或 webp；不支持的模型会返回类似 “Transparent background is not supported for this model” 的 400 错误。若希望在不支持的后端也拿到透明结果，可同时传 transparent_matte=true（见下一项）。无法确认支持时建议使用 auto 或 opaque。",
            },
            {
              name: "transparent_matte",
              requirement: "可选",
              custom: true,
              description:
                "默认 false。仅当 background=transparent 且显式设为 true 时生效：若命中的后端不支持透明而返回 400，则自动改为不透明重新生成，再在服务端用 ISNet 抠图得到透明 PNG。关闭时透明请求直接透传，后端不支持即返回真实 400 错误。注意只对单张生成/编辑/对话生效，不含 agent 分层模式。",
            },
            {
              name: "stream",
              requirement: "可选",
              description: "true 时返回 text/event-stream。",
            },
            {
              name: "async",
              requirement: "可选",
              description:
                "true 时立即返回 task_...，后台执行编辑任务；也可用 URL 参数 ?async=true。不能与 stream 同时使用。",
            },
            {
              name: "callback_url",
              requirement: "可选",
              description:
                "异步任务完成或失败后 POST 完整任务结果到该地址，请求头包含 X-Tokens-Callback: true。仅允许公网 http/https 地址。",
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
              name: "promptRepair / prompt_repair",
              requirement: "可选",
              custom: true,
              description:
                "审核改写重试开关（issue #24）。默认按平台设置（通常启用）：本地审核拦截或上游安全拒绝导致无图输出时，系统会先用 Responses 改写提示词，再在同一生成任务内重新审核并重试；显式传 false 时关闭该自动改写重试，审核失败直接返回真实错误，不再改写提示词。详见下方“审核失败自动修剪重试”说明。",
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
            {
              name: "web_first / webFirst / force_web / forceWeb",
              requirement: "可选",
              custom: true,
              description:
                "仅 image 接口支持。推荐使用 web_first / webFirst；force_web / forceWeb 保留兼容，但实际语义同样是 Web-first 优先路由，不是硬性只走 Web。用户自接 API 优先时忽略；进入平台账号池、命中的后端分组为 mixed，且请求尺寸总像素在 IMAGE_FORCE_WEB_MIN_PIXELS 到 IMAGE_FORCE_WEB_MAX_PIXELS 之间时，优先调度 Web 账号。Web 不可用、失败或耗尽后会降级 Codex/Responses。默认区间为 0.66MP-2MP；非 mixed 或不在区间内会忽略该字段。",
            },
          ],
          responses: [
            {
              name: "created / data[]",
              description: "与 /v1/images/generations 相同。",
            },
            {
              name: "generation_id / generationId / credits_consumed",
              description:
                "本站扩展字段。非流式成功响应会在顶层返回本次生成记录 ID 和本站结算积分；批量请求会返回 generation_ids / generationIds 以及合计 credits_consumed。命中用户自接 API 时为 0。",
              custom: true,
            },
            {
              name: "SSE image_edit.partial_image",
              description:
                "仅 stream=true 或 Accept: text/event-stream 时返回；表示一张局部编辑图片。",
            },
            {
              name: "SSE image_edit.completed",
              description:
                "仅流式模式返回；表示单张编辑图片已完成，事件 data 会带 generation_id、credits_consumed、model、size 和最终图片。",
            },
          ],
          notes: [
            "URL 图片会先由本站服务端下载并校验公网可访问性、类型和大小。",
            "不支持私网、localhost、metadata/internal 域名或带用户名密码的 URL。",
            "官方 JSON file_id 图片引用当前未实现，请使用公网 image_url 或 multipart 上传。",
            "background=transparent 并非所有模型都支持；OpenAI 官方文档当前列出 gpt-image-1.5、gpt-image-1、gpt-image-1-mini 支持透明背景，且通常还要求 png 或 webp 输出。不支持的上游可能直接返回 HTTP 400，而不是自动降级。",
            "async 任务当前为进程内状态，30 分钟后过期；服务重启或多实例切换会导致未完成任务无法继续查询，callback 已发送的结果不受影响。",
          ],
        },
        {
          title: "Create video",
          method: "POST",
          path: "/v1/videos/generations",
          contentType: "application/json",
          description:
            "本站扩展：Adobe Firefly 视频生成。固定路由到 Adobe（Firefly）后端，是长任务（保持连接 / keep-alive 撑住连接直到出片），返回 OpenAI Images 风格结构，data[].url 为产物视频 URL。鉴权与其他 v1 接口一致（外部 API Key）。",
          example: `# 1. 文生视频；model 为完整 Firefly 视频 id
curl https://your-domain.example/v1/videos/generations \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "firefly-veo31-8s-16x9-1080p",
    "prompt": "一只柯基在海边奔跑，电影级运镜，黄昏光线",
    "negative_prompt": "低分辨率, 模糊, 水印"
  }'

# 2. 图生视频；image 为 base64 data URL 数组（首帧/参考），最多 3 张
curl https://your-domain.example/v1/videos/generations \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "firefly-kling3-5s-9x16",
    "prompt": "让画面中的人物缓缓抬头微笑",
    "image": ["data:image/png;base64,iVBORw0KGgo..."]
  }'`,
          responseExample: `{
  "created": 1713833628,
  "model": "firefly-veo31-8s-16x9-1080p",
  "data": [
    { "url": "https://your-domain.example/api/storage/generations/..." }
  ],
  "credits_consumed": 240
}`,
          fields: [
            {
              name: "prompt",
              requirement: "必填",
              description: "视频提示词，最多 32000 字符。",
            },
            {
              name: "model",
              requirement: "必填",
              description:
                "Firefly 视频模型 id：firefly-<family>-<dur>s-<ratio>[-<res>]（如 firefly-veo31-8s-16x9-1080p）。family ∈ sora2、sora2-pro、veo31、veo31-ref、veo31-fast、kling-o3、kling3；非法或未知 id 会返回参数错误。可用组合见 /v1/models。",
            },
            {
              name: "negative_prompt / negativePrompt",
              requirement: "可选",
              description: "负向提示词，最多 8000 字符。",
            },
            {
              name: "image",
              requirement: "可选",
              description:
                "图生视频输入图（首帧 / 参考），为 base64 image data URL 数组，最多 3 张。",
            },
          ],
          responses: [
            {
              name: "created",
              description: "Unix 秒时间戳。",
            },
            {
              name: "model",
              description: "本次使用的 Firefly 视频模型 id。",
            },
            {
              name: "data[].url",
              description: "产物视频的本站存储 URL。",
            },
            {
              name: "credits_consumed",
              description: "本次结算积分。",
              custom: true,
            },
          ],
          notes: [
            "该接口是本站扩展，不是 OpenAI 官方接口；/api/v1/videos/generations 是同一 handler 的别名。",
            "视频生成是长任务，本站用 keep-alive 撑住连接直到出片或失败；请把客户端读超时设置得足够长。",
            "计费 = 每秒基础积分（默认 30）× 时长（秒）× 模型族倍率，结果向上取两位小数；时长由 model id 中的 <dur> 决定。",
            "默认需要 externalApi.images.generate 能力（入门版及以上），可在套餐能力矩阵中调整。",
          ],
        },
        {
          title: "Create Agent image run",
          method: "POST",
          path: "/v1/agents/images",
          contentType: "application/json 或 multipart/form-data",
          description:
            "本站扩展接口：把页面 Agent 模式开放给外接 API。它固定按 Codex/Responses 能力调度，支持联网、工具循环、自动迭代、附件上下文和流式 Agent 事件。",
          example: `# 1. JSON Agent 生图；默认返回 URL。默认需要 Ultra，可在能力矩阵 externalApi.agent 调整。
curl https://your-domain.example/v1/agents/images \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-5.4",
    "image_model": "gpt-image-2",
    "prompt": "联网查询浙江双元科技公开资料，迭代生成一张企业宣传海报",
    "size": "1536x1024",
    "quality": "high",
    "thinking": "medium",
    "agent_max_rounds": 3,
    "agent_force_max_rounds": false,
    "response_format": "url"
  }'

# 2. 带参考图 URL。images / image_url / image_urls 会合并去重。
curl https://your-domain.example/v1/agents/images \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-5.4-mini",
    "image_model": "gpt-image-2",
    "prompt": "参考这张产品图，先分析卖点，再生成一张电商海报",
    "images": ["https://example.com/product.png"],
    "size": "1024x1024",
    "agent_max_rounds": 2
  }'

# 3. multipart 上传参考图和 PDF/文本附件。
curl https://your-domain.example/v1/agents/images \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -F model="gpt-5.4" \\
  -F image_model="gpt-image-2" \\
  -F prompt="阅读附件资料并生成一张展会宣传海报" \\
  -F size="1536x1024" \\
  -F response_format="url" \\
  -F agent_max_rounds="3" \\
  -F 'image[]=@/path/to/reference.png' \\
  -F 'file=@/path/to/company-profile.pdf'

# 4. 流式 Agent。会持续返回 agent.event / agent.partial_image / agent.completed。
curl -N https://your-domain.example/v1/agents/images \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Accept: text/event-stream" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-5.4",
    "image_model": "gpt-image-2",
    "prompt": "先搜索资料，再迭代生成一张科技蓝企业海报",
    "size": "1536x1024",
    "stream": true,
    "agent_max_rounds": 2,
    "agent_force_max_rounds": true
  }'`,
          responseExample: `{
  "object": "agent.image_run",
  "created": 1713833628,
  "generation_id": "gen_...",
  "generationId": "gen_...",
  "model": "gpt-5.4",
  "size": "1536x1024",
  "response_text": "已完成资料检索并生成海报。",
  "agent_round_count": 2,
  "credits_consumed": 8.42,
  "data": [
    {
      "url": "https://your-domain.example/api/storage/generations/...",
      "revised_prompt": "...",
      "output_role": "agent_draft"
    },
    {
      "url": "https://your-domain.example/api/storage/generations/...",
      "revised_prompt": "...",
      "output_role": "final"
    }
  ],
  "agent_events": [],
  "usage": null
}

# stream=true 时的 SSE 片段
event: agent.event
data: {"type":"agent.event","event":{"kind":"web_search","status":"completed","title":"联网搜索完成","detail":"浙江双元科技 官网"}}

event: agent.partial_image
data: {"type":"agent.partial_image","partial_image_index":0,"url":"https://your-domain.example/api/storage/generations/..."}

event: agent.completed
data: {"type":"agent.completed","generation_id":"...","generationId":"...","agent_round_count":2,"credits_consumed":8.42,"data":[{"url":"https://your-domain.example/api/storage/generations/...","output_role":"final"}]}
`,
          fields: [
            {
              name: "prompt",
              requirement: "必填",
              description: "Agent 当前任务，最多 32000 字符。",
            },
            {
              name: "model / gptModel / gpt_model",
              requirement: "可选",
              description:
                "Agent 顶层 GPT/Responses 模型。若 model 是 gpt-image-*，本站会把它当作 image_model 兼容处理。",
            },
            {
              name: "image_model / imageModel",
              requirement: "可选",
              description:
                "image_generation 工具使用的图片模型，通常为 gpt-image-*。",
            },
            {
              name: "images / image_url / image_urls",
              requirement: "JSON 可选",
              description:
                "公网参考图 URL；也支持 data URL。本站会服务端下载并校验公网可达、类型和大小。",
            },
            {
              name: "image / image[] / image_*",
              requirement: "multipart 可选",
              description: "参考图文件，和附件总数受套餐 maxChatImages 限制。",
            },
            {
              name: "file / file[] / attachment",
              requirement: "multipart 可选",
              description:
                "文本、代码、CSV、JSON、Markdown、XML、YAML、日志或 PDF 附件。文本类会转成上下文，PDF 会作为 Responses 文件输入。",
            },
            {
              name: "history",
              requirement: "可选",
              description:
                "前序对话数组，形如 [{ role, text, imageUrls, variants }]；用于继续外接 Agent 会话。",
            },
            {
              name: "agent_max_rounds",
              requirement: "可选",
              description: "1 到 8。限制本次 Agent 自动迭代轮数。",
              custom: true,
            },
            {
              name: "agent_force_max_rounds",
              requirement: "可选",
              description:
                "true 时强制跑满 agent_max_rounds；false 时模型可通过 continue_generation 自行停止。",
              custom: true,
            },
            {
              name: "n / count",
              requirement: "可选",
              description:
                "Agent 接口一次只跑一个任务；传入时必须为 1。需要多任务请并发调用接口。",
            },
            {
              name: "size / quality / moderation / output_format / output_compression",
              requirement: "可选",
              description:
                "同 image 接口，作为 Agent 内 image_generation 工具运行参数。",
            },
            {
              name: "background",
              requirement: "可选",
              description:
                "transparent、opaque、auto。与 /v1/images/generations 同义。",
            },
            {
              name: "transparent_matte",
              requirement: "可选",
              custom: true,
              description:
                "默认 false。仅当 background=transparent 且设为 true 时：后端不支持透明返回 400 时自动改不透明重绘并用 ISNet 抠图得到透明 PNG；注意 agent 分层模式下不生效。详见 /v1/images/generations 说明。",
            },
            {
              name: "promptRepair / prompt_repair",
              requirement: "可选",
              custom: true,
              description:
                "本站扩展：审核改写重试开关。false 时审核失败直接返回真实错误，不自动改写提示词重试。",
            },
            {
              name: "thinking",
              requirement: "可选",
              custom: true,
              description: "minimal、none、low、medium、high、xhigh。",
            },
            {
              name: "response_format",
              requirement: "可选",
              description:
                "url 或 b64_json。Agent 接口默认 url，避免多轮结果响应过大。",
            },
            {
              name: "stream",
              requirement: "可选",
              description:
                "true 或 Accept: text/event-stream 返回 SSE；同时要求 externalApi.streaming 能力。",
            },
          ],
          responses: [
            {
              name: "object / generation_id / model / size",
              description: "Agent 运行对象、生成记录和模型尺寸信息。",
            },
            {
              name: "data[]",
              description:
                "本次 Agent 产生的图片。output_role 可为 agent_draft 或 final；最后的 final 是默认成品。",
            },
            {
              name: "agent_events[]",
              description:
                "任务事件数组，包含联网、生图、继续/停止决策等结构化事件。",
            },
            {
              name: "credits_consumed / agent_round_count",
              description:
                "本站结算积分和 Agent 轮数。Agent 接口固定走 Codex/Responses 能力，不使用用户自接 API；计费 = Agent 每轮基础积分 + 最终图片输出积分 + 审核积分，并叠加分组倍率。",
              custom: true,
            },
            {
              name: "SSE agent.event / agent.partial_image / agent.completed",
              description: "流式 Agent 任务事件、流式预览图和最终完成事件。",
            },
          ],
          notes: [
            "该接口是本站扩展，不是 OpenAI 官方接口；/api/v1/agents/images 是同一 handler 的别名。",
            "默认要求 Ultra 套餐；管理员可在套餐能力矩阵中调整 externalApi.agent。",
            "该接口强制 requiresResponsesBackend，不会命中 Web 账号；支持 Codex/Responses 账号或支持 /responses 的外接 API 后端。",
            "不会调用页面 /api/images/chat；它和页面 Agent 共享 runImageGenerationForUser service 层。",
            "generate_image_batch 并发工具暂未开放，避免破坏线性迭代和 Responses 粘性会话。",
          ],
        },
        {
          title: "Create response",
          method: "POST",
          path: "/v1/responses",
          contentType: "application/json",
          description:
            "基于 OpenAI Responses API 的生图适配入口。它会按 responses 调度类型选择 Codex/Responses 账号池或外接 /responses API 后端。",
          example: `# 1. 最小 Responses 生图请求；需要 Pro 套餐
curl https://your-domain.example/v1/responses \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-5.4",
    "input": "生成一张 1:1 的未来感产品渲染图",
    "size": "1024x1024",
    "quality": "high",
    "moderation": "auto"
  }'

# 2. 显式 image_generation tool，并指定图片模型
curl https://your-domain.example/v1/responses \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-5.4",
    "input": "生成一张横版科技产品 KV",
    "tools": [{ "type": "image_generation", "model": "gpt-image-2" }],
    "size": "1536x864",
    "quality": "medium",
    "reasoning": { "effort": "low" },
    "store": true
  }'

# 3. 带参考图的 Responses 输入
curl https://your-domain.example/v1/responses \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-5.4-mini",
    "input": [
      {
        "role": "user",
        "content": [
          { "type": "input_text", "text": "参考这张图，换成冬季海报风格" },
          { "type": "input_image", "image_url": "https://example.com/reference.png" }
        ]
      }
    ],
    "tools": [{ "type": "image_generation", "model": "gpt-image-2" }],
    "size": "1024x1024",
    "output_format": "webp",
    "output_compression": 85,
    "moderation": "low"
  }'

# 4. 续接上一轮，并使用流式返回
curl -N https://your-domain.example/v1/responses \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-5.4",
    "previous_response_id": "resp_previous_id",
    "input": "在上一张图基础上加一个月亮",
    "tools": [{ "type": "image_generation", "model": "gpt-image-2" }],
    "size": "1024x1024",
    "reasoning": { "effort": "minimal" },
    "stream": true
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
}

# stream=true 时的 SSE 片段
event: response.output_item.done
data: {"type":"response.output_item.done","item":{"id":"ig_...","type":"image_generation_call","status":"completed","result":"..."}}

event: response.completed
data: {"type":"response.completed","response":{"id":"resp_...","object":"response","created_at":1713833628,"status":"completed","model":"gpt-5.4","output":[{"id":"ig_...","type":"image_generation_call","status":"completed","result":"..."}],"usage":null,"metadata":{"generation_id":"...","credits_consumed":1.31,"size":"1024x1024"}}}
`,
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
                '若显式传入，必须包含 { type: "image_generation" }；未传时本站会自动补 image_generation。图片模型请放在 image_generation tool 的 model 字段。',
            },
            {
              name: "tool_choice",
              requirement: "可选",
              description:
                "兼容接收字段。对话/多工具场景不建议强制指定，否则模型可能无法同时使用联网、代码解释器或图片生成工具。",
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
              description:
                "支持 minimal、none、low、medium、high、xhigh；最终是否生效取决于命中的后端。",
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
              description: "本站便捷字段：作为本次生图 quality 运行参数使用。",
            },
            {
              name: "moderation",
              requirement: "可选",
              custom: true,
              description:
                "本站便捷字段：作为本次生图 moderation 运行参数使用。",
            },
            {
              name: "output_format",
              requirement: "可选",
              custom: true,
              description:
                "本站便捷字段：未在 image_generation tool 内指定输出格式时，作为本次 output_format 使用。也可直接写在 image_generation tool 里。",
            },
            {
              name: "output_compression",
              requirement: "可选",
              custom: true,
              description:
                "本站便捷字段：未在 image_generation tool 内指定压缩率时，作为本次 output_compression 使用。",
            },
            {
              name: "background",
              requirement: "可选",
              description:
                "transparent、opaque、auto，作为本次生图 background。详见 /v1/images/generations 说明。",
            },
            {
              name: "transparent_matte",
              requirement: "可选",
              custom: true,
              description:
                "默认 false。仅当 background=transparent 且设为 true 时：命中的后端不支持透明返回 400 后自动改不透明重绘，再用 ISNet 抠图得到透明 PNG；agent 分层模式下不生效。详见 /v1/images/generations 说明。",
            },
            {
              name: "promptRepair / prompt_repair",
              requirement: "可选",
              custom: true,
              description:
                "本站便捷字段：审核改写重试开关。false 时审核失败直接返回真实错误，不自动改写提示词重试。",
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
              description:
                "本站生成记录、结算积分和尺寸信息；命中用户自接 API 时 credits_consumed 为 0。",
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
            "该接口不是 Chat Completions；普通对话生图请使用 /v1/chat/completions，Responses 工具语义请使用本接口。",
            "input_image 只支持 image_url/data URL；file_id/file 输入当前不会作为参考图使用。",
            "显式传 tools 但不包含 image_generation 会返回错误，避免模型只产出文本而不生图。",
            "页面 Chat 模式只提供普通多模态对话/生图语义；Agent 模式默认提供 image_generation、web_search 和线性续跑工具 continue_generation，不强制 tool_choice，模型按任务自行选择工具。",
            "页面 Chat/Agent 支持上传文本/代码类本地文件作为上下文读取；不会读取用户在提示词中写入的服务器本地路径。",
            "页面 Chat/Agent 的每轮基础积分由后台「套餐能力矩阵」按套餐配置，默认 Chat 每轮 1 积分、Agent 每轮 3 积分；生成图片时再按实际尺寸和输出数量追加图片积分。",
            "Agent 会把上一轮文字、工具结果和已生成图片喂回下一轮，让模型自行判断是否继续改版；最大轮数由系统设置 IMAGE_AGENT_MAX_ROUNDS 控制，默认 3。当前没有接入 generate_image_batch 这类并发批量工具，以免打散 Responses 粘性会话。",
            "Agent 多轮产生的 image_generation_call 会作为自动迭代版本展示，最后一张作为默认选中版本。",
          ],
        },
      ],
    },
    web: {
      title: "Web 账号",
      description:
        "走 ChatGPT 网页生图能力，适合复用 Web 账号额度，但不是严格参数化的 Images/Responses API。",
      valid: [
        "**分辨率不可严格控制；size 只能作为提示/记录参考，不能保证按请求尺寸输出。**",
        "**不能保证 4K 输出；是否出高分辨率取决于 ChatGPT Web 当前能力和账号状态。**",
        "可控制主 GPT 对话模型和 Web 思考强度；图片模型字段不会映射成独立 Web 生图模型。",
        "关闭提示词优化时会发送原始 prompt，并把 Web 思考强度压到 instant，尽量减少平台侧改写。",
      ],
      invalid: [
        "外部 /v1/responses 会适配进统一 chat 生成链路，但调度类型仍是 responses；当前只会选择 Codex/Responses 分组或外接 Responses API 后端，不会转到 Web 账号池。",
        "外部 /v1/responses 的 model 为空时使用后端默认；显式传入时需在 /v1/models 返回列表内，超出列表会被本站拦截。",
        "不保证完全不改写提示词；ChatGPT Web 上游仍可能理解、补全或改写。",
      ],
    },
    codex: {
      title: "Codex / Responses 账号",
      description: "走 Responses 语义，是本站可参数化程度最高的系统账号后端。",
      valid: [
        "GPT 模型传给 Responses 顶层 model。",
        "图片模型传给 image_generation 工具 model。",
        "size、quality、moderation、参考图、mask 会组装进 Responses 工具请求。",
        "页面 Chat 模式只提供普通多模态对话/生图语义；页面 Agent 模式默认提供 image_generation、web_search、continue_generation，不强制 tool_choice，并会线性多轮续跑，让模型像 Codex 一样按需联网、读取已上传文本文件上下文、生成草图和迭代改版。",
        "Chat/Agent 上传的本地文本/代码文件会作为请求上下文读取；不会开放服务器文件系统路径读取。",
        "支持外部 /v1/responses；也可承接 /v1/images/generations 和 /v1/images/edits 的内部转换。",
        "关闭提示词优化时，会通过指令引导模型不要修改提示词；这是尽力约束，不能保证上游一定完全照做。",
        "页面 Chat/Agent 的每轮基础积分由后台「套餐能力矩阵」按套餐配置，默认 Chat 每轮 1 积分、Agent 每轮 3 积分；完成的图片输出另按实际尺寸和完成数量计费。",
      ],
      invalid: [
        "不是 ChatGPT Web，不支持 Web 专属能力或 Web 额度语义。",
        "账号限流、额度不足、凭据失效时，调度器会冷却/标错并尝试轮换。",
      ],
    },
    api: {
      title: "外接 API 后端",
      description:
        "走管理员配置的 OpenAI 兼容 Base URL/API Key，最终能力由对方服务决定。",
      valid: [
        "接口模式只声明上游支持哪些端点：仅 Images 只参与文生图/图生图；仅 Responses 只参与 Chat/Agent/Responses，除非 Images 上游开关设为 Responses；混合 API 两边都可参与。",
        "Images 上游开关独立控制文生图/图生图：原生 Images 会请求对方 /images/generations 和 /images/edits；转换为 Responses 会请求对方 /responses + image_generation tool。",
        "Chat Completions 上游开关独立控制 /v1/chat/completions：Responses 生图模式请求对方 /responses；原生模式请求对方 /chat/completions。",
        "模型、尺寸、质量、流式事件、usage 字段是否支持，以对方接口为准。",
      ],
      invalid: [
        "不使用本站 Web 或 Codex 账号池额度。",
        "对方如果自行改写提示词或限制分辨率，本站无法覆盖。",
      ],
    },
    prompt: {
      title: "提示词优化与思考强度",
      rows: [
        [
          "开启提示词优化",
          "平台可使用优化后的提示词，Web 思考强度按选择值传入。",
        ],
        [
          "关闭提示词优化",
          "平台发送原始提示词，Web 强制使用 instant，尽量减少改写。",
        ],
        [
          "Codex/Responses",
          "关闭提示词优化时通过指令要求模型不要修改提示词，但具体是否改写仍由上游模型和工具决定。",
        ],
        ["外接 API", "平台尽量透传，最终行为取决于外接服务。"],
      ],
    },
    roadmap: {
      title: "后续规划",
      items: [
        "Sub2API 非数据库接口：当前同步依赖 SUB2API_POSTGRES_URL 直连 Sub2API PostgreSQL。后续调研并适配 Sub2API 管理员 Key / HTTP API 路线，优先用正式接口完成账号查询、分组筛选、状态读取、错误清理和同步任务；只有接口缺字段或能力不足时再保留数据库直连兜底。",
        "PSD 生成接口：准备适配 PSD/分层文件生成能力，需先明确上游接口协议、输出 MIME/扩展名、存储与预览策略、积分计费、外接 API 响应字段、后台能力矩阵开关和页面下载入口。",
        "Agent 批量生图工具：参考 generate_image_batch 模式，让模型规划多张独立图片后由后端并发执行；接入前需要先设计它与 Responses previous_response_id 粘性会话的关系。",
        "图片引用交互：继续完善 @图1、@第N轮图M 的原子化输入、图片重排后的引用重映射和缺失引用提示。",
        "Agent 分支对话/轮次树：编辑或重生成历史某一轮时，从该轮派生新分支，避免覆盖后续记录。",
      ],
    },
  },
  en: {
    title: "System Docs",
    subtitle:
      "Page endpoints and external endpoints are protocol adapters. They do not call each other over HTTP; they enter the same generation, billing, scheduling, and storage path. Default deployments enable self-use mode: public registration is closed and the first startup creates a local super admin with a random password.",
    flow: {
      title: "Request Routing Diagram",
      note: "For ordinary image/chat/responses requests, user custom API keeps the highest priority for now. When it wins, GPT2IMAGE does not charge account credits or external API key quota. Agent and explicitly Codex/Responses-only entries ignore user custom API. External endpoints do not call internal /api/images/* routes.",
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
          label: "Page Agent image run",
          path: "POST /api/images/chat",
          kind: "agent",
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
          label: "External video API",
          path: "POST /v1/videos/generations",
          kind: "video",
        },
        {
          label: "External async image task",
          path: "GET /v1/images/{task_id}",
          kind: "image_generation",
        },
        {
          label: "External Chat Completions API",
          path: "POST /v1/chat/completions",
          kind: "chat",
        },
        {
          label: "External Responses API",
          path: "POST /v1/responses",
          kind: "responses",
        },
        {
          label: "External Agent image API",
          path: "POST /v1/agents/images",
          kind: "agent",
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
        "Unbound external API keys use the platform default group",
        "Page creation is the only path that uses the user's selected image backend group",
        "Group checks plan access, enabled state, and content safety setting",
      ],
      backends: [
        {
          title: "User Custom API",
          description:
            "If the user configured an OpenAI-compatible API, ordinary image/chat/responses requests use it first. When it wins, useCredits=false, so GPT2IMAGE account balance and API key quota are not charged.",
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
      headers: [
        "Entry",
        "Internal Endpoint",
        "Request Kind",
        "Backend Behavior",
      ],
      apiHeaders: [
        "Entry",
        "Compatible Endpoint",
        "Request Kind",
        "Backend Behavior",
      ],
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
        [
          "Create page Agent run",
          "/api/images/chat",
          "agent",
          "Same internal endpoint, but uses Codex/Responses capability; it provides image_generation, web_search, continue_generation, and visible task cards.",
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
          "Adobe Firefly video",
          "/v1/videos/generations",
          "video",
          "GPT2IMAGE extension. A long-running job that always routes to the Adobe (Firefly) backend, holds the connection with keep-alive until the video is ready, and returns the produced video URL.",
        ],
        [
          "Async image task",
          "/v1/images/{task_id}",
          "image_generation",
          "Returns the in-memory task created with async=true. Tasks expire after 30 minutes.",
        ],
        [
          "OpenAI chat completions",
          "/v1/chat/completions",
          "chat",
          "Checks externalApi.chat.completions and then enters the page Chat non-Agent path; can route to Web, Codex/Responses, or external API backends that support /responses.",
        ],
        [
          "OpenAI Responses",
          "/v1/responses",
          "responses",
          "Adds the image_generation tool when tools are omitted; explicit tools must include image_generation. User custom API still wins when available; otherwise responses routing selects Codex/Responses groups or external /responses API backends.",
        ],
        [
          "GPT2IMAGE Agent image run",
          "/v1/agents/images",
          "agent",
          "GPT2IMAGE extension. Requires externalApi.agent, routes to Codex/Responses only, and can stream Agent task events plus multi-round image outputs.",
        ],
        [
          "OpenAI models",
          "/v1/models",
          "-",
          "Only lists models visible to the current plan/API key and does not trigger backend pool routing.",
        ],
        [
          "GPT2IMAGE credits",
          "/v1/credits",
          "-",
          "Returns the current API key quota, usage, remaining quota, and the owning account credit balance without backend routing.",
        ],
      ],
    },
    relationship: {
      title: "How The Page And External Endpoints Relate",
      rows: [
        [
          "Three page endpoints",
          "/api/images/generate, /api/images/edit, /api/images/chat",
          "Browser-session entrypoints that adapt page forms, reference images, and internal stream events.",
        ],
        [
          "Agent mode",
          "/api/images/chat + agentMode=true",
          "Enables a Codex-style tool loop and automatic image iteration inside the page Chat endpoint.",
        ],
        [
          "External API entries",
          "/v1/chat/completions, /v1/images/generations, /v1/images/edits, /v1/videos/generations, /v1/images/{task_id}, /v1/responses, /v1/agents/images",
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
      note: "The relationship is not external API -> page API. It is multiple adapters -> one shared service layer.",
    },
    moderationRepair: {
      title: "Safety Prompt Repair Retry",
      description:
        "When local moderation, upstream safety refusal, or safety-refusal text without an image is detected, the system can rewrite the prompt through a text-only Responses request and retry generation inside the same task.",
      valid: [
        "Requires at least one usable Codex/Responses account or an external API backend that supports /responses. Even a Web-only generation group can borrow a Responses backend for the rewrite step.",
        "IMAGE_MODERATION_PROMPT_REPAIR_ENABLED controls the feature; IMAGE_MODERATION_PROMPT_REPAIR_MAX_RETRIES controls the maximum rewrite rounds. Set retries to 0 to disable.",
        "Retries do not create a second generation record. Billing remains attached to the original task and final output; the status page reports attempts, successes, and failures by retry number.",
        "When a rewrite succeeds, the UI and external API return a separate notice that the original prompt was rejected by safety checks and generated after additional adjustments. This notice is not written into revised_prompt.",
        "If no Responses backend is available, or the rewritten prompt is still blocked, the original moderation failure is kept and normal failed-settlement rules apply.",
      ],
      invalid: [
        "Moderation-service outages, upstream rate limits, insufficient credits, and model permission errors are not prompt-repair cases.",
        "Only the text prompt is rewritten; uploaded reference images, masks, and attachments are not modified.",
      ],
    },
    agent: {
      title: "Page Agent Mode",
      description:
        "Agent is a Codex-style automatic run mode. The page version reuses /api/images/chat and shows task cards; /v1/agents/images exposes the same run style as JSON/SSE for external clients.",
      valid: [
        "Enabled only when Codex/Responses capability is available; the Web branch does not run Agent tools.",
        "Default tools include image_generation, web_search, and continue_generation. The backend does not force tool_choice so the model can combine search, image generation, and continuation.",
        "Each round shows Agent task cards such as web search, tool compatibility adjustment, image generation, streaming preview, and continue/stop decisions.",
        "Uploaded text/code files can be read as request context; prompted server filesystem paths are not read.",
        "Max rounds are configurable. With force rounds enabled, Agent runs the selected number of rounds; otherwise the model decides whether to continue through continue_generation.",
        "Draft images from multiple rounds are stored as iteration variants, with the last image selected as the default final output.",
        "Billing has a base Agent round charge plus actual image output credits. The default is 3 credits per Agent round, controlled by the Plan Capability Matrix.",
      ],
      invalid: [
        "External /v1/responses is not Agent. It adapts the OpenAI Responses protocol and does not automatically enable the Agent tool loop.",
        "generate_image_batch-style concurrent batch tooling is not wired in yet to avoid breaking Responses native state and linear iteration.",
      ],
    },
    externalDocs: {
      title: "External API Reference",
      subtitle:
        "This documents the currently supported OpenAI-compatible surface. Bold fields are GPT2IMAGE extensions or compatibility additions, not standard OpenAI fields.",
      commonTitle: "Common Rules",
      baseUrlTitle: "Base URL",
      baseUrl: "https://your-domain.example",
      examplesTitle: "Request Example",
      responseExampleTitle: "Response Example",
      common: [
        "All external endpoints require Authorization: Bearer <GPT2IMAGE API key>.",
        "Chat Completions, image generation, and image edits require Starter or higher; Responses requires Pro or higher; Agent image runs require Ultra by default. The exact gates can be changed with externalApi.* in the Plan Capability Matrix.",
        "/api/v1/* and /v1/* use the same handlers; they are path aliases.",
        "response_format controls URL vs base64; output_format controls the image file format. They are different fields.",
        "Error responses use an OpenAI-style error object. GPT2IMAGE may also return generation_id, generationId, and credits_consumed for debugging and reconciliation.",
        "A backend group bound to the external API key wins first. Otherwise the platform default group is used, then the enabled fallback group. Page creation still uses the user's selected default group.",
        "Backend group billing multipliers are applied to pre-charge, settlement, refunds, and usage records. When a mixed parent group dispatches to a child group member, the parent and child multipliers are multiplied.",
        "External API keys can have independent credit limits. GET /v1/credits returns key quota, used credits, and account balance.",
        "If the user has enabled a custom upstream API, ordinary /v1/chat/completions, /v1/images/generations, /v1/images/edits, and /v1/responses still use that custom API first. When it wins, credits_consumed is 0 and GPT2IMAGE does not charge account credits or API key quota.",
        "/v1/agents/images and page features that require Codex/Responses capability ignore user custom API and are billed through the platform or external backend pool.",
        "Image endpoint web_first / webFirst / force_web / forceWeb means Web-first preference, not hard Web-only routing. It only applies after routing enters a platform mixed backend group, does not override user custom API, and falls back to Codex/Responses when Web is unavailable or fails.",
        "Adobe (Firefly) backend: it joins the group as a special pool member ranked by priority. A firefly-* model or force_firefly=true narrows candidates to Adobe only; ordinary requests only fall back to Adobe once the group's web/codex/api members are rate-limited, exhausted, or fail with a switchable error (and only if Adobe is in that group — the larger its priority, the later it is tried). Whether a request reaches Adobe and its billing multiplier follow the admin 'Adobe backend' tab config. Image billing = size base credits × model-family multiplier × Adobe backend multiplier × group multiplier; see /v1/videos/generations for video billing. Routing/fallback: docs/adobe-firefly-routing.md; compatibility conversion (in-app params → Adobe fields, ignored params, worked example): docs/adobe-firefly-compat.md.",
      ],
      officialRefsTitle: "Official References",
      officialRefs: [
        {
          label: "Chat Completions API",
          href: "https://developers.openai.com/api/reference/chat/create",
        },
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
          example: `curl https://your-domain.example/v1/models \\
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
          title: "Get credits",
          method: "GET",
          path: "/v1/credits",
          contentType: "No request body",
          description:
            "Returns the current Bearer API key's credit limit, used credits, remaining credits, and owning account balance.",
          example: `curl https://your-domain.example/v1/credits \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY"`,
          responseExample: `{
  "object": "credit_balance",
  "account": {
    "balance": 15702.45,
    "total_earned": 20000,
    "total_spent": 4297.55,
    "status": "active"
  },
  "api_key": {
    "credit_limit": 1000,
    "credits_used": 12.7,
    "credits_remaining": 987.3,
    "unlimited": false
  }
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
              name: "account.balance",
              description: "Current available credits on the owning account.",
            },
            {
              name: "api_key.credit_limit",
              description:
                "Total limit for this API key; null means unlimited.",
            },
            {
              name: "api_key.credits_used / credits_remaining",
              description:
                "Used and remaining quota for this key. credits_remaining is null when unlimited.",
            },
          ],
          notes: [
            "The API key quota only limits this key. Calls through the GPT2IMAGE-billed platform path still require enough account credits.",
            "When a user custom upstream API wins, GPT2IMAGE does not charge account credits or key quota.",
            "Failed-generation refunds, moderation settlement, and actual-size corrections also update key usage.",
          ],
        },
        {
          title: "Create chat completion",
          method: "POST",
          path: "/v1/chat/completions",
          contentType: "application/json",
          description:
            "OpenAI-compatible Chat Completions adapter for GPT2IMAGE page Chat non-Agent mode. It does not enable the Agent tool loop.",
          example: `# 1. Chat-to-image. URL is the default to keep response bodies small.
curl https://your-domain.example/v1/chat/completions \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-5.4",
    "image_model": "gpt-image-2",
    "messages": [
      { "role": "system", "content": "You are a professional poster designer." },
      { "role": "user", "content": "Create a 16:9 blue and white technology company poster" }
    ],
    "size": "1536x864",
    "quality": "high",
    "response_format": "url"
  }'

# 2. Multimodal input. image_url becomes a real reference image input for this turn.
curl https://your-domain.example/v1/chat/completions \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-5.4-mini",
    "image_model": "gpt-image-2",
    "messages": [
      {
        "role": "user",
        "content": [
          { "type": "text", "text": "Use this product photo to create an ecommerce hero image" },
          { "type": "image_url", "image_url": { "url": "https://example.com/product.png" } }
        ]
      }
    ],
    "size": "1024x1024",
    "response_format": "url"
  }'

# 3. Streaming. Text uses chat.completion.chunk; partial images use a GPT2IMAGE extension event.
curl -N https://your-domain.example/v1/chat/completions \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Accept: text/event-stream" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-5.4",
    "messages": [
      { "role": "user", "content": "Create a futuristic city concept image" }
    ],
    "size": "1024x1024",
    "stream": true
  }'`,
          responseExample: `{
  "id": "chatcmpl_...",
  "object": "chat.completion",
  "created": 1713833628,
  "model": "gpt-5.4",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Image generated.\\n\\n![generated image 1](https://your-domain.example/api/storage/generations/...)",
        "images": [
          {
            "url": "https://your-domain.example/api/storage/generations/...",
            "revised_prompt": "...",
            "generation_id": "gen_..."
          }
        ]
      },
      "finish_reason": "stop"
    }
  ],
  "images": [
    {
      "url": "https://your-domain.example/api/storage/generations/...",
      "generation_id": "gen_..."
    }
  ],
  "generation_id": "gen_...",
  "generationId": "gen_...",
  "credits_consumed": 2.31,
  "usage": null
}

# stream=true SSE sample
data: {"id":"chatcmpl_...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Generating..."},"finish_reason":null}]}

event: chat.completion.partial_image
data: {"type":"chat.completion.partial_image","index":0,"partial_image_index":0,"url":"https://your-domain.example/api/storage/generations/..."}

data: {"id":"chatcmpl_...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"generation_id":"gen_...","credits_consumed":2.31}
`,
          fields: [
            {
              name: "messages",
              requirement: "Required",
              description:
                "OpenAI Chat Completions messages. The final user text becomes this turn's prompt; previous user/assistant messages become page Chat history.",
            },
            {
              name: "messages[].content[].image_url",
              requirement: "Optional",
              description:
                "Supports public http(s) image URLs or data:image URLs. Images in the final user message become real reference image inputs.",
            },
            {
              name: "model",
              requirement: "Optional",
              description:
                "GPT chat model. Web/Codex/Responses backends handle support according to their capabilities.",
            },
            {
              name: "n",
              requirement: "Optional",
              description:
                "Number of choices. Each choice creates one Chat image task and is billed independently.",
            },
            {
              name: "size / quality / moderation",
              requirement: "Optional",
              description: "Same runtime image parameters as the image APIs.",
            },
            {
              name: "stream",
              requirement: "Optional",
              description: "Returns text/event-stream when true.",
            },
            {
              name: "response_format",
              requirement: "Optional",
              custom: true,
              description:
                "GPT2IMAGE extension: url or b64_json. Defaults to url to avoid oversized Chat Completions payloads.",
            },
            {
              name: "image_model / imageModel",
              requirement: "Optional",
              custom: true,
              description:
                "GPT2IMAGE extension. Image model, must be gpt-image-*; Web backends do not map it to a separate Web image model.",
            },
            {
              name: "promptOptimization / prompt_optimization",
              requirement: "Optional",
              custom: true,
              description: "Controls GPT2IMAGE prompt optimization.",
            },
            {
              name: "promptRepair / prompt_repair",
              requirement: "Optional",
              custom: true,
              description:
                "GPT2IMAGE extension: safety prompt-repair retry toggle. When false, a moderation failure returns the real error directly instead of rewriting the prompt and retrying. Same meaning as /v1/images/generations.",
            },
            {
              name: "background",
              requirement: "Optional",
              description:
                "transparent, opaque, or auto. Same meaning as /v1/images/generations; applies to chat mode, without agent layering.",
            },
            {
              name: "transparent_matte",
              requirement: "Optional",
              custom: true,
              description:
                "Defaults to false. Only takes effect when background=transparent and explicitly set to true: if the selected backend rejects transparent with a 400, the request is regenerated opaque and matted server-side (ISNet) into a transparent PNG; not effective in the agent layered mode. See /v1/images/generations.",
            },
            {
              name: "thinking / reasoning.effort",
              requirement: "Optional",
              custom: true,
              description:
                "minimal, none, low, medium, high, xhigh. Mainly applies to Codex/Responses backends.",
            },
            {
              name: "mixWebFirst / mix_web_first",
              requirement: "Optional",
              custom: true,
              description:
                "GPT2IMAGE extension. In mixed groups, sizes inside the Web-first pixel range try Web first and fall back to Codex/Responses. The range is configured by IMAGE_FORCE_WEB_MIN_PIXELS / IMAGE_FORCE_WEB_MAX_PIXELS and defaults to 0.66MP-2MP.",
            },
            {
              name: "requiresResponsesBackend / requires_responses_backend",
              requirement: "Optional",
              custom: true,
              description:
                "GPT2IMAGE extension. Forces this Chat request to Codex/Responses capability instead of Web.",
            },
          ],
          responses: [
            {
              name: "choices[].message.content",
              description:
                "OpenAI-style assistant text. URL image results are appended as Markdown image links.",
            },
            {
              name: "choices[].message.images / images",
              description:
                "GPT2IMAGE extension. Structured image results with url or b64_json, generation_id, and revised_prompt.",
              custom: true,
            },
            {
              name: "generation_id / generationId / credits_consumed",
              description:
                "GPT2IMAGE extension. Generation record ID and billed credits after Chat round and image output settlement.",
              custom: true,
            },
            {
              name: "SSE chat.completion.chunk",
              description: "OpenAI-style Chat Completions streaming chunk.",
            },
            {
              name: "SSE chat.completion.partial_image",
              description:
                "GPT2IMAGE extension. Streaming image preview emitted during generation.",
              custom: true,
            },
          ],
          notes: [
            "Upstream API configs have two independent switches: Images upstream controls whether /v1/images/generations and /v1/images/edits call upstream /images/* or are converted to /responses + the image_generation tool; Chat Completions upstream only controls whether /v1/chat/completions calls upstream /chat/completions or /responses.",
            "Selecting chat_completions makes GPT2IMAGE /v1/chat/completions call the selected upstream's /chat/completions. This is better for pure chat compatibility, but image output depends on the upstream implementation. Agent and /v1/responses are not affected.",
            "OpenAI official Chat Completions does not define a standard generated-image response field. GPT2IMAGE extends the Chat Completions shape with choices[].message.images, top-level images, and Markdown image links in content. For strict official image-generation semantics, use /v1/images/generations, /v1/images/edits, or /v1/responses.",
            "This endpoint uses page Chat non-Agent mode. It does not inject web_search or continue_generation and does not return Agent task cards.",
            "The request kind is chat, so routing can select Web accounts, Codex/Responses accounts, or external API backends that support /responses. User custom upstream APIs still keep highest priority when available.",
            "Billing matches page Chat: a base Chat round charge first, then actual completed image output credits, moderation credits, and group multipliers.",
          ],
        },
        {
          title: "Create image",
          method: "POST",
          path: "/v1/images/generations",
          contentType: "application/json",
          description:
            "Compatible with OpenAI Images generation. Requests become image_generation jobs in the shared generation path.",
          example: `# 1. Official Images-style request. b64_json is the default.
curl https://your-domain.example/v1/images/generations \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-image-2",
    "prompt": "A cute baby sea otter",
    "n": 1,
    "size": "1024x1024",
    "quality": "medium",
    "moderation": "auto",
    "background": "auto"
  }'

# 2. Return a URL and disable GPT2IMAGE prompt optimization.
curl https://your-domain.example/v1/images/generations \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-image-1.5",
    "prompt": "A cyberpunk city at night after rain, neon reflections",
    "n": 2,
    "size": "1024x1024",
    "quality": "high",
    "moderation": "low",
    "response_format": "url",
    "output_format": "webp",
    "output_compression": 85,
    "background": "transparent",
    "prompt_optimization": false
  }'

# 3. Codex/Responses backend-only parameters. Plain Images API backends may ignore them.
curl https://your-domain.example/v1/images/generations \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-image-2",
    "prompt": "Create a 16:9 product campaign poster",
    "size": "1536x864",
    "response_format": "url",
    "output_format": "jpeg",
    "output_compression": 90,
    "gptModel": "gpt-5.4",
    "thinking": "high",
    "promptOptimization": false
  }'

# 4. Prefer Web account scheduling for mixed groups within the configured pixel range. Failed or exhausted Web routing falls back to Codex/Responses.
curl https://your-domain.example/v1/images/generations \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-image-2",
    "prompt": "A 1:1 avatar poster",
    "size": "1024x1024",
    "response_format": "url",
    "web_first": true
  }'

# 5. Streaming response. Accept: text/event-stream also enables streaming.
curl -N https://your-domain.example/v1/images/generations \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Accept: text/event-stream" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-image-2",
    "prompt": "A transparent glass futuristic coffee cup",
    "size": "1024x1024",
    "response_format": "url",
    "stream": true
  }'

# 6. Async mode. You may also append ?async=true. callback_url is optional.
curl https://your-domain.example/v1/images/generations \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-image-1.5",
    "prompt": "A transparent-background product icon",
    "size": "1024x1024",
    "response_format": "url",
    "output_format": "png",
    "background": "transparent",
    "async": true,
    "callback_url": "https://your-server.example/callback"
  }'

# 7. GPT2IMAGE extensions: transparent background + ISNet matte fallback, with safety prompt-repair retry disabled.
curl https://your-domain.example/v1/images/generations \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-image-2",
    "prompt": "A transparent-background product icon",
    "size": "1024x1024",
    "response_format": "url",
    "output_format": "png",
    "background": "transparent",
    "transparent_matte": true,
    "prompt_repair": false
  }'`,
          responseExample: `{
  "created": 1713833628,
  "data": [
    {
      "url": "https://your-domain.example/api/storage/generations/...",
      "revised_prompt": "..."
    }
  ],
  "generation_id": "gen_...",
  "generationId": "gen_...",
  "credits_consumed": 1.31,
  "usage": null
}

# SSE when stream=true
event: image_generation.partial_image
data: {"type":"image_generation.partial_image","index":0,"partial_image_index":0,"url":"https://your-domain.example/api/storage/generations/..."}

event: image_generation.completed
data: {"type":"image_generation.completed","index":0,"generation_id":"...","generationId":"...","model":"gpt-image-2","size":"1024x1024","credits_consumed":1.31,"url":"https://your-domain.example/api/storage/generations/...","data":[{"url":"https://your-domain.example/api/storage/generations/...","revised_prompt":"..."}]}

# Immediate async=true response
{
  "id": "task_...",
  "object": "image.generation",
  "model": "gpt-image-2",
  "status": "processing",
  "created": 1713833628,
  "created_at": "2026-05-28T00:00:00.000Z",
  "generation_id": "gen_..."
}

# Poll task
curl https://your-domain.example/v1/images/task_... \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY"

# Completed task response or callback payload
{
  "id": "task_...",
  "object": "image",
  "model": "gpt-image-2",
  "status": "completed",
  "created": 1713833628,
  "created_at": "2026-05-28T00:00:00.000Z",
  "completed": 1713833700,
  "completed_at": "2026-05-28T00:01:12.000Z",
  "data": [{"url": "https://your-domain.example/api/storage/generations/..."}],
  "generation_id": "gen_...",
  "generationId": "gen_...",
  "credits_consumed": 1.31,
  "usage": null
}
`,
          fields: [
            {
              name: "prompt",
              requirement: "Required",
              description: "Image prompt, up to 32000 characters.",
            },
            {
              name: "model",
              requirement: "Optional",
              description:
                "Image model. GPT2IMAGE accepts gpt-image-* style image models here. It also accepts Adobe Firefly model ids (firefly-<family>-<resolution>-<ratio>, e.g. firefly-nano-banana-pro-2k-16x9, or just a family such as firefly-gpt-image-2), which route to the Adobe (Firefly) backend. family ∈ gpt-image-2, gpt-image-1.5, nano-banana, nano-banana2, nano-banana-pro; resolution ∈ 1k, 2k, 4k; ratio ∈ 1x1, 16x9, 9x16, 4x3, 3x4. Use /v1/responses for Responses chat models.",
            },
            {
              name: "force_firefly / forceFirefly",
              requirement: "Optional",
              custom: true,
              description:
                "GPT2IMAGE extension: when true, narrows candidates to the Adobe (Firefly) backend only, using standard parameters (your prompt/size/quality/model). When no firefly-* model is given, the default family is gpt-image-2; size maps to the firefly ratio/resolution (longest edge ≤1024→1k, ≤2048→2k, else 4k); quality low/medium/high → detailLevel 1/3/5, auto → backend gpt_image_quality; unsupported parameters (output_format, background, thinking, moderation level, output_compression) are silently ignored. Full mapping table and worked example: docs/adobe-firefly-compat.md.",
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
              name: "output_format",
              requirement: "Optional",
              description:
                "png, jpeg, or webp. Controls the actual output image format; upstream support may vary.",
            },
            {
              name: "output_compression",
              requirement: "Optional",
              description:
                "0 to 100, only meaningful for jpeg/webp. Higher values mean higher quality.",
            },
            {
              name: "background",
              requirement: "Optional",
              description:
                "transparent, opaque, or auto. Transparent backgrounds require support from the selected upstream model and usually require png or webp output. Unsupported models may return a 400 error such as “Transparent background is not supported for this model”. To still get a transparent result on an unsupported backend, also pass transparent_matte=true (see next field). Use auto or opaque when support is unknown.",
            },
            {
              name: "transparent_matte",
              requirement: "Optional",
              custom: true,
              description:
                "Defaults to false. Only takes effect when background=transparent and explicitly set to true: if the selected backend rejects transparent with a 400, the request is regenerated opaque and matted server-side (ISNet) into a transparent PNG. When off, transparent is passed through and an unsupported backend returns the real 400 error. Applies to single image generation/edit/chat only, not the agent layered mode.",
            },
            {
              name: "stream",
              requirement: "Optional",
              description: "true returns text/event-stream.",
            },
            {
              name: "async",
              requirement: "Optional",
              description:
                "true returns a task_... immediately and runs generation in the background. You may also use ?async=true. Cannot be combined with stream.",
            },
            {
              name: "callback_url",
              requirement: "Optional",
              description:
                "Posts the full task result when the async task completes or fails. The callback request includes X-Tokens-Callback: true. Only public http/https URLs are allowed.",
            },
            {
              name: "promptOptimization / prompt_optimization",
              requirement: "Optional",
              custom: true,
              description:
                "Controls whether GPT2IMAGE may further optimize prompt. If prompt is already the final optimized prompt, pass false.",
            },
            {
              name: "promptRepair / prompt_repair",
              requirement: "Optional",
              custom: true,
              description:
                "Safety prompt-repair retry toggle (issue #24). Defaults to the platform setting (usually enabled): when local moderation or an upstream safety refusal yields no image, the system rewrites the prompt through Responses and re-moderates and retries inside the same task. When explicitly false, this automatic rewrite-retry is disabled and a moderation failure returns the real error without rewriting the prompt. See \"Safety Prompt Repair Retry\" below.",
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
            {
              name: "web_first / webFirst / force_web / forceWeb",
              requirement: "Optional",
              custom: true,
              description:
                "Only supported by image endpoints. Prefer web_first / webFirst; force_web / forceWeb are compatibility aliases with the same Web-first preference semantics, not hard Web-only routing. Ignored when a user custom upstream API takes priority; after routing enters the platform pool, mixed backend groups prefer Web accounts when the requested total pixels are between IMAGE_FORCE_WEB_MIN_PIXELS and IMAGE_FORCE_WEB_MAX_PIXELS. If Web is unavailable, fails, or is exhausted, routing falls back to Codex/Responses. The default range is 0.66MP-2MP; non-mixed or out-of-range requests ignore this field.",
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
              description:
                "Returned when the upstream provides a revised prompt.",
            },
            {
              name: "generation_id / generationId / credits_consumed",
              description:
                "GPT2IMAGE extension. Non-stream success responses return the generation record ID and GPT2IMAGE-billed credits at the top level; batch requests return generation_ids / generationIds and total credits_consumed. This is 0 when a user custom upstream API wins.",
              custom: true,
            },
            {
              name: "SSE image_generation.partial_image",
              description:
                "Only returned with stream=true or Accept: text/event-stream. Represents one partial image.",
            },
            {
              name: "SSE image_generation.completed",
              description:
                "Only returned in streaming mode. Indicates one image is complete; event data includes generation_id, credits_consumed, model, size, and the final image.",
            },
          ],
          notes: [
            "This endpoint does not call page /api/images/generate; it directly enters the shared service layer.",
            "When routed to a Responses account, the image request is converted into a Responses image_generation tool request.",
            "n/count is one HTTP request. A 10-image request creates 10 generation records and bills 10 outputs. GPT2IMAGE runs batch items with bounded parallelism based on the plan image-generation concurrency; items beyond that concurrency wait inside the same batch.",
            "Concurrency and queueing: the runtime uses one in-process image queue. Tasks are sorted by plan queue priority, then FIFO within the same priority, and are started only when both the global concurrency and per-user image-generation concurrency allow it. Global concurrency is configurable in Admin System Settings > Models > Global image generation concurrency; IMAGE_GENERATION_GLOBAL_CONCURRENCY is only the fallback default. Batch requests add a request-local bounded runner, so only the allowed number of batch items are started and the rest wait inside that batch instead of flooding the shared queue.",
            "Waiting in a queue does not create a generation record or charge image credits. If the shared queue wait exceeds IMAGE_GENERATION_QUEUE_TIMEOUT_MS, the API returns a 429-style error. The 20-minute runtime timeout starts only after an individual image task begins execution, and timeout settlement follows the failed-generation credit rules.",
            "Web backends cannot strictly control output dimensions or output format. GPT2IMAGE labels stored files by the detected image header and MIME.",
            "background=transparent is not universally supported. OpenAI's official docs currently list gpt-image-1.5, gpt-image-1, and gpt-image-1-mini as supporting transparent backgrounds, and png or webp output is usually required. Unsupported upstream models may reject the request with HTTP 400 instead of silently falling back.",
            "async tasks are process-local and expire after 30 minutes. A restart or multi-instance switch can make unfinished tasks unavailable for polling; already-sent callbacks are unaffected.",
            "If the actual generated dimensions differ from the requested size, GPT2IMAGE records and bills using the detected actual size.",
            "The official Images API may return usage. GPT2IMAGE usually returns usage: null, but GPT2IMAGE-billed credits are returned through top-level credits_consumed, error payloads, or streaming completion events. When a user custom upstream API wins, GPT2IMAGE does not charge credits.",
          ],
        },
        {
          title: "Create image edit",
          method: "POST",
          path: "/v1/images/edits",
          contentType: "multipart/form-data or application/json",
          description:
            "Compatible with OpenAI Images edit. multipart uploads files; JSON can reference public image URLs.",
          example: `# 1. multipart upload reference image.
curl https://your-domain.example/v1/images/edits \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -F model="gpt-image-2" \\
  -F prompt="Turn the reference image into a cinematic poster" \\
  -F n="1" \\
  -F size="1024x1024" \\
  -F quality="high" \\
  -F moderation="auto" \\
  -F response_format="url" \\
  -F output_format="jpeg" \\
  -F output_compression="90" \\
  -F background="opaque" \\
  -F 'image[]=@/path/to/reference.png'

# 2. multipart multiple references + mask + Codex/Responses fields.
curl https://your-domain.example/v1/images/edits \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -F model="gpt-image-2" \\
  -F prompt="Only redraw the masked area and keep the face unchanged" \\
  -F size="1536x1024" \\
  -F quality="medium" \\
  -F response_format="b64_json" \\
  -F promptOptimization="false" \\
  -F gpt_model="gpt-5.4" \\
  -F thinking="medium" \\
  -F 'image[]=@/path/to/person.png' \\
  -F 'image_2=@/path/to/style.png' \\
  -F mask="@/path/to/mask.png"

# 3. JSON image URLs. Prefer images; image_url/image_urls are shortcuts.
curl https://your-domain.example/v1/images/edits \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-image-2",
    "prompt": "Turn the reference into a clean ecommerce hero image",
    "images": [
      "https://example.com/reference.png",
      { "image_url": "https://example.com/detail.webp" }
    ],
    "image_url": "https://example.com/single-reference.png",
    "image_urls": ["https://example.com/extra.jpg"],
    "mask_url": "https://example.com/mask.png",
    "mask_image_url": "https://example.com/mask-alt.png",
    "n": 1,
    "size": "1024x1024",
    "quality": "auto",
    "moderation": "low",
    "response_format": "url",
    "output_format": "webp",
    "output_compression": 80,
    "background": "transparent",
    "prompt_optimization": false,
    "gptModel": "gpt-5.4-mini",
    "thinking": "low"
  }'

# 4. Prefer Web account scheduling for mixed groups within the configured pixel range. Failed or exhausted Web routing falls back to Codex/Responses.
curl https://your-domain.example/v1/images/edits \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-image-2",
    "prompt": "Keep the person and make it look like a cinematic still",
    "images": ["https://example.com/reference.png"],
    "size": "1024x1024",
    "response_format": "url",
    "web_first": true
  }'

# 5. Streaming image edit.
curl -N https://your-domain.example/v1/images/edits \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Accept: text/event-stream" \\
  -F model="gpt-image-2" \\
  -F prompt="Keep the composition and convert it to watercolor illustration" \\
  -F size="1024x1024" \\
  -F response_format="url" \\
  -F stream="true" \\
  -F 'image=@/path/to/reference.png'

# 6. Async image edit. You may also append ?async=true. callback_url is optional.
curl https://your-domain.example/v1/images/edits \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -F model="gpt-image-1.5" \\
  -F prompt="Remove the background and output a transparent PNG" \\
  -F size="1024x1024" \\
  -F response_format="url" \\
  -F output_format="png" \\
  -F background="transparent" \\
  -F async="true" \\
  -F callback_url="https://your-server.example/callback" \\
  -F 'image=@/path/to/reference.png'`,
          responseExample: `{
  "created": 1713833628,
  "data": [
    {
      "url": "https://your-domain.example/api/storage/generations/...",
      "revised_prompt": "..."
    }
  ],
  "generation_id": "gen_...",
  "generationId": "gen_...",
  "credits_consumed": 1.31,
  "usage": null
}

# SSE when stream=true
event: image_edit.partial_image
data: {"type":"image_edit.partial_image","index":0,"partial_image_index":0,"url":"https://your-domain.example/api/storage/generations/..."}

event: image_edit.completed
data: {"type":"image_edit.completed","index":0,"generation_id":"...","generationId":"...","model":"gpt-image-2","size":"1024x1024","credits_consumed":1.31,"url":"https://your-domain.example/api/storage/generations/...","data":[{"url":"https://your-domain.example/api/storage/generations/...","revised_prompt":"..."}]}

# async=true task polling and callback shape match /v1/images/generations.
`,
          fields: [
            {
              name: "prompt",
              requirement: "Required",
              description: "Edit prompt, up to 32000 characters.",
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
              description:
                "Image model; a gpt-image-* style image model, or an Adobe Firefly model id (firefly-<family>-<resolution>-<ratio>, or just a family such as firefly-gpt-image-2) that routes to the Adobe (Firefly) backend. Same value range as /v1/images/generations.",
            },
            {
              name: "force_firefly / forceFirefly",
              requirement: "Optional",
              custom: true,
              description:
                "GPT2IMAGE extension: when true, narrows candidates to the Adobe (Firefly) backend only, using standard parameters. When no firefly-* model is given, the default family is gpt-image-2; size maps to the firefly ratio/resolution; quality low/medium/high → detailLevel 1/3/5; unsupported parameters are silently ignored. See /v1/images/generations and docs/adobe-firefly-compat.md.",
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
              name: "output_format",
              requirement: "Optional",
              description:
                "png, jpeg, or webp. Controls the actual output image format; upstream support may vary.",
            },
            {
              name: "output_compression",
              requirement: "Optional",
              description:
                "0 to 100, only meaningful for jpeg/webp. Higher values mean higher quality.",
            },
            {
              name: "background",
              requirement: "Optional",
              description:
                "transparent, opaque, or auto. Transparent backgrounds require support from the selected upstream model and usually require png or webp output. Unsupported models may return a 400 error such as “Transparent background is not supported for this model”. To still get a transparent result on an unsupported backend, also pass transparent_matte=true (see next field). Use auto or opaque when support is unknown.",
            },
            {
              name: "transparent_matte",
              requirement: "Optional",
              custom: true,
              description:
                "Defaults to false. Only takes effect when background=transparent and explicitly set to true: if the selected backend rejects transparent with a 400, the request is regenerated opaque and matted server-side (ISNet) into a transparent PNG. When off, transparent is passed through and an unsupported backend returns the real 400 error. Applies to single image generation/edit/chat only, not the agent layered mode.",
            },
            {
              name: "stream",
              requirement: "Optional",
              description: "true returns text/event-stream.",
            },
            {
              name: "async",
              requirement: "Optional",
              description:
                "true returns a task_... immediately and runs the edit in the background. You may also use ?async=true. Cannot be combined with stream.",
            },
            {
              name: "callback_url",
              requirement: "Optional",
              description:
                "Posts the full task result when the async task completes or fails. The callback request includes X-Tokens-Callback: true. Only public http/https URLs are allowed.",
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
              name: "promptRepair / prompt_repair",
              requirement: "Optional",
              custom: true,
              description:
                "Safety prompt-repair retry toggle (issue #24). Defaults to the platform setting (usually enabled): when local moderation or an upstream safety refusal yields no image, the system rewrites the prompt through Responses and re-moderates and retries inside the same task. When explicitly false, this automatic rewrite-retry is disabled and a moderation failure returns the real error without rewriting the prompt. See \"Safety Prompt Repair Retry\" below.",
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
            {
              name: "web_first / webFirst / force_web / forceWeb",
              requirement: "Optional",
              custom: true,
              description:
                "Only supported by image endpoints. Prefer web_first / webFirst; force_web / forceWeb are compatibility aliases with the same Web-first preference semantics, not hard Web-only routing. Ignored when a user custom upstream API takes priority; after routing enters the platform pool, mixed backend groups prefer Web accounts when the requested total pixels are between IMAGE_FORCE_WEB_MIN_PIXELS and IMAGE_FORCE_WEB_MAX_PIXELS. If Web is unavailable, fails, or is exhausted, routing falls back to Codex/Responses. The default range is 0.66MP-2MP; non-mixed or out-of-range requests ignore this field.",
            },
          ],
          responses: [
            {
              name: "created / data[]",
              description: "Same as /v1/images/generations.",
            },
            {
              name: "generation_id / generationId / credits_consumed",
              description:
                "GPT2IMAGE extension. Non-stream success responses return the generation record ID and GPT2IMAGE-billed credits at the top level; batch requests return generation_ids / generationIds and total credits_consumed. This is 0 when a user custom upstream API wins.",
              custom: true,
            },
            {
              name: "SSE image_edit.partial_image",
              description:
                "Only returned with stream=true or Accept: text/event-stream. Represents one partial edited image.",
            },
            {
              name: "SSE image_edit.completed",
              description:
                "Only returned in streaming mode. Indicates one edited image is complete; event data includes generation_id, credits_consumed, model, size, and the final image.",
            },
          ],
          notes: [
            "URL images are downloaded server-side and checked for public reachability, type, and size.",
            "Private networks, localhost, metadata/internal hosts, and URLs with credentials are rejected.",
            "Official JSON file_id image references are not implemented. Use public image_url or multipart uploads.",
            "background=transparent is not universally supported. OpenAI's official docs currently list gpt-image-1.5, gpt-image-1, and gpt-image-1-mini as supporting transparent backgrounds, and png or webp output is usually required. Unsupported upstream models may reject the request with HTTP 400 instead of silently falling back.",
            "async tasks are process-local and expire after 30 minutes. A restart or multi-instance switch can make unfinished tasks unavailable for polling; already-sent callbacks are unaffected.",
          ],
        },
        {
          title: "Create video",
          method: "POST",
          path: "/v1/videos/generations",
          contentType: "application/json",
          description:
            "GPT2IMAGE extension: Adobe Firefly video generation. It always routes to the Adobe (Firefly) backend, is a long-running job (the connection is held with keep-alive until the video is ready), and returns an OpenAI Images-style shape where data[].url is the produced video URL. Auth matches other v1 endpoints (external API key).",
          example: `# 1. Text-to-video. model is a full Firefly video id.
curl https://your-domain.example/v1/videos/generations \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "firefly-veo31-8s-16x9-1080p",
    "prompt": "A corgi running on the beach, cinematic camera, golden hour",
    "negative_prompt": "low resolution, blurry, watermark"
  }'

# 2. Image-to-video. image is an array of base64 data URLs (first frame / reference), up to 3.
curl https://your-domain.example/v1/videos/generations \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "firefly-kling3-5s-9x16",
    "prompt": "Make the person slowly look up and smile",
    "image": ["data:image/png;base64,iVBORw0KGgo..."]
  }'`,
          responseExample: `{
  "created": 1713833628,
  "model": "firefly-veo31-8s-16x9-1080p",
  "data": [
    { "url": "https://your-domain.example/api/storage/generations/..." }
  ],
  "credits_consumed": 240
}`,
          fields: [
            {
              name: "prompt",
              requirement: "Required",
              description: "Video prompt, up to 32000 characters.",
            },
            {
              name: "model",
              requirement: "Required",
              description:
                "Firefly video model id: firefly-<family>-<dur>s-<ratio>[-<res>] (e.g. firefly-veo31-8s-16x9-1080p). family ∈ sora2, sora2-pro, veo31, veo31-ref, veo31-fast, kling-o3, kling3. Invalid or unknown ids return a parameter error. See /v1/models for available combinations.",
            },
            {
              name: "negative_prompt / negativePrompt",
              requirement: "Optional",
              description: "Negative prompt, up to 8000 characters.",
            },
            {
              name: "image",
              requirement: "Optional",
              description:
                "Image-to-video input (first frame / reference). An array of base64 image data URLs, up to 3.",
            },
          ],
          responses: [
            {
              name: "created",
              description: "Unix timestamp in seconds.",
            },
            {
              name: "model",
              description: "The Firefly video model id used.",
            },
            {
              name: "data[].url",
              description: "GPT2IMAGE storage URL of the produced video.",
            },
            {
              name: "credits_consumed",
              description: "Credits billed for this request.",
              custom: true,
            },
          ],
          notes: [
            "This endpoint is a GPT2IMAGE extension, not an official OpenAI endpoint. /api/v1/videos/generations is an alias.",
            "Video generation is long-running. GPT2IMAGE holds the connection with keep-alive until the video is ready or fails, so set a generous client read timeout.",
            "Billing = base credits per second (default 30) × duration in seconds × model-family multiplier, rounded up to two decimals. The duration comes from <dur> in the model id.",
            "Requires externalApi.images.generate by default (Starter or higher); admins can change it in the Plan Capability Matrix.",
          ],
        },
        {
          title: "Create Agent image run",
          method: "POST",
          path: "/v1/agents/images",
          contentType: "application/json or multipart/form-data",
          description:
            "GPT2IMAGE extension that exposes the page Agent run style to external API clients. It uses Codex/Responses scheduling, web search, tool loop continuation, attachment context, and multi-round image iteration.",
          example: `# 1. JSON Agent image run. Ultra is required by default; admins can change externalApi.agent.
curl https://your-domain.example/v1/agents/images \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-5.4",
    "image_model": "gpt-image-2",
    "prompt": "Search public information about Zhejiang Shuangyuan Technology and iterate an enterprise poster",
    "size": "1536x1024",
    "quality": "high",
    "thinking": "medium",
    "agent_max_rounds": 3,
    "agent_force_max_rounds": false,
    "response_format": "url"
  }'

# 2. With reference image URLs. images / image_url / image_urls are merged and deduplicated.
curl https://your-domain.example/v1/agents/images \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-5.4-mini",
    "image_model": "gpt-image-2",
    "prompt": "Analyze this product photo and create an ecommerce poster",
    "images": ["https://example.com/product.png"],
    "size": "1024x1024",
    "agent_max_rounds": 2
  }'

# 3. multipart reference image plus PDF/text attachments.
curl https://your-domain.example/v1/agents/images \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -F model="gpt-5.4" \\
  -F image_model="gpt-image-2" \\
  -F prompt="Read the attachment and create a trade-show poster" \\
  -F size="1536x1024" \\
  -F response_format="url" \\
  -F agent_max_rounds="3" \\
  -F 'image[]=@/path/to/reference.png' \\
  -F 'file=@/path/to/company-profile.pdf'

# 4. Streaming Agent events.
curl -N https://your-domain.example/v1/agents/images \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Accept: text/event-stream" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-5.4",
    "image_model": "gpt-image-2",
    "prompt": "Search first, then iterate a technology-blue enterprise poster",
    "size": "1536x1024",
    "stream": true,
    "agent_max_rounds": 2,
    "agent_force_max_rounds": true
  }'`,
          responseExample: `{
  "object": "agent.image_run",
  "created": 1713833628,
  "generation_id": "gen_...",
  "generationId": "gen_...",
  "model": "gpt-5.4",
  "size": "1536x1024",
  "response_text": "Research and poster generation completed.",
  "agent_round_count": 2,
  "credits_consumed": 8.42,
  "data": [
    {
      "url": "https://your-domain.example/api/storage/generations/...",
      "revised_prompt": "...",
      "output_role": "agent_draft"
    },
    {
      "url": "https://your-domain.example/api/storage/generations/...",
      "revised_prompt": "...",
      "output_role": "final"
    }
  ],
  "agent_events": [],
  "usage": null
}

# SSE when stream=true
event: agent.event
data: {"type":"agent.event","event":{"kind":"web_search","status":"completed","title":"Web search completed","detail":"Zhejiang Shuangyuan Technology official site"}}

event: agent.partial_image
data: {"type":"agent.partial_image","partial_image_index":0,"url":"https://your-domain.example/api/storage/generations/..."}

event: agent.completed
data: {"type":"agent.completed","generation_id":"...","generationId":"...","agent_round_count":2,"credits_consumed":8.42,"data":[{"url":"https://your-domain.example/api/storage/generations/...","output_role":"final"}]}
`,
          fields: [
            {
              name: "prompt",
              requirement: "Required",
              description: "Current Agent task, up to 32000 characters.",
            },
            {
              name: "model / gptModel / gpt_model",
              requirement: "Optional",
              description:
                "Top-level GPT/Responses model. If model is gpt-image-*, GPT2IMAGE treats it as image_model for compatibility.",
            },
            {
              name: "image_model / imageModel",
              requirement: "Optional",
              description:
                "Image model used by the image_generation tool, usually gpt-image-*.",
            },
            {
              name: "images / image_url / image_urls",
              requirement: "Optional for JSON",
              description:
                "Public reference image URLs. The server downloads and validates public reachability, type, and size.",
            },
            {
              name: "image / image[] / image_*",
              requirement: "Optional for multipart",
              description:
                "Reference image files. Images plus attachments are limited by maxChatImages.",
            },
            {
              name: "file / file[] / attachment",
              requirement: "Optional for multipart",
              description:
                "Text, code, CSV, JSON, Markdown, XML, YAML, log, or PDF attachments. Text files become context; PDFs become Responses file inputs.",
            },
            {
              name: "history",
              requirement: "Optional",
              description:
                "Previous conversation array such as [{ role, text, imageUrls, variants }] for continuing an external Agent conversation.",
            },
            {
              name: "agent_max_rounds",
              requirement: "Optional",
              custom: true,
              description: "1 to 8. Caps automatic Agent iteration rounds.",
            },
            {
              name: "agent_force_max_rounds",
              requirement: "Optional",
              custom: true,
              description:
                "When true, runs exactly agent_max_rounds. When false, the model may stop through continue_generation.",
            },
            {
              name: "n / count",
              requirement: "Optional",
              description:
                "The Agent API runs one task at a time; when supplied this must be 1. Use concurrent requests for multiple tasks.",
            },
            {
              name: "size / quality / moderation / output_format / output_compression",
              requirement: "Optional",
              description:
                "Same as image endpoints; used as runtime image_generation parameters inside Agent.",
            },
            {
              name: "background",
              requirement: "Optional",
              description:
                "transparent, opaque, or auto. Same meaning as /v1/images/generations.",
            },
            {
              name: "transparent_matte",
              requirement: "Optional",
              custom: true,
              description:
                "Defaults to false. Only when background=transparent and set to true: if the selected backend rejects transparent with a 400, the request is regenerated opaque and matted server-side (ISNet) into a transparent PNG; not effective in the agent layered mode. See /v1/images/generations.",
            },
            {
              name: "promptRepair / prompt_repair",
              requirement: "Optional",
              custom: true,
              description:
                "GPT2IMAGE extension: safety prompt-repair retry toggle. When false, a moderation failure returns the real error directly instead of rewriting the prompt and retrying.",
            },
            {
              name: "thinking",
              requirement: "Optional",
              custom: true,
              description: "minimal, none, low, medium, high, or xhigh.",
            },
            {
              name: "response_format",
              requirement: "Optional",
              description:
                "url or b64_json. Agent defaults to url to avoid oversized multi-round responses.",
            },
            {
              name: "stream",
              requirement: "Optional",
              description:
                "true or Accept: text/event-stream returns SSE and also requires externalApi.streaming.",
            },
          ],
          responses: [
            {
              name: "object / generation_id / model / size",
              description:
                "Agent run object, generation record, model, and size.",
            },
            {
              name: "data[]",
              description:
                "Images produced by this Agent run. output_role may be agent_draft or final; the final item is the default deliverable.",
            },
            {
              name: "agent_events[]",
              description:
                "Structured task events such as web search, image generation, and continue/stop decisions.",
            },
            {
              name: "credits_consumed / agent_round_count",
              custom: true,
              description:
                "GPT2IMAGE-billed credits and Agent rounds. Agent always requires Codex/Responses capability and does not use user custom API. Billing = Agent base round credits + final image output credits + moderation credits, with backend group multipliers applied.",
            },
            {
              name: "SSE agent.event / agent.partial_image / agent.completed",
              description:
                "Streaming task events, streaming previews, and final completion.",
            },
          ],
          notes: [
            "This endpoint is a GPT2IMAGE extension, not an official OpenAI endpoint. /api/v1/agents/images is an alias.",
            "Ultra is required by default; admins can change externalApi.agent in the Plan Capability Matrix.",
            "It forces requiresResponsesBackend and never schedules Web accounts; it can use Codex/Responses accounts or external API backends that support /responses.",
            "It does not call page /api/images/chat; it shares the runImageGenerationForUser service layer with page Agent.",
            "generate_image_batch concurrent tooling is intentionally not exposed yet to preserve linear iteration and Responses native state.",
          ],
        },
        {
          title: "Create response",
          method: "POST",
          path: "/v1/responses",
          contentType: "application/json",
          description:
            "A GPT2IMAGE image-generation adapter based on the OpenAI Responses API. It routes as responses and selects Codex/Responses groups or external /responses API backends.",
          example: `# 1. Minimal Responses image request. Requires Pro plan.
curl https://your-domain.example/v1/responses \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-5.4",
    "input": "Generate a 1:1 futuristic product render",
    "size": "1024x1024",
    "quality": "high",
    "moderation": "auto"
  }'

# 2. Explicit image_generation tool with image model.
curl https://your-domain.example/v1/responses \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-5.4",
    "input": "Generate a landscape technology product key visual",
    "tools": [{ "type": "image_generation", "model": "gpt-image-2" }],
    "size": "1536x864",
    "quality": "medium",
    "reasoning": { "effort": "low" },
    "store": true
  }'

# 3. Responses input with a reference image.
curl https://your-domain.example/v1/responses \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-5.4-mini",
    "input": [
      {
        "role": "user",
        "content": [
          { "type": "input_text", "text": "Use this image as reference and make a winter poster" },
          { "type": "input_image", "image_url": "https://example.com/reference.png" }
        ]
      }
    ],
    "tools": [{ "type": "image_generation", "model": "gpt-image-2" }],
    "size": "1024x1024",
    "output_format": "webp",
    "output_compression": 85,
    "moderation": "low"
  }'

# 4. Continue a previous response and stream the result.
curl -N https://your-domain.example/v1/responses \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-5.4",
    "previous_response_id": "resp_previous_id",
    "input": "Add a moon based on the previous image",
    "tools": [{ "type": "image_generation", "model": "gpt-image-2" }],
    "size": "1024x1024",
    "reasoning": { "effort": "minimal" },
    "stream": true
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
}

# SSE when stream=true
event: response.output_item.done
data: {"type":"response.output_item.done","item":{"id":"ig_...","type":"image_generation_call","status":"completed","result":"..."}}

event: response.completed
data: {"type":"response.completed","response":{"id":"resp_...","object":"response","created_at":1713833628,"status":"completed","model":"gpt-5.4","output":[{"id":"ig_...","type":"image_generation_call","status":"completed","result":"..."}],"usage":null,"metadata":{"generation_id":"...","credits_consumed":1.31,"size":"1024x1024"}}}
`,
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
                'If provided, must include { type: "image_generation" }. If omitted, GPT2IMAGE adds image_generation automatically. Put the image model in the image_generation tool\'s model field.',
            },
            {
              name: "tool_choice",
              requirement: "Optional",
              description:
                "Accepted for compatibility. Do not force it in chat or multi-tool runs unless needed, because it can prevent the model from using web search, code interpreter, or image generation together.",
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
              description:
                "Supports minimal, none, low, medium, high, and xhigh. Actual support depends on the selected backend.",
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
              name: "output_format",
              requirement: "Optional",
              custom: true,
              description:
                "Convenience field used as the run-time output_format when the image_generation tool does not provide one. You may also put it directly in the image_generation tool.",
            },
            {
              name: "output_compression",
              requirement: "Optional",
              custom: true,
              description:
                "Convenience field used as the run-time output_compression when the image_generation tool does not provide one.",
            },
            {
              name: "background",
              requirement: "Optional",
              description:
                "transparent, opaque, or auto, used as this run's background. See /v1/images/generations.",
            },
            {
              name: "transparent_matte",
              requirement: "Optional",
              custom: true,
              description:
                "Defaults to false. Only when background=transparent and set to true: if the selected backend rejects transparent with a 400, the request is regenerated opaque and matted server-side (ISNet) into a transparent PNG; not effective in the agent layered mode. See /v1/images/generations.",
            },
            {
              name: "promptRepair / prompt_repair",
              requirement: "Optional",
              custom: true,
              description:
                "Convenience field: safety prompt-repair retry toggle. When false, a moderation failure returns the real error directly instead of rewriting the prompt and retrying.",
            },
          ],
          responses: [
            {
              name: "id / object / created_at / status / model / output",
              description:
                "Compatible with the basic Responses response object.",
            },
            {
              name: "output[].type = image_generation_call",
              description: "Image result is returned in result as b64_json.",
            },
            {
              name: "output[].type = message",
              description:
                "Upstream text, when present, is returned as output_text.",
            },
            {
              name: "metadata.generation_id / credits_consumed / size",
              description:
                "GPT2IMAGE generation record, billed credits, and size metadata. credits_consumed is 0 when a user custom upstream API wins.",
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
            "This is not Chat Completions. Use /v1/chat/completions for normal chat-to-image, and this endpoint for Responses tool semantics.",
            "input_image supports image_url/data URLs. file_id/file inputs are not used as references today.",
            "If tools is provided without image_generation, GPT2IMAGE returns an error to avoid text-only responses.",
            "Page Chat mode uses normal multimodal chat/image semantics. Agent mode provides image_generation, web_search, and the linear continuation tool continue_generation by default without forcing tool_choice.",
            "Page Chat/Agent can read uploaded local text/code files as request context. Prompted server filesystem paths are not read.",
            "Page Chat/Agent base round credits are configured per plan in the admin Plan Capability Matrix. Defaults are 1 credit per Chat round and 3 credits per Agent round; completed images are additionally billed by detected output size and output count.",
            "Agent feeds the previous round's text, tool outputs, and generated draft images into the next round so the model can decide whether to refine again. The cap is IMAGE_AGENT_MAX_ROUNDS, default 3. Concurrent batch tools such as generate_image_batch are not wired into runtime yet because they need a native Responses state design first.",
            "Multiple Agent image_generation_call outputs are shown as automatic iteration variants, with the last image selected by default.",
          ],
        },
      ],
    },
    web: {
      title: "Web Accounts",
      description:
        "Uses ChatGPT Web image generation. It can reuse Web account quota, but it is not a strictly parameterized Images/Responses API.",
      valid: [
        "**Resolution is not strictly controllable; size is only a hint/record value and output may differ.**",
        "**4K output is not guaranteed; high-resolution output depends on current ChatGPT Web capability and account state.**",
        "The main GPT conversation model and Web thinking level can be controlled; image model is not mapped to a separate Web image model.",
        "When prompt optimization is off, GPT2IMAGE sends the original prompt and forces Web thinking to instant to reduce platform-side rewriting.",
      ],
      invalid: [
        "External /v1/responses is adapted into the shared chat generation path, but its scheduling type remains responses; it only selects Codex/Responses groups or external Responses API backends, not Web account pools.",
        "For external /v1/responses, an empty model uses the backend default; explicit models must be listed by /v1/models or GPT2IMAGE rejects them.",
        "Cannot guarantee prompt text is never interpreted, expanded, or revised by ChatGPT Web upstream.",
      ],
    },
    codex: {
      title: "Codex / Responses Accounts",
      description:
        "Uses Responses semantics and is the most parameterized system-account backend.",
      valid: [
        "GPT model is sent as the top-level Responses model.",
        "Image model is sent as the image_generation tool model.",
        "size, quality, moderation, reference images, and mask are assembled into the Responses tool request.",
        "Page Chat mode uses normal multimodal chat/image semantics. Page Agent mode provides image_generation, web_search, and continue_generation by default without forcing tool_choice, and can continue across linear automatic rounds so the model can search, read uploaded text-file context, generate drafts, and refine like Codex.",
        "Uploaded local text/code files in Chat/Agent are read as request context. Server filesystem paths written in prompts are not read.",
        "Supports external /v1/responses and can also handle converted /v1/images/generations and /v1/images/edits requests.",
        "When prompt optimization is off, GPT2IMAGE instructs the model not to modify the prompt; this is best effort and upstream may still deviate.",
        "Page Chat/Agent base round credits are configured per plan in the admin Plan Capability Matrix. Defaults are 1 credit per Chat round and 3 credits per Agent round; completed image outputs are billed additionally by detected size and count.",
      ],
      invalid: [
        "Not ChatGPT Web, so Web-only capability or quota semantics do not apply.",
        "On rate limits, quota errors, or invalid credentials, the scheduler cools down/marks the account and tries another one.",
      ],
    },
    api: {
      title: "External API Backends",
      description:
        "Uses an admin-configured OpenAI-compatible Base URL/API Key. Final capability depends on that service.",
      valid: [
        "Interface mode only declares which upstream endpoints exist: Images-only participates in image generation/edit only; Responses-only participates in Chat/Agent/Responses unless Images upstream is set to Responses; Mixed API can participate in both sides.",
        "Images upstream independently controls image generation/edit: native Images calls external /images/generations and /images/edits; Responses conversion calls external /responses + the image_generation tool.",
        "Chat Completions upstream independently controls /v1/chat/completions: Responses image mode calls external /responses; native mode calls external /chat/completions.",
        "Model, size, quality, streaming events, and usage fields depend on the external API implementation.",
      ],
      invalid: [
        "Does not consume GPT2IMAGE Web or Codex account pool quota.",
        "If the external service rewrites prompts or limits resolution, GPT2IMAGE cannot override it.",
      ],
    },
    prompt: {
      title: "Prompt Optimization And Thinking",
      rows: [
        [
          "Prompt optimization on",
          "Optimized prompt may be used; Web thinking follows the selected value.",
        ],
        [
          "Prompt optimization off",
          "Original prompt is sent; Web is forced to instant to minimize changes.",
        ],
        [
          "Codex/Responses",
          "When prompt optimization is off, GPT2IMAGE instructs the model not to modify the prompt, but final behavior still depends on the upstream model/tool.",
        ],
        [
          "External API",
          "The platform passes through where possible; the external service decides final behavior.",
        ],
      ],
    },
    roadmap: {
      title: "Roadmap",
      items: [
        "Sub2API non-database interface: current sync uses SUB2API_POSTGRES_URL to connect to Sub2API PostgreSQL. Future work should evaluate the Sub2API admin key / HTTP API path for account lookup, group filtering, status reads, error cleanup, and sync jobs; keep direct DB access only as a fallback when the API lacks required fields.",
        "PSD generation API: prepare support for PSD/layered outputs by defining the upstream contract, MIME/extension handling, storage and preview behavior, credit billing, external API response fields, capability matrix switch, and page download entry.",
        "Agent batch image tool: evaluate a generate_image_batch-style tool where the model plans multiple independent images and the backend executes them with bounded parallelism; design the interaction with Responses previous_response_id before enabling it.",
        "Image reference UX: improve atomic @图1 and @第N轮图M tokens, remap references after image reorder, and surface missing-reference warnings.",
        "Agent branching: when editing or regenerating an older round, fork a new branch instead of overwriting later records.",
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
          <span>{renderEmphasis(item)}</span>
        </li>
      ))}
    </ul>
  );
}

function renderEmphasis(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  let emphasisIndex = 0;
  return parts.map((part) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      emphasisIndex += 1;
      return (
        <strong
          className="font-semibold text-foreground"
          key={`emphasis-${emphasisIndex}-${part}`}
        >
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}

function RouteDiagram({
  flow,
}: {
  flow: typeof sections.zh.flow | typeof sections.en.flow;
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
                <div
                  className="rounded-md border bg-background p-3"
                  key={entry.path}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{entry.label}</span>
                    <Badge
                      variant="secondary"
                      className="rounded-sm font-mono text-[10px]"
                    >
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
                <div
                  className="rounded-md border bg-background p-3"
                  key={backend.title}
                >
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
              <Badge
                variant="outline"
                className="rounded-sm font-mono text-[10px]"
              >
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
    | typeof sections.zh.relationship
    | typeof sections.en.relationship;
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
          {relationship.rows.map(
            ([name, endpoints, description]: RelationshipRow) => (
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
            )
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function AgentDocs({
  agent,
}: {
  agent: typeof sections.zh.agent | typeof sections.en.agent;
}) {
  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle className="text-base">{agent.title}</CardTitle>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {agent.description}
        </p>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-md border bg-muted/20 p-4">
          <ListBlock items={agent.valid} type="valid" />
        </div>
        <div className="rounded-md border bg-muted/20 p-4">
          <ListBlock items={agent.invalid} type="invalid" />
        </div>
      </CardContent>
    </Card>
  );
}

function ExternalApiDocs({
  docs,
}: {
  docs: typeof sections.zh.externalDocs | typeof sections.en.externalDocs;
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
          <Badge
            variant="secondary"
            className="rounded-sm font-mono text-[10px]"
          >
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

export function getSystemDocsMetadata(locale = "en") {
  const content = locale === "zh" ? sections.zh : sections.en;

  return {
    title: content.title,
    description: content.subtitle,
  };
}

export function SystemDocsContent({
  locale = "en",
  className = "container mx-auto max-w-7xl space-y-6 px-4 py-6 md:px-6",
}: {
  locale?: string;
  className?: string;
}) {
  const content = locale === "zh" ? sections.zh : sections.en;

  return (
    <div className={className}>
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

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="text-base">
            {content.moderationRepair.title}
          </CardTitle>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {content.moderationRepair.description}
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-md border bg-muted/20 p-4">
            <ListBlock items={content.moderationRepair.valid} type="valid" />
          </div>
          <div className="rounded-md border bg-muted/20 p-4">
            <ListBlock
              items={content.moderationRepair.invalid}
              type="invalid"
            />
          </div>
        </CardContent>
      </Card>

      <AgentDocs agent={content.agent} />

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

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="text-base">{content.roadmap.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {content.roadmap.items.map((item) => (
              <li className="flex gap-2" key={item}>
                <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
