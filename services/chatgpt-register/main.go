// chatgpt-register sidecar：在容器内用 wine 运行 ChatGPTRegister.exe 的薄执行器。
//
// 职责：接收 web 主应用的注册请求（moemail 配置 + 代理 + 数量/并发），在独立的
// 临时工作目录写入 config.yaml，spawn wine 跑注册机 exe，把 stdout/stderr 按行
// 以 SSE 流式回传，进程结束后读取 at.txt 把获得的 access token 一并回传。
//
// 边界与设计：
//   - 本服务不接触数据库、不持有任何长期密钥；moemail/代理凭据由 web 每次请求下发，
//     用完即随临时目录删除。token 的入库由 web 侧完成（DB 凭据不进本容器）。
//   - 单飞：同一时刻只允许一个注册任务运行（exe 受 OpenAI 限流约束，且避免 wine
//     资源争用），并发请求返回 409。
//   - 鉴权：X-Register-Secret 头与 CHATGPT_REGISTER_SECRET 恒定时间比对；未配置
//     secret 时拒绝所有请求（fail-closed），避免误暴露。
package main

import (
	"bufio"
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	defaultBind        = ":3023"
	defaultExePath     = "/app/ChatGPTRegister.exe"
	defaultWinePrefix  = "/home/app/.wine"
	defaultMaxCount    = 500
	defaultMaxConc     = 50
	defaultTimeoutSecs = 1800 // 注册批次整体超时（秒），防止 wine 卡死占用单飞槽
)

// registerRequest 为 web 下发的注册参数。
type registerRequest struct {
	Count          int    `json:"count"`
	Concurrency    int    `json:"concurrency"`
	MoemailBaseURL string `json:"moemailBaseUrl"`
	MoemailAPIKey  string `json:"moemailApiKey"`
	MoemailDomain  string `json:"moemailDomain"`
	Proxy          string `json:"proxy"`
}

type server struct {
	secret      string
	exePath     string
	winePrefix  string
	maxCount    int
	maxConc     int
	timeoutSecs int

	// running 单飞标志：同一时刻仅允许一个注册任务。
	mu      sync.Mutex
	running bool
}

func main() {
	s := &server{
		secret:      strings.TrimSpace(os.Getenv("CHATGPT_REGISTER_SECRET")),
		exePath:     envOr("CHATGPT_REGISTER_EXE_PATH", defaultExePath),
		winePrefix:  envOr("CHATGPT_REGISTER_WINE_PREFIX", defaultWinePrefix),
		maxCount:    envIntOr("CHATGPT_REGISTER_MAX_COUNT", defaultMaxCount),
		maxConc:     envIntOr("CHATGPT_REGISTER_MAX_CONCURRENCY", defaultMaxConc),
		timeoutSecs: envIntOr("CHATGPT_REGISTER_TIMEOUT_SECONDS", defaultTimeoutSecs),
	}

	bind := envOr("CHATGPT_REGISTER_BIND", defaultBind)

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.handleHealth)
	mux.HandleFunc("/register", s.handleRegister)

	log.Printf("chatgpt-register sidecar listening on %s (exe=%s prefix=%s)", bind, s.exePath, s.winePrefix)
	srv := &http.Server{
		Addr:    bind,
		Handler: mux,
		// 注册是长流式任务，写超时设为 0（无限），由 timeoutSecs 在 exe 层面兜底。
		ReadHeaderTimeout: 30 * time.Second,
	}
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("server error: %v", err)
	}
}

func (s *server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

// handleRegister 主入口：鉴权 → 单飞占用 → 写 config.yaml → 跑 wine → SSE 回传日志与 token。
func (s *server) handleRegister(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// 鉴权：fail-closed。未配置 secret 直接拒绝，避免内网误暴露。
	if s.secret == "" {
		http.Error(w, "secret not configured", http.StatusServiceUnavailable)
		return
	}
	if !constantTimeEqual(r.Header.Get("X-Register-Secret"), s.secret) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var req registerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if req.MoemailAPIKey == "" || req.MoemailDomain == "" {
		http.Error(w, "missing moemail config", http.StatusBadRequest)
		return
	}
	req.Count = clamp(req.Count, 1, s.maxCount)
	req.Concurrency = clamp(req.Concurrency, 1, s.maxConc)

	// 单飞占用：已有任务在跑则返回 409。
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		http.Error(w, "another registration is running", http.StatusConflict)
		return
	}
	s.running = true
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		s.running = false
		s.mu.Unlock()
	}()

	// SSE 响应头
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache, no-transform")
	h.Set("X-Accel-Buffering", "no")
	h.Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	flusher, _ := w.(http.Flusher)
	emit := func(event map[string]any) {
		payload, err := json.Marshal(event)
		if err != nil {
			return
		}
		_, _ = fmt.Fprintf(w, "data: %s\n\n", payload)
		if flusher != nil {
			flusher.Flush()
		}
	}

	s.runRegister(r, req, emit)
	emit(map[string]any{"type": "done"})
}

// runRegister 执行单次注册：独立临时工作目录 → config.yaml → wine exe → 流式日志 → 读 at.txt。
func (s *server) runRegister(r *http.Request, req registerRequest, emit func(map[string]any)) {
	workDir, err := os.MkdirTemp("", "chatgpt-register-*")
	if err != nil {
		emit(map[string]any{"type": "error", "message": "创建工作目录失败: " + err.Error()})
		return
	}
	// 临时目录含 moemail apiKey/代理凭据与 token，用完务必删除。
	defer os.RemoveAll(workDir)

	configPath := filepath.Join(workDir, "config.yaml")
	atPath := filepath.Join(workDir, "at.txt")
	if err := os.WriteFile(configPath, []byte(buildConfigYAML(req)), 0o600); err != nil {
		emit(map[string]any{"type": "error", "message": "写入配置失败: " + err.Error()})
		return
	}

	emit(map[string]any{"type": "log", "line": fmt.Sprintf("[注册机] 启动 %d 个账号，并发 %d", req.Count, req.Concurrency)})

	// 整体超时上下文：防止 wine 卡死长期占用单飞槽。
	ctx, cancel := context.WithTimeout(r.Context(), time.Duration(s.timeoutSecs)*time.Second)
	defer cancel()

	// wine 以 Z: 盘绝对路径调用 exe，cwd 设为工作目录，使 exe 对 config.yaml/at.txt
	// 等相对文件的读写都落在隔离的工作目录内。
	winePath := "Z:" + strings.ReplaceAll(s.exePath, "/", "\\")
	cmd := exec.CommandContext(ctx, "wine", winePath)
	cmd.Dir = workDir
	cmd.Env = append(os.Environ(),
		"WINEPREFIX="+s.winePrefix,
		"WINEARCH=win32",
		"WINEDEBUG=-all",
	)

	stdin, err := cmd.StdinPipe()
	if err != nil {
		emit(map[string]any{"type": "error", "message": "stdin 管道失败: " + err.Error()})
		return
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		emit(map[string]any{"type": "error", "message": "stdout 管道失败: " + err.Error()})
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		emit(map[string]any{"type": "error", "message": "stderr 管道失败: " + err.Error()})
		return
	}

	if err := cmd.Start(); err != nil {
		emit(map[string]any{"type": "error", "message": "启动 wine 失败: " + err.Error()})
		return
	}

	// 注册数量与并发通过 stdin 传入（exe 的交互式提示）。
	_, _ = stdin.Write([]byte(fmt.Sprintf("%d\n%d\n", req.Count, req.Concurrency)))
	_ = stdin.Close()

	// 并行读 stdout 与 stderr，按行 emit。
	var wg sync.WaitGroup
	wg.Add(2)
	streamLines := func(reader *bufio.Scanner, isStderr bool) {
		defer wg.Done()
		reader.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for reader.Scan() {
			line := strings.TrimSpace(reader.Text())
			if line == "" {
				continue
			}
			// 过滤 wine 自身噪声日志。
			if isStderr && (strings.HasPrefix(line, "wine:") || strings.HasPrefix(line, "fixme:") || strings.HasPrefix(line, "err:")) {
				continue
			}
			emit(map[string]any{"type": "log", "line": line})
		}
	}
	go streamLines(bufio.NewScanner(stdout), false)
	go streamLines(bufio.NewScanner(stderr), true)
	wg.Wait()

	if err := cmd.Wait(); err != nil {
		if ctx.Err() != nil {
			emit(map[string]any{"type": "log", "line": "[注册机] 已超时终止"})
		} else {
			emit(map[string]any{"type": "log", "line": "[注册机] 进程退出: " + err.Error()})
		}
	}

	// 读取 at.txt 抽出 eyJ 开头的 access token 回传。
	tokens := readTokens(atPath)
	emit(map[string]any{"type": "tokens", "tokens": tokens})
	emit(map[string]any{"type": "log", "line": fmt.Sprintf("[注册机] 获得 %d 个 access token", len(tokens))})
}

// buildConfigYAML 用转义后的字段拼出注册机 config.yaml（双引号标量）。
func buildConfigYAML(req registerRequest) string {
	domain := req.MoemailDomain
	baseURL := req.MoemailBaseURL
	if baseURL == "" {
		baseURL = "https://mail.52ai.org"
	}
	return fmt.Sprintf(`moemail:
  base_url: %q
  api_key: %q
  domains:
    - %q
  expiry_time: 3600000

tempmail:
  base_url: "https://mail.gpthotmail.com"
  api_key: ""
  domain: "mail.gpthotmail.com"

register:
  email_provider: "moemail"
  mail_file: "mail.txt"
  mail_state_file: "mail_state.txt"
  proxy: %q
  otp_timeout: 120
  client_version: "prod-3f327b5d73ca80c8edee280ace6683769bc8f8b1"
  client_build_number: "5438759"
  skip_oauth: true

cpa:
  enabled: false

panel:
  enabled: false
  base_url: "http://127.0.0.1:8000"
  bearer_token: ""
  plan_type: "free"
  proxy: ""
  remark: ""
`, baseURL, req.MoemailAPIKey, domain, req.Proxy)
}

// readTokens 从 at.txt 抽取 eyJ 开头的 access token（每行一个）。
func readTokens(atPath string) []string {
	data, err := os.ReadFile(atPath)
	if err != nil {
		return []string{}
	}
	tokens := []string{}
	for _, line := range strings.Split(string(data), "\n") {
		t := strings.TrimSpace(line)
		if strings.HasPrefix(t, "eyJ") {
			tokens = append(tokens, t)
		}
	}
	return tokens
}

func envOr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func envIntOr(key string, fallback int) int {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return fallback
}

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func constantTimeEqual(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}
