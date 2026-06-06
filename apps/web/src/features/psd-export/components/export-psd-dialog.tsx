"use client";

/**
 * 「导出 PSD」弹窗(异步)。
 *
 * 挂在出图详情(image-lightbox):选择是否抠主体单独成层、加若干透明元素层,触发 exportPsdAction
 * (后台异步导出,立即返回签名 URL),前端轮询该 URL(404=未好、200=好了 → 取 blob 下载)。
 *
 * WHY 轮询:带元素的导出要多次出图、可能数分钟,同步会超 Cloudflare 100s "假失败"。
 * 自包含、最小侵入。每个附加元素走一次普通出图扣费;主体层抠图不额外收费。
 */
import { Button } from "@repo/ui/components/button";
import { Checkbox } from "@repo/ui/components/checkbox";
import { Dialog, DialogContent, DialogTitle } from "@repo/ui/components/dialog";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { Download, Layers, Loader2, Plus, X } from "lucide-react";
import { useLocale } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useState } from "react";
import { exportPsdAction } from "../actions";
import { MAX_PSD_EXTRA_LAYERS } from "../plan";

type ElementField = { id: string; value: string };
type Phase = "idle" | "generating" | "ready" | "failed";

/** 轮询上限:带多元素导出可能数分钟,给足余量。 */
const POLL_DEADLINE_MS = 12 * 60 * 1000;
const POLL_INTERVAL_MS = 4000;

function newField(): ElementField {
  return { id: crypto.randomUUID(), value: "" };
}

export function ExportPsdDialog({ generationId }: { generationId: string }) {
  const locale = useLocale();
  const copy = (en: string, zh: string) => (locale === "zh" ? zh : en);

  const [open, setOpen] = useState(false);
  const [isolateSubject, setIsolateSubject] = useState(true);
  const [fields, setFields] = useState<ElementField[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const { execute, result, isExecuting, hasErrored, reset } =
    useAction(exportPsdAction);
  const signedUrl = result?.data?.psdSignedUrl;

  const filledElements = fields
    .map((f) => f.value.trim())
    .filter((v) => v.length > 0);
  const extraCount = (isolateSubject ? 1 : 0) + filledElements.length;
  const atLimit = extraCount >= MAX_PSD_EXTRA_LAYERS;

  // action 返回签名 URL 后轮询:存储路由对未写入对象返回 404,写好返回 200。
  useEffect(() => {
    if (!signedUrl) return;
    setPhase("generating");
    setDownloadUrl(null);
    const controller = new AbortController();
    let cancelled = false;
    const deadline = Date.now() + POLL_DEADLINE_MS;
    (async () => {
      while (!cancelled && Date.now() < deadline) {
        try {
          const resp = await fetch(signedUrl, { signal: controller.signal });
          if (resp.status === 200) {
            const blob = await resp.blob();
            if (cancelled) return;
            setDownloadUrl(URL.createObjectURL(blob));
            setPhase("ready");
            return;
          }
          if (resp.status !== 404) {
            setPhase("failed");
            return;
          }
        } catch {
          if (controller.signal.aborted) return;
          // 网络抖动:忽略,继续轮询。
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
      if (!cancelled) setPhase("failed");
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [signedUrl]);

  function resetAll() {
    reset();
    setPhase("idle");
    setDownloadUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }

  function updateField(id: string, value: string) {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, value } : f)));
  }
  function removeField(id: string) {
    setFields((prev) => prev.filter((f) => f.id !== id));
  }

  function handleExport() {
    execute({
      generationId,
      isolateSubject,
      ...(filledElements.length
        ? { elements: filledElements.map((prompt) => ({ prompt })) }
        : {}),
    });
  }

  const busy = isExecuting || phase === "generating";
  const failed = hasErrored || phase === "failed";

  return (
    <>
      <Button
        variant="outline"
        className="w-full justify-center"
        onClick={() => setOpen(true)}
      >
        <Layers className="mr-2 h-4 w-4" />
        {copy("Export PSD", "导出 PSD")}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) resetAll();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogTitle>{copy("Export layered PSD", "导出分层 PSD")}</DialogTitle>

          <div className="space-y-4">
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={isolateSubject}
                onCheckedChange={(v) => setIsolateSubject(v === true)}
                disabled={busy}
              />
              <span className="text-sm">
                {copy("Subject as a separate layer", "把主体单独成一层")}
              </span>
            </label>

            <div className="space-y-2">
              <Label className="text-sm">
                {copy("Extra element layers", "附加元素图层")}
              </Label>
              {fields.map((field) => (
                <div key={field.id} className="flex gap-2">
                  <Input
                    value={field.value}
                    disabled={busy}
                    onChange={(e) => updateField(field.id, e.target.value)}
                    placeholder={copy(
                      "Describe an element (transparent layer)",
                      "描述一个元素(透明生成为一层)"
                    )}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={busy}
                    onClick={() => removeField(field.id)}
                    aria-label={copy("Remove", "移除")}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setFields((prev) => [...prev, newField()])}
                disabled={atLimit || busy}
              >
                <Plus className="mr-1 h-4 w-4" />
                {copy("Add element", "添加元素")}
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              {copy(
                "Each extra element runs one generation and is billed like a normal image. The subject layer is cut from the base image (pixel-accurate, no extra charge).",
                "每个附加元素走一次普通出图扣费;主体层由底图抠图得到(像素级精确,不额外收费)。"
              )}
            </p>
            <p className="text-[11px] leading-relaxed text-muted-foreground/70">
              {copy("Background removal: ISNet model (", "抠图采用 ISNet 模型(")}
              <a
                href="https://github.com/xuebinqin/DIS"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                xuebinqin/DIS
              </a>
              {copy(", MIT) via onnxruntime.", ",MIT 许可),引擎 onnxruntime。")}
            </p>

            {failed && (
              <p className="text-sm text-destructive">
                {copy(
                  "Export failed or took too long, please try again (fewer elements).",
                  "导出失败或耗时过长,请重试(可减少元素数)。"
                )}
              </p>
            )}

            {phase === "ready" && downloadUrl ? (
              <Button asChild className="w-full justify-center">
                <a
                  href={downloadUrl}
                  download={`gpt2image-${generationId}.psd`}
                >
                  <Download className="mr-2 h-4 w-4" />
                  {copy("Download PSD", "下载 PSD")}
                </a>
              </Button>
            ) : (
              <Button
                className="w-full justify-center"
                onClick={handleExport}
                disabled={busy}
              >
                {busy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {copy(
                      "Generating… (may take 1-2 min, keep open)",
                      "正在生成…(可能 1-2 分钟,请勿关闭)"
                    )}
                  </>
                ) : (
                  copy("Export", "开始导出")
                )}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
