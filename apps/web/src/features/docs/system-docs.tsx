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
      "这里按当前代码真实链路说明：六个入口都是协议适配层，不互相 HTTP 调用，最终统一进入同一套生成、扣费、调度和存储链路。",
    flow: {
      title: "请求路由图",
      note: "用户自接 API 目前仍保留最高优先级；没有可用的用户自接 API 时，才进入平台后端池。外接接口不会反向请求站内 /api/images/*。",
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
        [
          "GPT2IMAGE credits",
          "/v1/credits",
          "-",
          "返回当前 API Key 的限额、已用、剩余以及所属账户余额，不触发后端池调度。",
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
      note: "所以关系不是“外接 API 调页面 API”，而是“六个入口共享同一个 service 层”。",
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
        "response_format 控制返回 URL 或 base64；output_format 才控制图片文件格式，二者不是同一个字段。",
        "错误响应采用 OpenAI 风格 error 对象；本站可能额外返回 generation_id、generationId、credits_consumed 方便排查和对账。",
        "外接 API Key 绑定的后端分组优先；未绑定时使用用户默认分组，再回退默认启用分组。",
        "分组计费倍率会参与预扣、结算、退款和用量记录；mixed 父分组命中子分组成员时，父分组倍率与子分组倍率相乘生效。",
        "外接 API Key 可设置独立积分限额；GET /v1/credits 可查询 Key 限额、已用额度和账户余额。",
        "用户已启用“接入其他站 API”时仍优先使用用户自接 API；image 接口的 force_web / forceWeb 不会覆盖用户自接 API。",
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
          title: "Get credits",
          method: "GET",
          path: "/v1/credits",
          contentType: "无请求体",
          description:
            "查询当前 Bearer API Key 的限额、已用额度、剩余额度，以及所属账户当前积分余额。",
          example: `curl https://gpt2image.superapi.buzz/v1/credits \\
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
            "API Key 限额只限制该 Key 自身；实际调用仍必须有足够账户积分。",
            "生成失败退款、审核拦截结算和实际尺寸后修正会同步修正 Key 已用额度。",
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
curl https://gpt2image.superapi.buzz/v1/images/generations \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-image-2",
    "prompt": "A cute baby sea otter",
    "n": 1,
    "size": "1024x1024",
    "quality": "medium",
    "moderation": "auto"
  }'

# 2. 返回 URL，并关闭本站提示词优化
curl https://gpt2image.superapi.buzz/v1/images/generations \\
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
    "prompt_optimization": false
  }'

# 3. Codex/Responses 后端专用参数；普通 Images API 后端可能忽略
curl https://gpt2image.superapi.buzz/v1/images/generations \\
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

# 4. mixed 分组强制调度 Web 账号；非 mixed 分组会忽略 force_web
curl https://gpt2image.superapi.buzz/v1/images/generations \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-image-2",
    "prompt": "一张 1:1 头像海报",
    "size": "1024x1024",
    "response_format": "url",
    "force_web": true
  }'

# 5. 流式返回；也可用 Accept: text/event-stream 触发
curl -N https://gpt2image.superapi.buzz/v1/images/generations \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Accept: text/event-stream" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-image-2",
    "prompt": "一张透明玻璃材质的未来感咖啡杯",
    "size": "1024x1024",
    "response_format": "url",
    "stream": true
  }'`,
          responseExample: `{
  "created": 1713833628,
  "data": [
    {
      "url": "https://gpt2image.superapi.buzz/api/storage/generations/...",
      "revised_prompt": "..."
    }
  ],
  "usage": null
}

# stream=true 时的 SSE 片段
event: image_generation.partial_image
data: {"type":"image_generation.partial_image","index":0,"partial_image_index":0,"url":"https://gpt2image.superapi.buzz/api/storage/generations/..."}

event: image_generation.completed
data: {"type":"image_generation.completed","index":0,"generation_id":"...","generationId":"...","model":"gpt-image-2","size":"1024x1024","credits_consumed":1.31,"url":"https://gpt2image.superapi.buzz/api/storage/generations/...","data":[{"url":"https://gpt2image.superapi.buzz/api/storage/generations/...","revised_prompt":"..."}]}
`,
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
            {
              name: "force_web / forceWeb",
              requirement: "可选",
              custom: true,
              description:
                "仅 image 接口支持。用户自接 API 优先时忽略；进入平台账号池且命中的后端分组为 mixed 时，只调度 Web 账号。非 mixed 分组忽略该字段。Web 后端不能严格保证分辨率或 4K。",
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
            "Web 后端无法严格控制输出尺寸和输出格式；本站保存时会按实际图片头识别扩展名和 MIME。",
            "如果实际生成尺寸与请求尺寸不一致，本站会按检测到的实际尺寸修正记录和计费。",
            "官方 Images API 可能返回 usage；本站当前非流式 JSON 响应通常返回 usage: null，流式完成和错误事件会带 credits_consumed。",
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
curl https://gpt2image.superapi.buzz/v1/images/edits \\
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
  -F 'image[]=@/path/to/reference.png'

# 2. multipart 多参考图 + mask + Codex/Responses 参数
curl https://gpt2image.superapi.buzz/v1/images/edits \\
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
curl https://gpt2image.superapi.buzz/v1/images/edits \\
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
    "prompt_optimization": false,
    "gptModel": "gpt-5.4-mini",
    "thinking": "low"
  }'

# 4. mixed 分组强制调度 Web 账号；非 mixed 分组会忽略 force_web
curl https://gpt2image.superapi.buzz/v1/images/edits \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-image-2",
    "prompt": "保留人物，改成电影剧照质感",
    "images": ["https://example.com/reference.png"],
    "size": "1024x1024",
    "response_format": "url",
    "force_web": true
  }'

# 5. 流式图生图
curl -N https://gpt2image.superapi.buzz/v1/images/edits \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Accept: text/event-stream" \\
  -F model="gpt-image-2" \\
  -F prompt="保留构图，改成水彩插画风格" \\
  -F size="1024x1024" \\
  -F response_format="url" \\
  -F stream="true" \\
  -F 'image=@/path/to/reference.png'`,
          responseExample: `{
  "created": 1713833628,
  "data": [
    {
      "url": "https://gpt2image.superapi.buzz/api/storage/generations/...",
      "revised_prompt": "..."
    }
  ],
  "usage": null
}

# stream=true 时的 SSE 片段
event: image_edit.partial_image
data: {"type":"image_edit.partial_image","index":0,"partial_image_index":0,"url":"https://gpt2image.superapi.buzz/api/storage/generations/..."}

event: image_edit.completed
data: {"type":"image_edit.completed","index":0,"generation_id":"...","generationId":"...","model":"gpt-image-2","size":"1024x1024","credits_consumed":1.31,"url":"https://gpt2image.superapi.buzz/api/storage/generations/...","data":[{"url":"https://gpt2image.superapi.buzz/api/storage/generations/...","revised_prompt":"..."}]}
`,
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
              description: "PNG mask 文件；JSON 中可传 URL 形式的 mask 引用。",
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
            {
              name: "force_web / forceWeb",
              requirement: "可选",
              custom: true,
              description:
                "仅 image 接口支持。用户自接 API 优先时忽略；进入平台账号池且命中的后端分组为 mixed 时，只调度 Web 账号。非 mixed 分组忽略该字段。Web 后端不能严格保证分辨率或 4K。",
            },
          ],
          responses: [
            {
              name: "created / data[]",
              description: "与 /v1/images/generations 相同。",
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
curl https://gpt2image.superapi.buzz/v1/responses \\
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
curl https://gpt2image.superapi.buzz/v1/responses \\
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
curl https://gpt2image.superapi.buzz/v1/responses \\
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
curl -N https://gpt2image.superapi.buzz/v1/responses \\
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
        "Images generation/edit 调用对方 Images API。",
        "Responses 请求调用对方 /responses。",
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
  },
  en: {
    title: "System Docs",
    subtitle:
      "The six endpoints are protocol adapters. They do not call each other over HTTP; they enter the same generation, billing, scheduling, and storage path.",
    flow: {
      title: "Request Routing Diagram",
      note: "User custom API keeps the highest priority for now; when unavailable, the request enters the platform backend pool. External endpoints do not call internal /api/images/* routes.",
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
        [
          "GPT2IMAGE credits",
          "/v1/credits",
          "-",
          "Returns the current API key quota, usage, remaining quota, and the owning account credit balance without backend routing.",
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
      note: "The relationship is not external API -> page API. It is six adapters -> one shared service layer.",
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
        "response_format controls URL vs base64; output_format controls the image file format. They are different fields.",
        "Error responses use an OpenAI-style error object. GPT2IMAGE may also return generation_id, generationId, and credits_consumed for debugging and reconciliation.",
        "A backend group bound to the external API key wins first. Otherwise the user's default group is used, then the enabled platform default group.",
        "Backend group billing multipliers are applied to pre-charge, settlement, refunds, and usage records. When a mixed parent group dispatches to a child group member, the parent and child multipliers are multiplied.",
        "External API keys can have independent credit limits. GET /v1/credits returns key quota, used credits, and account balance.",
        "If the user has enabled a custom upstream API, GPT2IMAGE still uses that custom API first; image endpoint force_web / forceWeb does not override it.",
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
          title: "Get credits",
          method: "GET",
          path: "/v1/credits",
          contentType: "No request body",
          description:
            "Returns the current Bearer API key's credit limit, used credits, remaining credits, and owning account balance.",
          example: `curl https://gpt2image.superapi.buzz/v1/credits \\
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
              description: "Total limit for this API key; null means unlimited.",
            },
            {
              name: "api_key.credits_used / credits_remaining",
              description:
                "Used and remaining quota for this key. credits_remaining is null when unlimited.",
            },
          ],
          notes: [
            "The API key quota only limits this key. Calls still require enough account credits.",
            "Failed-generation refunds, moderation settlement, and actual-size corrections also update key usage.",
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
curl https://gpt2image.superapi.buzz/v1/images/generations \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-image-2",
    "prompt": "A cute baby sea otter",
    "n": 1,
    "size": "1024x1024",
    "quality": "medium",
    "moderation": "auto"
  }'

# 2. Return a URL and disable GPT2IMAGE prompt optimization.
curl https://gpt2image.superapi.buzz/v1/images/generations \\
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
    "prompt_optimization": false
  }'

# 3. Codex/Responses backend-only parameters. Plain Images API backends may ignore them.
curl https://gpt2image.superapi.buzz/v1/images/generations \\
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

# 4. Force Web account scheduling for mixed groups. Non-mixed groups ignore force_web.
curl https://gpt2image.superapi.buzz/v1/images/generations \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-image-2",
    "prompt": "A 1:1 avatar poster",
    "size": "1024x1024",
    "response_format": "url",
    "force_web": true
  }'

# 5. Streaming response. Accept: text/event-stream also enables streaming.
curl -N https://gpt2image.superapi.buzz/v1/images/generations \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Accept: text/event-stream" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-image-2",
    "prompt": "A transparent glass futuristic coffee cup",
    "size": "1024x1024",
    "response_format": "url",
    "stream": true
  }'`,
          responseExample: `{
  "created": 1713833628,
  "data": [
    {
      "url": "https://gpt2image.superapi.buzz/api/storage/generations/...",
      "revised_prompt": "..."
    }
  ],
  "usage": null
}

# SSE when stream=true
event: image_generation.partial_image
data: {"type":"image_generation.partial_image","index":0,"partial_image_index":0,"url":"https://gpt2image.superapi.buzz/api/storage/generations/..."}

event: image_generation.completed
data: {"type":"image_generation.completed","index":0,"generation_id":"...","generationId":"...","model":"gpt-image-2","size":"1024x1024","credits_consumed":1.31,"url":"https://gpt2image.superapi.buzz/api/storage/generations/...","data":[{"url":"https://gpt2image.superapi.buzz/api/storage/generations/...","revised_prompt":"..."}]}
`,
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
            {
              name: "force_web / forceWeb",
              requirement: "Optional",
              custom: true,
              description:
                "Only supported by image endpoints. Ignored when a user custom upstream API takes priority; after routing enters the platform pool, mixed backend groups schedule Web accounts only. Non-mixed groups ignore this field. Web backends cannot strictly guarantee resolution or 4K output.",
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
            "Web backends cannot strictly control output dimensions or output format. GPT2IMAGE labels stored files by the detected image header and MIME.",
            "If the actual generated dimensions differ from the requested size, GPT2IMAGE records and bills using the detected actual size.",
            "The official Images API may return usage. GPT2IMAGE usually returns usage: null in non-stream JSON responses; streaming completion and error events include credits_consumed.",
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
curl https://gpt2image.superapi.buzz/v1/images/edits \\
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
  -F 'image[]=@/path/to/reference.png'

# 2. multipart multiple references + mask + Codex/Responses fields.
curl https://gpt2image.superapi.buzz/v1/images/edits \\
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
curl https://gpt2image.superapi.buzz/v1/images/edits \\
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
    "prompt_optimization": false,
    "gptModel": "gpt-5.4-mini",
    "thinking": "low"
  }'

# 4. Force Web account scheduling for mixed groups. Non-mixed groups ignore force_web.
curl https://gpt2image.superapi.buzz/v1/images/edits \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-image-2",
    "prompt": "Keep the person and make it look like a cinematic still",
    "images": ["https://example.com/reference.png"],
    "size": "1024x1024",
    "response_format": "url",
    "force_web": true
  }'

# 5. Streaming image edit.
curl -N https://gpt2image.superapi.buzz/v1/images/edits \\
  -H "Authorization: Bearer $GPT2IMAGE_API_KEY" \\
  -H "Accept: text/event-stream" \\
  -F model="gpt-image-2" \\
  -F prompt="Keep the composition and convert it to watercolor illustration" \\
  -F size="1024x1024" \\
  -F response_format="url" \\
  -F stream="true" \\
  -F 'image=@/path/to/reference.png'`,
          responseExample: `{
  "created": 1713833628,
  "data": [
    {
      "url": "https://gpt2image.superapi.buzz/api/storage/generations/...",
      "revised_prompt": "..."
    }
  ],
  "usage": null
}

# SSE when stream=true
event: image_edit.partial_image
data: {"type":"image_edit.partial_image","index":0,"partial_image_index":0,"url":"https://gpt2image.superapi.buzz/api/storage/generations/..."}

event: image_edit.completed
data: {"type":"image_edit.completed","index":0,"generation_id":"...","generationId":"...","model":"gpt-image-2","size":"1024x1024","credits_consumed":1.31,"url":"https://gpt2image.superapi.buzz/api/storage/generations/...","data":[{"url":"https://gpt2image.superapi.buzz/api/storage/generations/...","revised_prompt":"..."}]}
`,
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
              description:
                "Image model; must be a gpt-image-* style image model.",
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
            {
              name: "force_web / forceWeb",
              requirement: "Optional",
              custom: true,
              description:
                "Only supported by image endpoints. Ignored when a user custom upstream API takes priority; after routing enters the platform pool, mixed backend groups schedule Web accounts only. Non-mixed groups ignore this field. Web backends cannot strictly guarantee resolution or 4K output.",
            },
          ],
          responses: [
            {
              name: "created / data[]",
              description: "Same as /v1/images/generations.",
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
curl https://gpt2image.superapi.buzz/v1/responses \\
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
curl https://gpt2image.superapi.buzz/v1/responses \\
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
curl https://gpt2image.superapi.buzz/v1/responses \\
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
curl -N https://gpt2image.superapi.buzz/v1/responses \\
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
                "GPT2IMAGE generation record, billing, and size metadata.",
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
        "Images generation/edit call the external Images API.",
        "Responses requests call the external /responses endpoint.",
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
  className = "container mx-auto max-w-5xl space-y-6 px-4 py-6 md:px-6",
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
