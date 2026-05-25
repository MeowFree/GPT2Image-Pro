"use client";

import { formatCredits } from "@repo/shared/credits/format";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  getImageBaseCreditPricing,
  getImageBaseCredits,
  IMAGE_1024_BASE_PIXELS,
  IMAGE_1K_BASE_SIZE,
  MAX_IMAGE_PIXELS,
  REFERENCE_CREDIT_PRICE_CNY,
  TEXT_MODERATION_PRICE_CNY,
  IMAGE_MODERATION_PRICE_CNY,
  type ImageBaseCreditPricing,
} from "@/features/image-generation/resolution";

type ImagePricingChartCardProps = {
  billing: {
    agentRoundCredits: number;
    chatRoundCredits: number;
    moderationBlockingEnabled: boolean;
    monthlyCredits: number;
    planName: string;
  };
  isZh: boolean;
  pricing: ImageBaseCreditPricing;
};

type PricingPoint = {
  baseCredits: number;
  label: string;
  megapixels: number;
  pixels: number;
  size: string;
};

const PRICING_POINTS = [
  { label: "1024", size: "1024x1024", pixels: IMAGE_1024_BASE_PIXELS },
  {
    label: "1K",
    size: IMAGE_1K_BASE_SIZE,
    pixels: 1248 * 1248,
  },
  { label: "3:2", size: "1536x1024", pixels: 1536 * 1024 },
  { label: "2K", size: "2048x2048", pixels: 2048 * 2048 },
  { label: "3K", size: "3072x1728", pixels: 3072 * 1728 },
  { label: "4K", size: "3840x2160", pixels: MAX_IMAGE_PIXELS },
];

function buildChartData(pricing: ImageBaseCreditPricing): PricingPoint[] {
  return PRICING_POINTS.map((point) => ({
    ...point,
    baseCredits: getImageBaseCredits(point.pixels, pricing),
    megapixels: Number((point.pixels / 1_000_000).toFixed(2)),
  }));
}

function formatPrice(value: number) {
  return formatCredits(value);
}

export function ImagePricingChartCard({
  billing,
  isZh,
  pricing,
}: ImagePricingChartCardProps) {
  const normalizedPricing = getImageBaseCreditPricing(pricing);
  const data = buildChartData(normalizedPricing);
  const copy = (en: string, zh: string) => (isZh ? zh : en);
  const textModerationCredits =
    TEXT_MODERATION_PRICE_CNY / REFERENCE_CREDIT_PRICE_CNY;
  const imageModerationCredits =
    IMAGE_MODERATION_PRICE_CNY / REFERENCE_CREDIT_PRICE_CNY;

  const pricingItems = [
    {
      label: copy("Plan quota", "套餐配额"),
      value: `${billing.planName} · ${formatCredits(
        billing.monthlyCredits
      )} ${copy("credits / month", "积分/月")}`,
    },
    {
      label: copy("Chat round", "Chat 轮次"),
      value: `${formatCredits(billing.chatRoundCredits)} ${copy(
        "credits / round",
        "积分/轮"
      )}`,
    },
    {
      label: copy("Agent round", "Agent 轮次"),
      value: `${formatCredits(billing.agentRoundCredits)} ${copy(
        "credits / round",
        "积分/轮"
      )}`,
    },
    {
      label: copy("Review add-on", "审核附加"),
      value: billing.moderationBlockingEnabled
        ? `${formatCredits(textModerationCredits)} ${copy(
            "text",
            "文本"
          )} · ${formatCredits(imageModerationCredits)} ${copy("image", "图片")}`
        : copy("Not enabled for this plan", "当前套餐未启用"),
    },
  ];

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base font-medium">
          {copy("Image Pricing Curve", "生图计价曲线")}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {copy(
            `Base image credits interpolate from ${formatPrice(
              normalizedPricing.base1024Credits
            )} at 1024x1024 to ${formatPrice(
              normalizedPricing.base4kCredits
            )} at 3840x2160.`,
            `基础生图积分从 1024x1024 的 ${formatPrice(
              normalizedPricing.base1024Credits
            )} 到 3840x2160 的 ${formatPrice(
              normalizedPricing.base4kCredits
            )} 之间按像素线性推算。`
          )}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="h-[240px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ bottom: 8, left: 0, right: 10, top: 10 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="megapixels"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(value) => `${Number(value).toFixed(1)}MP`}
                tickLine={false}
                type="number"
              />
              <YAxis
                tickFormatter={(value) => formatPrice(Number(value))}
                tickLine={false}
                width={42}
              />
              <Tooltip
                cursor={{ stroke: "hsl(var(--muted-foreground))" }}
                formatter={(value) => [
                  `${formatPrice(Number(value))} ${copy("credits", "积分")}`,
                  copy("Base credits", "基础积分"),
                ]}
                labelFormatter={(_, payload) => {
                  const point = payload?.[0]?.payload as
                    | PricingPoint
                    | undefined;
                  if (!point) return "";
                  return `${point.label} · ${point.size} · ${point.megapixels}MP`;
                }}
              />
              <Line
                activeDot={{ r: 5 }}
                dataKey="baseCredits"
                dot={{ r: 3 }}
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                type="monotone"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          {pricingItems.map((item) => (
            <div
              className="rounded-lg border bg-muted/30 p-3"
              key={item.label}
            >
              <div className="text-xs text-muted-foreground">{item.label}</div>
              <div className="mt-1 text-sm font-medium">{item.value}</div>
            </div>
          ))}
        </div>
        <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
          <p>
            {copy(
              "The curve shows base image generation credits only. Text review, image review, group multiplier, and Chat/Agent round charges are added separately.",
              "曲线仅展示基础生图积分；文本审核、图片审核、分组倍率、Chat/Agent 轮次费用会在此基础上另行叠加。"
            )}
          </p>
          <p>
            {copy(
              "Requests below 1024x1024 use the 1024 base price, and requests above 4K use the 4K base price.",
              "低于 1024x1024 按 1024 基础价封底，高于 4K 按 4K 基础价封顶。"
            )}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
