# Adobe Cookie Exporter

Chrome / Edge 浏览器扩展，用于导出 Adobe / Firefly 登录 cookie，供 GPT2Image Pro **Adobe 直连模式**导入账号。

导出格式与 admin 导入框兼容：

```json
{
  "cookie": "k1=v1; k2=v2",
  "headers": {
    "x-arp-session-id": "base64-json-value"
  }
}
```

`headers.x-arp-session-id` 仅在当前活动标签为已加载的 Firefly 页面、且页面中存在
Firefly session 数据时导出。GPT2Image Pro 导入后会将其保存在账号元数据中；当前
Express 生成请求与上游一致，不主动发送该字段。

## 安装

1. 打开 `chrome://extensions` 或 `edge://extensions`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本仓库目录 `tools/adobe-cookie-exporter/`

## 使用

1. 在浏览器登录 Adobe，并打开 `https://firefly.adobe.com/generate/image`
2. 点击扩展图标
3. 选择导出范围：
   - `Adobe domains (recommended)`（推荐）
   - `Current site`
4. 点击 `Export Minimal JSON`，保存 JSON 文件
5. 打开 admin → 图像后端池 → Adobe 后端（接入模式选「直连」）→ 粘贴 JSON 或其中的 `cookie` 字符串 →「导入并验证账号」

## 为什么需要插件

Adobe 的关键鉴权 cookie 多为 **HttpOnly**，控制台 `document.cookie` 读不到。本扩展通过 `chrome.cookies` API 读取完整 cookie jar，包含 IMS 刷新所需的会话项。

## 无痕模式

扩展从当前活动标签页所属的 cookie store 导出。若在无痕窗口使用 Adobe：

1. 在扩展详情页开启「在无痕模式下启用」
2. 在无痕窗口打开 Firefly 并登录
3. 从该无痕标签页打开扩展并导出

## 来源

移植自 [adobe2api](https://github.com/leik1000/adobe2api) 的 `browser-cookie-exporter`，格式与 `normalizeCookieString()` 一致。
