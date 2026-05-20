import { getCurrentUser } from "@repo/shared/auth/server";
import { Badge } from "@repo/ui/components/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { ArrowDown, ArrowRight, Check, CircleHelp, X } from "lucide-react";
import { getLocale } from "next-intl/server";
import { redirect } from "next/navigation";

const sections = {
  zh: {
    title: "后端链路说明",
    subtitle:
      "这里按当前代码真实链路说明：页面请求、外接 API 请求如何进入后端池，以及 Web、Codex/Responses、外接 API 后端各自如何承接。",
    flow: {
      title: "请求路由图",
      note:
        "用户自接 API 目前仍保留最高优先级；没有可用的用户自接 API 时，才进入平台后端池。",
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
        "解析模型、尺寸、质量、审核强度、提示词优化、流式参数",
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
            "通过 ChatGPT Web 链路承接图片生成/编辑；外部 Responses 请求命中 Web 时会走 Web 适配。",
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
          "当前页面 Chat 入口按 chat 类型选择后端；账号候选以 Responses 账号为主，外接 API 后端需支持 /responses。",
        ],
      ],
      apiRows: [
        [
          "OpenAI images generation",
          "/v1/images/generations",
          "image_generation",
          "先验证 API Key 和套餐，再进入同一生成链路；默认返回 b64_json，可显式请求 url。",
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
          "要求带 image_generation tool；可命中 Codex/Responses 账号，也可命中 Web 适配或外接 /responses API。",
        ],
        [
          "OpenAI models",
          "/v1/models",
          "-",
          "只返回当前套餐/API Key 可见模型，不触发后端池调度。",
        ],
      ],
    },
    web: {
      title: "Web 账号",
      description:
        "Web 后端走 ChatGPT 网页接口，主要可控的是主 GPT 对话模型和思考强度。",
      valid: [
        "GPT 模型会作为 Web 主对话模型传入。",
        "Web 生图没有稳定的独立图片模型字段；本站不会把图片模型映射成 Web 生图模型。",
        "思考强度会作为 paragen_thinking_level 传入。",
        "关闭提示词优化时，会发送原始提示词，并把 Web 思考强度压到 instant。",
      ],
      invalid: [
        "Web 账号不提供原生 Responses API 能力。",
        "上游 Web 不一定接受所有 Responses 模型名；不可用时由后端调度和错误标记处理。",
        "页面 Chat 入口当前不会把普通 Web 账号作为 chat 账号候选；外部 /v1/responses 命中 Web 时会走适配链路。",
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
    title: "Backend Routing Help",
    subtitle:
      "The current real request path: how page requests and external API requests enter backend pools, and how Web, Codex/Responses, and external API backends handle them.",
    flow: {
      title: "Request Routing Diagram",
      note:
        "User custom API keeps the highest priority for now; when unavailable, the request enters the platform backend pool.",
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
        "Parse model, size, quality, moderation, prompt optimization, and streaming",
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
            "Uses the ChatGPT Web path for generation/edit; external Responses requests can be adapted to Web when routed there.",
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
          "The page Chat entry uses chat routing; account candidates are mainly Responses accounts, and external API backends must support /responses.",
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
          "Requires the image_generation tool; can route to Codex/Responses accounts, Web adaptation, or external /responses API.",
        ],
        [
          "OpenAI models",
          "/v1/models",
          "-",
          "Only lists models visible to the current plan/API key and does not trigger backend pool routing.",
        ],
      ],
    },
    web: {
      title: "Web Accounts",
      description:
        "Web backends use the ChatGPT web interface; the controllable fields are mainly the main GPT conversation model and thinking level.",
      valid: [
        "GPT model is sent as the main Web conversation model.",
        "Web image generation has no stable separate image model field; this service does not map image models into Web image model slugs.",
        "Thinking is sent as paragen_thinking_level.",
        "When prompt optimization is off, the original prompt is sent and Web thinking is forced to instant.",
      ],
      invalid: [
        "Web accounts do not provide native Responses API capability.",
        "The upstream Web endpoint may not accept every Responses model name; backend routing and error marking handle unavailable accounts.",
        "The page Chat entry currently does not select ordinary Web accounts as chat account candidates; external /v1/responses routed to Web uses the adaptation path.",
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
