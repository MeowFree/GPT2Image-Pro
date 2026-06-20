# Adobe Firefly 视频接口规格（移植自 adobe2api，用于 firefly-direct 视频实现）

> 来源：调研 adobe2api（Python）的视频路径，提炼协议规格用于在本仓库 firefly-direct
> 直连实现。仅记录接口契约（端点/字段/枚举），不照搬代码。日期：2026-06-20。
> 参考文件（adobe2api）：`core/adobe_client.py`、`core/models/catalog.py`、
> `core/models/resolver.py`、`api/routes/generation.py`。

## 1. 视频模型目录

model-id 格式：`firefly-{family}-{dur}s-{ratio}[-{res}]`；ratio 后缀 `1:1→1x1, 16:9→16x9, 9:16→9x16`。

| family | model-id 格式 | 时长(s) | 比例 | 分辨率 | upstream `model` | `modelId` | `modelVersion` | engine/flags |
|---|---|---|---|---|---|---|---|---|
| sora2 | `firefly-sora2-{d}s-{ratio}` | 4,8,12 | 9:16,16:9 | 720p 固定 | `openai:firefly:colligo:sora2`（待核 base vs pro） | `sora` | `sora-2` | sora2 |
| sora2-pro | `firefly-sora2-pro-{d}s-{ratio}` | 4,8,12 | 9:16,16:9 | 720p | `openai:firefly:colligo:sora2-pro` | `sora` | `sora-2` | sora2 |
| veo31 | `firefly-veo31-{d}s-{ratio}-{res}` | 4,6,8 | 16:9,9:16 | 1080p,720p | `google:firefly:colligo:veo31` | `veo` | `3.1-generate` | `veo31-standard` |
| veo31-ref | `firefly-veo31-ref-{d}s-{ratio}-{res}` | 4,6,8 | 16:9,9:16 | 1080p,720p | `google:firefly:colligo:veo31` | `veo` | `3.1-generate` | `veo31-standard` + `reference_mode:"image"` |
| veo31-fast | `firefly-veo31-fast-{d}s-{ratio}-{res}` | 4,6,8 | 16:9,9:16 | 1080p,720p | `google:firefly:colligo:veo31-fast` | `veo` | `3.1-fast-generate` | `veo31-fast` |
| kling-o3 | `firefly-kling-o3-{d}s-{ratio}` | 5,15 | 16:9,9:16 | 1080p 固定 | `kling:firefly:colligo:o3` | `kling` | `kling_o3_pro_reference_to_video` | `kling-o3` |
| kling3 | `firefly-kling3-{d}s-{ratio}` | 5,10,15 | 16:9,9:16 | 720p 固定 | `kling:firefly:colligo:3.0` | `kling` | `kling_v3_standard_i2v` | `kling3` + `generate_audio:true` |

## 2. Adobe Firefly 上游视频 API（host `https://firefly-3p.ff.adobe.io`）

- **提交（异步）**：`POST /v2/3p-videos/generate-async` → 返回 job；**轮询地址取响应头 `x-override-status-link`**，回退 JSON `links.result`。
- **轮询**：`GET {poll_url}`，每 3.0s，默认超时 600s；状态读 JSON `status`（或头 `x-task-status`）。
  - 进行中：`IN_PROGRESS/RUNNING/PROCESSING/PENDING/QUEUED/STARTED`
  - 失败终态：`FAILED/CANCELLED/ERROR`
  - 成功：`outputs` 数组非空时判定成功。
- **结果**：视频 URL = `outputs[0].video.presignedUrl`；`GET {presignedUrl}`（`accept: */*`）取字节。
- **图片上传（i2v 首帧/尾帧/参考）**：`POST /v2/storage/image`（原始字节 + mime）→ id 取 `data.images[0].id`。

### 鉴权头（提交）
```
Authorization: Bearer {ims_token}
x-api-key: {api_key}            # 生成用的 api_key（与 credits 调用的 SunbreakWebUI1 是否同值待核）
content-type: application/json
accept: */*
x-arp-session-id: {generated}
```
+ 浏览器伪装头（user-agent、sec-ch-ua、origin/referer = `https://firefly.adobe.com/`）。无请求签名。
IMS token 与图像路径同源（`ims/check/v6/token`，`client_id=clio-playground-web`）。

### 提交体（关键字段）
`n`、`seeds:[seed]`、`seed:str`、`modelId`、`model`(upstream)、`modelVersion`、`size:{width,height}`、
`duration`、`fps:24`、`prompt`、`negativePrompt`、`generateAudio:bool`、`generateLoop`、
`transparentBackground`、`locale`、`camera`、`jobMode:"standard"`、
`generationMetadata:{module:"text2video"|"image2video"}`、`referenceBlobs`、`referenceFrames`、`output`。

### size 映射
720p：16:9→1280×720，9:16→720×1280；1080p：16:9→1920×1080，9:16→1080×1920。

## 3. 与图像路径的差异
图像 `POST /v2/3p-images/generate-async`，视频 `POST /v2/3p-videos/generate-async`——**同构**（submit→poll→download、`x-override-status-link` 轮询、`/v2/storage/image` 上传、referenceBlobs）。视频增加 `duration/fps/generateAudio/referenceFrames` 与视频专属 `modelId/modelVersion/engine`，结果读 `outputs[0].video.presignedUrl`。

## 4. 图生视频输入挂载（先上传 /v2/storage/image 拿 id）
- **Sora2**：`referenceBlobs:[{id, usage:"general", promptReference:1}]`；`referenceFrames:[{localBlobRef:first}, null]`，首+尾帧时第二槽 `{localBlobRef:last}`。
- **Veo31/veo31-ref**：同 referenceBlobs/frames；veo31-ref 加 `reference_mode:"image"`。
- **Kling(o3/3.0)**：帧 `referenceBlobs:[{id, usage:"frame", order:idx}]`；kling-o3 实体引用 `{usage:"element", creativeCloudFileId:urn, mention:{id}}`。
- 上传前按目标比例+分辨率 letterbox 缩放。

## 5. 待核校点（移植时验证）
- base-sora2 vs sora2-pro 的 upstream `model` 串；
- 生成用 `x-api-key` 具体值（config 驱动）；
- `generationMetadata.module` 在非 Kling 引擎、有输入帧时是否翻成 `image2video`（Kling 已确认，其余条件性）。

## 6. 本仓库落地计划（firefly-direct 视频）
1. `firefly-direct/video-catalog.ts`：上表的纯数据 catalog + `resolveFireflyVideoModel(id)`。
2. `firefly-direct/client.ts`：`generateVideo()`（submit→poll→download，复用 transport/IMS）。
3. `video_generation` 表 + 迁移（status/model/duration/ratio/resolution/输入图引用/storageKey/credits）。
4. `adobe-direct.ts`：视频派发（i2v 先 upload 再 referenceBlobs/frames）。
5. 计费：**30 积分/秒**统一基价 + **按模型倍率**（config）；接 credits（预扣/结算/退款，幂等 sourceRef）。
6. 创作页视频 tab（选模型+时长+比例[+分辨率]；图生视频 @ 历史图）。
7. v1 视频 API 端点。
