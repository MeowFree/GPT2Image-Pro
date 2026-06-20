"use client";

/**
 * Adobe Firefly 视频创作面板（自包含）。
 *
 * 选模型族(7族) + 时长 + 比例[+分辨率] → 组装 firefly-<family>-<dur>s-<ratio>[-<res>]
 * model id → POST /api/videos/generate（SSE，长任务 keep-alive）→ 解析 completed/error →
 * 播放产物视频。可选上传一张输入图做图生视频首帧。与图像创作解耦，作为创作页独立 tab。
 */

import { Button } from "@repo/ui/components/button";
import { Label } from "@repo/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { Textarea } from "@repo/ui/components/textarea";
import { FIREFLY_VIDEO_FAMILIES } from "@repo/shared/adobe/firefly-direct/video-catalog";
import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";

type VideoStatus = "idle" | "running" | "done" | "error";

function ratioSuffix(ratio: string): string {
  return ratio.replace(":", "x");
}

function composeVideoModelId(params: {
  family: string;
  duration: number;
  ratio: string;
  resolution: string;
  resolutionInId: boolean;
}): string {
  const base = `firefly-${params.family}-${params.duration}s-${ratioSuffix(
    params.ratio
  )}`;
  return params.resolutionInId ? `${base}-${params.resolution}` : base;
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

// 把(本站)历史图 URL 取回并转成 base64 data URL,作为图生视频首帧。
async function urlToDataUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`读取历史图失败 HTTP ${response.status}`);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取历史图失败"));
    reader.readAsDataURL(blob);
  });
}

type VideoHistoryItem = {
  id: string;
  imageUrl: string | null;
  status: string;
};

export function VideoCreatePanel({
  recent = [],
}: {
  recent?: VideoHistoryItem[];
}) {
  const families = FIREFLY_VIDEO_FAMILIES;
  const [familyId, setFamilyId] = useState(families[0]?.family ?? "sora2");
  const family = useMemo(
    () => families.find((item) => item.family === familyId) ?? families[0],
    [families, familyId]
  );
  const [duration, setDuration] = useState<number>(family?.durations[0] ?? 8);
  const [ratio, setRatio] = useState<string>(family?.ratios[0] ?? "16:9");
  const [resolution, setResolution] = useState<string>(
    family?.resolutions[0] ?? "720p"
  );
  const [prompt, setPrompt] = useState("");
  const [inputImage, setInputImage] = useState<string | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(
    null
  );
  const [status, setStatus] = useState<VideoStatus>("idle");
  const historyImages = recent.filter(
    (item) => item.status === "completed" && item.imageUrl
  );
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 切换模型族时把时长/比例/分辨率收敛到该族支持的取值。
  const onFamilyChange = (value: string) => {
    setFamilyId(value);
    const next = families.find((item) => item.family === value);
    if (next) {
      setDuration(next.durations[0] ?? duration);
      setRatio(next.ratios[0] ?? ratio);
      setResolution(next.resolutions[0] ?? resolution);
    }
  };

  if (!family) return null;

  const model = composeVideoModelId({
    family: family.family,
    duration,
    ratio,
    resolution,
    resolutionInId: family.resolutionInId,
  });

  const generate = async () => {
    if (!prompt.trim() || status === "running") return;
    setStatus("running");
    setError(null);
    setVideoUrl(null);
    try {
      const response = await fetch("/api/videos/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          model,
          ...(inputImage ? { inputImages: [inputImage] } : {}),
        }),
      });
      if (!response.ok || !response.body) {
        const text = await response.text().catch(() => "");
        throw new Error(text || `请求失败 HTTP ${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let settled = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice("data:".length).trim();
          if (!payload) continue;
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(payload) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (event.type === "completed") {
            settled = true;
            setVideoUrl(
              typeof event.videoUrl === "string" ? event.videoUrl : null
            );
            setStatus("done");
          } else if (event.type === "error") {
            settled = true;
            setError(
              typeof event.error === "string" ? event.error : "视频生成失败"
            );
            setStatus("error");
          }
        }
      }
      if (!settled) {
        setError("连接中断，请稍后在历史中查看");
        setStatus("error");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "视频生成失败");
      setStatus("error");
    }
  };

  const busy = status === "running";

  return (
    <div className="space-y-4 rounded-lg border border-border bg-background p-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">模型</Label>
          <Select value={familyId} onValueChange={onFamilyChange} disabled={busy}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {families.map((item) => (
                <SelectItem key={item.family} value={item.family}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">时长</Label>
          <Select
            value={String(duration)}
            onValueChange={(value) => setDuration(Number(value))}
            disabled={busy}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {family.durations.map((value) => (
                <SelectItem key={value} value={String(value)}>
                  {value}s
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">比例</Label>
          <Select value={ratio} onValueChange={setRatio} disabled={busy}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {family.ratios.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {family.resolutionInId && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">分辨率</Label>
            <Select
              value={resolution}
              onValueChange={setResolution}
              disabled={busy}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {family.resolutions.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <Textarea
        placeholder="描述要生成的视频…"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        disabled={busy}
        rows={3}
      />

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">
          首帧图（可选，图生视频）
        </Label>
        {historyImages.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {historyImages.slice(0, 12).map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={busy}
                title="用此历史图作首帧"
                onClick={async () => {
                  if (!item.imageUrl) return;
                  try {
                    setInputImage(await urlToDataUrl(item.imageUrl));
                    setSelectedHistoryId(item.id);
                  } catch {
                    setSelectedHistoryId(null);
                  }
                }}
                className={`h-14 w-14 overflow-hidden rounded-md border ${
                  selectedHistoryId === item.id
                    ? "ring-2 ring-primary"
                    : "border-border"
                }`}
              >
                {/* 历史缩略图(本站已生成图)。biome-ignore lint/performance/noImgElement: 简单缩略图选择器 */}
                <img
                  src={item.imageUrl ?? ""}
                  alt=""
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
          </div>
        )}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy}
          className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            setInputImage(file ? await fileToDataUrl(file) : null);
            setSelectedHistoryId(null);
          }}
        />
        {inputImage && (
          <button
            type="button"
            className="text-xs text-muted-foreground underline"
            disabled={busy}
            onClick={() => {
              setInputImage(null);
              setSelectedHistoryId(null);
            }}
          >
            清除首帧图
          </button>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={generate} disabled={busy || !prompt.trim()}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          生成视频
        </Button>
        <span className="text-xs text-muted-foreground">{model}</span>
      </div>

      {status === "running" && (
        <p className="text-sm text-muted-foreground">
          视频生成中，可能需要数分钟，请保持页面打开…
        </p>
      )}
      {status === "error" && error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
      {status === "done" && videoUrl && (
        <video
          src={videoUrl}
          controls
          className="w-full max-w-2xl rounded-lg border border-border"
        >
          <track kind="captions" />
        </video>
      )}
    </div>
  );
}
