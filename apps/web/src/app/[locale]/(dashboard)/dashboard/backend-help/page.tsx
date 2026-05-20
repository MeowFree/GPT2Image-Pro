import { getCurrentUser } from "@repo/shared/auth/server";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { Check, CircleHelp, X } from "lucide-react";
import { getLocale } from "next-intl/server";
import { redirect } from "next/navigation";

const sections = {
  zh: {
    title: "后端说明",
    subtitle:
      "这里说明账号池调度到 Web、Codex/Responses、外接 API 时，各字段会怎样生效。",
    web: {
      title: "Web 账号",
      description:
        "Web 后端走 ChatGPT 网页接口，支持主 GPT 模型和图片模型两个概念。",
      valid: [
        "GPT 模型会作为 Web 主对话模型传入。",
        "图片模型会映射到 Web 的 force_paragen_model_slug。",
        "思考强度会作为 paragen_thinking_level 传入。",
        "关闭提示词优化时，会发送原始提示词，并把 Web 思考强度压到 instant。",
      ],
      invalid: [
        "Web 账号不提供原生 Responses API 能力。",
        "上游 Web 不一定接受所有 Responses 模型名；不可用时由后端调度和错误标记处理。",
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
    title: "Backend Help",
    subtitle:
      "How fields behave when routing to Web, Codex/Responses, or external API backends.",
    web: {
      title: "Web Accounts",
      description:
        "Web backends use the ChatGPT web interface and have separate main GPT model and image model concepts.",
      valid: [
        "GPT model is sent as the main Web conversation model.",
        "Image model maps to force_paragen_model_slug.",
        "Thinking is sent as paragen_thinking_level.",
        "When prompt optimization is off, the original prompt is sent and Web thinking is forced to instant.",
      ],
      invalid: [
        "Web accounts do not provide native Responses API capability.",
        "The upstream Web endpoint may not accept every Responses model name; backend routing and error marking handle unavailable accounts.",
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
