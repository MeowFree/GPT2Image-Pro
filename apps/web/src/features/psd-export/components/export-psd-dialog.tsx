"use client";

/**
 * 「导出 PSD」弹窗(异步)。
 *
 * 挂在出图详情(image-lightbox):把"生成即分层"的产物组装成可编辑分层 PSD。触发 exportPsdAction
 * (后台异步组装,立即返回签名 URL),前端轮询该 URL(404=未好、200=好了 → 取 blob 下载)。
 * 仅分层生成的产物可导出;非分层产物 action 会直接报错。
 *
 * WHY 轮询:逐元素抠图 + 组装在 CPU 上数十秒,同步会超 Cloudflare 100s。不生成新图、不扣费。
 */
import { Button } from "@repo/ui/components/button";
import { Dialog, DialogContent, DialogTitle } from "@repo/ui/components/dialog";
import { Download, Layers, Loader2 } from "lucide-react";
import { useLocale } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useState } from "react";
import { exportPsdAction } from "../actions";

type Phase = "idle" | "generating" | "ready" | "failed";

/** 轮询上限:逐元素抠图 + 组装可能数十秒至数分钟,给足余量。 */
const POLL_DEADLINE_MS = 12 * 60 * 1000;
const POLL_INTERVAL_MS = 4000;

export function ExportPsdDialog({ generationId }: { generationId: string }) {
  const locale = useLocale();
  const copy = (en: string, zh: string) => (locale === "zh" ? zh : en);

  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const { execute, result, isExecuting, hasErrored, reset } =
    useAction(exportPsdAction);
  const signedUrl = result?.data?.psdSignedUrl;

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
            <p className="text-sm text-muted-foreground">
              {copy(
                "Decompose this image into editable layers and export a .psd (no new images generated, no credits charged). Runs in the background, ~1-2 min.",
                "把这张图分解成可编辑图层并导出 .psd(不生成新图、不扣积分)。后台运行,约 1-2 分钟。"
              )}
            </p>

            {failed && (
              <p className="text-sm text-destructive">
                {copy(
                  "Export failed or took too long, please try again.",
                  "导出失败或耗时过长,请重试。"
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
                onClick={() => execute({ generationId })}
                disabled={busy}
              >
                {busy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {copy(
                      "Decomposing… (keep this open)",
                      "正在分层…(请勿关闭)"
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
