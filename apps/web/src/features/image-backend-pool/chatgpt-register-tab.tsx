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
import { Switch } from "@repo/ui/components/switch";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  getChatgptRegisterConfigAction,
  getGroupAvailableCountAction,
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
  const [proxyDisabled, setProxyDisabled] = useState(false);
  const [availableDomains, setAvailableDomains] = useState<string[]>([]);
  const [domainRotationEnabled, setDomainRotationEnabled] = useState(false);
  const [savedDomainCount, setSavedDomainCount] = useState(0);

  // 代理 IP 刷新配置
  const [refreshUrl, setRefreshUrl] = useState("");
  const [refreshMinIntervalSeconds, setRefreshMinIntervalSeconds] =
    useState(60);
  const [refreshMinAttempts, setRefreshMinAttempts] = useState(100);

  // 号池维持配置
  const [maintainEnabled, setMaintainEnabled] = useState(false);
  const [maintainGroupId, setMaintainGroupId] = useState("");
  const [maintainTarget, setMaintainTarget] = useState(0);
  const [maintainMaxPerRun, setMaintainMaxPerRun] = useState(10);
  const [maintainConcurrency, setMaintainConcurrency] = useState(5);
  const [availableCount, setAvailableCount] = useState<number | null>(null);

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
        setDomainRotationEnabled(Boolean(data.domainRotationEnabled));
        setSavedDomainCount(
          (data.domains ?? "").split(",").filter((d) => d.trim()).length
        );
        if (data.proxy) setProxy(data.proxy);
        setProxyDisabled(Boolean(data.proxyDisabled));
        if (data.refreshUrl) setRefreshUrl(data.refreshUrl);
        if (data.refreshMinIntervalSeconds)
          setRefreshMinIntervalSeconds(data.refreshMinIntervalSeconds);
        if (data.refreshMinAttempts)
          setRefreshMinAttempts(data.refreshMinAttempts);
        setMaintainEnabled(Boolean(data.maintainEnabled));
        if (data.maintainGroupId) setMaintainGroupId(data.maintainGroupId);
        setMaintainTarget(data.maintainTarget ?? 0);
        if (data.maintainMaxPerRun) setMaintainMaxPerRun(data.maintainMaxPerRun);
        if (data.maintainConcurrency)
          setMaintainConcurrency(data.maintainConcurrency);
      },
      onError: () => toast.error("加载注册机配置失败"),
    }
  );

  useEffect(() => {
    loadConfig();
  }, []);

  // 查询维持目标分组当前可用数
  const { execute: fetchAvailable, isExecuting: isFetchingAvailable } =
    useAction(getGroupAvailableCountAction, {
      onSuccess: ({ data }) => {
        if (data) setAvailableCount(data.available);
      },
      onError: () => toast.error("查询可用数失败"),
    });

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
        setSavedDomainCount(data.domains.length);
        if (data.domains.length > 0 && !domain) {
          setDomain(data.domains[0]!);
        }
        // 查询即自动落库（供轮换域名使用），无需再点保存。
        toast.success(`获取并保存 ${data.domains.length} 个可用域名`);
      },
      onError: ({ error }) =>
        toast.error(`查询域名失败：${error.serverError ?? "未知错误"}`),
    }
  );

  // 收集完整配置（两处「保存配置」按钮共用，一次保存全部字段）
  function collectConfig() {
    return {
      apiKey,
      baseUrl,
      domain,
      domainRotationEnabled,
      proxy,
      proxyDisabled,
      refreshUrl,
      refreshMinIntervalSeconds,
      refreshMinAttempts,
      maintainEnabled,
      maintainGroupId,
      maintainTarget,
      maintainMaxPerRun,
      maintainConcurrency,
    };
  }

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
            <div className="flex items-center justify-between rounded-md border p-2.5">
              <span className="text-sm">
                轮换域名
                <span className="ml-2 text-xs text-muted-foreground">
                  已保存 {savedDomainCount} 个域名（点「查询可用域名」自动保存）
                </span>
              </span>
              <Switch
                checked={domainRotationEnabled}
                onCheckedChange={(v) => {
                  // 开关点击即时保存（仅该字段），避免忘点「保存配置」导致"没效果"。
                  setDomainRotationEnabled(v);
                  saveConfig({ domainRotationEnabled: v });
                }}
                disabled={running || savedDomainCount === 0 || isSavingConfig}
              />
            </div>
            {domainRotationEnabled && (
              <p className="text-xs text-muted-foreground">
                已开启：每一轮注册从已保存域名中轮换取一个不同域名。
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>代理地址</Label>
              <span className="flex items-center gap-2 text-sm font-normal">
                <span className="text-muted-foreground">禁用代理（直连本机 IP）</span>
                <Switch
                  checked={proxyDisabled}
                  onCheckedChange={(v) => {
                    setProxyDisabled(v);
                    saveConfig({ proxyDisabled: v });
                  }}
                  disabled={running || isSavingConfig}
                />
              </span>
            </div>
            <Input
              type="password"
              value={proxy}
              onChange={(e) => setProxy(e.target.value)}
              placeholder="http://user:pass@host:port"
              disabled={running || proxyDisabled}
            />
            {proxyDisabled && (
              <p className="text-xs text-muted-foreground">
                已禁用代理：注册走本机 IP，IP 刷新一并跳过。代理地址保留不变。
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>代理 IP 刷新地址</Label>
            <Input
              type="password"
              value={refreshUrl}
              onChange={(e) => setRefreshUrl(e.target.value)}
              placeholder="动态代理 IP 刷新 URL（GET 即换 IP，留空则不刷新）"
              disabled={running || proxyDisabled}
            />
            <p className="text-xs text-muted-foreground">
              GET 即换 IP。实际刷新取「最小间隔」与「最小尝试数」的慢者。
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>IP 刷新最小间隔（秒）</Label>
              <Input
                type="number"
                min={1}
                value={refreshMinIntervalSeconds}
                onChange={(e) =>
                  setRefreshMinIntervalSeconds(Math.max(1, Number(e.target.value)))
                }
                disabled={running || proxyDisabled}
              />
            </div>
            <div className="space-y-1.5">
              <Label>IP 刷新最小尝试数</Label>
              <Input
                type="number"
                min={1}
                value={refreshMinAttempts}
                onChange={(e) =>
                  setRefreshMinAttempts(Math.max(1, Number(e.target.value)))
                }
                disabled={running || proxyDisabled}
              />
            </div>
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
              onClick={() => saveConfig(collectConfig())}
              disabled={isSavingConfig || running}
            >
              {isSavingConfig ? "保存中..." : "保存配置"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 号池维持 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span>号池自动维持</span>
            <span className="flex items-center gap-2 text-sm font-normal">
              <span className="text-muted-foreground">启用</span>
              <Switch
                checked={maintainEnabled}
                onCheckedChange={(v) => {
                  setMaintainEnabled(v);
                  saveConfig({ maintainEnabled: v });
                }}
                disabled={running || isSavingConfig}
              />
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            开启后，定时任务会在目标分组可用 web 账号数低于目标值时自动注册补号
            （单轮最多注册「每轮上限」个，受 OpenAI 机房 IP 检测影响，靠多轮逼近）。
          </p>

          <div className="space-y-1.5">
            <Label>目标分组</Label>
            <div className="flex gap-2">
              <Select
                value={maintainGroupId}
                onValueChange={setMaintainGroupId}
                disabled={running}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="选择要维持的分组" />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  if (maintainGroupId) fetchAvailable({ groupId: maintainGroupId });
                }}
                disabled={!maintainGroupId || isFetchingAvailable || running}
              >
                {isFetchingAvailable ? "查询中..." : "查可用数"}
              </Button>
            </div>
            {availableCount !== null && (
              <p className="text-xs text-muted-foreground">
                当前可用：{availableCount} / 目标 {maintainTarget}
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>目标可用数</Label>
              <Input
                type="number"
                min={0}
                value={maintainTarget}
                onChange={(e) =>
                  setMaintainTarget(Math.max(0, Number(e.target.value)))
                }
                disabled={running}
              />
            </div>
            <div className="space-y-1.5">
              <Label>每轮上限</Label>
              <Input
                type="number"
                min={1}
                value={maintainMaxPerRun}
                onChange={(e) =>
                  setMaintainMaxPerRun(Math.max(1, Number(e.target.value)))
                }
                disabled={running}
              />
            </div>
            <div className="space-y-1.5">
              <Label>注册并发</Label>
              <Input
                type="number"
                min={1}
                value={maintainConcurrency}
                onChange={(e) =>
                  setMaintainConcurrency(Math.max(1, Number(e.target.value)))
                }
                disabled={running}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              type="button"
              onClick={() => saveConfig(collectConfig())}
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
            <div className="h-80 overflow-y-auto rounded-md border bg-muted p-3 font-mono text-xs leading-relaxed">
              {logs.map(({ id, line }) => (
                <div key={id}>{line}</div>
              ))}
              {running && (
                <div className="animate-pulse text-muted-foreground motion-reduce:animate-none">
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
