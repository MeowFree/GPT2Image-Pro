"use client";

/**
 * ChatGPT 账号注册机 Tab 组件
 *
 * 职责：提供注册机配置（Moemail、代理）与批量注册操作界面。
 *   - 读写注册机系统配置（Moemail API Key、Base URL、域名、代理）
 *   - 查询 Moemail 可用域名列表
 *   - 发起注册任务：通过 SSE 流式接收日志，完成后自动将 access token 导入生图池
 *
 * 使用方：admin-panel.tsx 的 "register" Tab
 * 关键依赖：
 *   - getChatgptRegisterConfigAction / saveChatgptRegisterConfigAction（配置读写）
 *   - getMoemailDomainsAction（域名查询）
 *   - /api/admin/chatgpt-register（SSE 注册任务）
 */

import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  getChatgptRegisterConfigAction,
  getMoemailDomainsAction,
  saveChatgptRegisterConfigAction,
} from "./actions";

type SseEvent =
  | { type: "log"; line: string }
  | { type: "imported"; imported: number; failed: number; skipped: number }
  | { type: "error"; message: string }
  | { type: "done" };

type Group = {
  id: string;
  name: string;
};

type Props = {
  groups: Group[];
};

export function ChatgptRegisterTab({ groups }: Props) {
  // 配置表单
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://mail.52ai.org");
  const [domain, setDomain] = useState("");
  const [proxy, setProxy] = useState("");
  const [availableDomains, setAvailableDomains] = useState<string[]>([]);

  // 注册参数
  const [count, setCount] = useState(10);
  const [concurrency, setConcurrency] = useState(5);
  const [webGroupId, setWebGroupId] = useState<string>("");
  const [namePrefix, setNamePrefix] = useState("");

  // 运行状态
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<{ id: number; line: string }[]>([]);
  const logIdRef = useRef(0);
  const [importResult, setImportResult] = useState<{
    imported: number;
    failed: number;
    skipped: number;
  } | null>(null);

  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // 加载当前配置
  const { execute: loadConfig, isExecuting: isLoadingConfig } = useAction(
    getChatgptRegisterConfigAction,
    {
      onSuccess: ({ data }) => {
        if (!data) return;
        if (data.apiKey) setApiKey(data.apiKey);
        if (data.baseUrl) setBaseUrl(data.baseUrl);
        if (data.domain) setDomain(data.domain);
        if (data.proxy) setProxy(data.proxy);
      },
      onError: () => toast.error("加载注册机配置失败"),
    }
  );

  useEffect(() => {
    loadConfig();
  }, []);

  // 保存配置
  const { execute: saveConfig, isExecuting: isSavingConfig } = useAction(
    saveChatgptRegisterConfigAction,
    {
      onSuccess: () => toast.success("配置已保存"),
      onError: () => toast.error("保存配置失败"),
    }
  );

  // 查询可用域名
  const { execute: fetchDomains, isExecuting: isFetchingDomains } = useAction(
    getMoemailDomainsAction,
    {
      onSuccess: ({ data }) => {
        if (!data) return;
        setAvailableDomains(data.domains);
        if (data.domains.length > 0 && !domain) {
          setDomain(data.domains[0]!);
        }
        toast.success(`获取到 ${data.domains.length} 个可用域名`);
      },
      onError: ({ error }) =>
        toast.error(`查询域名失败：${error.serverError ?? "未知错误"}`),
    }
  );

  // 启动注册任务（SSE）
  async function startRegister() {
    if (running) return;
    setRunning(true);
    setLogs([]);
    logIdRef.current = 0;
    setImportResult(null);

    try {
      const resp = await fetch("/api/admin/chatgpt-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          count,
          concurrency,
          webGroupId: webGroupId || null,
          namePrefix: namePrefix || undefined,
        }),
      });

      if (!resp.ok || !resp.body) {
        toast.error(`接口返回 ${resp.status}`);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";

        for (const part of parts) {
          for (const rawLine of part.split("\n")) {
            const line = rawLine.trim();
            if (!line.startsWith("data:")) continue;
            const json = line.slice(5).trim();
            if (!json) continue;
            try {
              const event = JSON.parse(json) as SseEvent;
              if (event.type === "log") {
                const id = ++logIdRef.current;
                setLogs((prev) => [...prev, { id, line: event.line }]);
              } else if (event.type === "imported") {
                setImportResult({
                  imported: event.imported,
                  failed: event.failed,
                  skipped: event.skipped,
                });
              } else if (event.type === "error") {
                toast.error(`注册机错误：${event.message}`);
                const id = ++logIdRef.current;
                setLogs((prev) => [...prev, { id, line: `[错误] ${event.message}` }]);
              }
            } catch {
              // 忽略解析失败的行
            }
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "未知错误";
      toast.error(`注册任务失败：${msg}`);
      const id = ++logIdRef.current;
      setLogs((prev) => [...prev, { id, line: `[错误] ${msg}` }]);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* 配置区 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Moemail 与代理配置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Moemail Base URL</Label>
              <Input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://mail.52ai.org"
                disabled={running}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Moemail API Key</Label>
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="mk_..."
                disabled={running}
              />
            </div>
          </div>

          {/* 域名选择 */}
          <div className="space-y-1.5">
            <Label>注册邮箱域名</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fetchDomains({ baseUrl, apiKey })}
                disabled={isFetchingDomains || running}
              >
                {isFetchingDomains ? "查询中..." : "查询可用域名"}
              </Button>
              {availableDomains.length > 0 ? (
                <Select
                  value={domain}
                  onValueChange={setDomain}
                  disabled={running}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="选择域名" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableDomains.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder="pt.sanyela.shop"
                  className="flex-1"
                  disabled={running}
                />
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>代理地址</Label>
            <Input
              type="password"
              value={proxy}
              onChange={(e) => setProxy(e.target.value)}
              placeholder="http://user:pass@host:port"
              disabled={running}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => loadConfig()}
              disabled={isLoadingConfig || running}
            >
              重新加载
            </Button>
            <Button
              type="button"
              onClick={() =>
                saveConfig({ apiKey, baseUrl, domain, proxy })
              }
              disabled={isSavingConfig || running}
            >
              {isSavingConfig ? "保存中..." : "保存配置"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 注册参数 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">注册参数</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>注册数量（1-500）</Label>
              <Input
                type="number"
                min={1}
                max={500}
                value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(500, Number(e.target.value))))}
                disabled={running}
              />
            </div>
            <div className="space-y-1.5">
              <Label>并发数（1-50）</Label>
              <Input
                type="number"
                min={1}
                max={50}
                value={concurrency}
                onChange={(e) =>
                  setConcurrency(Math.max(1, Math.min(50, Number(e.target.value))))
                }
                disabled={running}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>导入到分组</Label>
            <Select
              value={webGroupId}
              onValueChange={setWebGroupId}
              disabled={running}
            >
              <SelectTrigger>
                <SelectValue placeholder="不指定分组（默认）" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">不指定分组（默认）</SelectItem>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>账号名称前缀（可选）</Label>
            <Input
              value={namePrefix}
              onChange={(e) => setNamePrefix(e.target.value)}
              placeholder="例：reg-"
              maxLength={80}
              disabled={running}
            />
          </div>

          <div className="flex justify-end">
            <Button
              type="button"
              onClick={startRegister}
              disabled={running}
            >
              {running ? "注册中..." : "开始注册"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 日志输出 */}
      {(logs.length > 0 || running) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              注册日志
              {importResult && (
                <span className="ml-3 text-sm font-normal text-muted-foreground">
                  导入：成功 {importResult.imported}，失败 {importResult.failed}，跳过{" "}
                  {importResult.skipped}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-80 overflow-y-auto rounded border bg-muted p-3 font-mono text-xs leading-relaxed">
              {logs.map(({ id, line }) => (
                <div key={id}>{line}</div>
              ))}
              {running && (
                <div className="animate-pulse text-muted-foreground">
                  运行中...
                </div>
              )}
              <div ref={logEndRef} />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
