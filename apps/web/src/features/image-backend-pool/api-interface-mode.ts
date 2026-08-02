import type {
  ChatCompletionsUpstreamMode,
  ImageBackendApiInterfaceMode,
  ImageBackendRequestKind,
  ImagesUpstreamMode,
} from "./types";

export function normalizeImageBackendApiInterfaceMode(
  value?: unknown
): ImageBackendApiInterfaceMode {
  if (value === "responses" || value === "mixed") return value;
  return "images";
}

export function normalizeChatCompletionsUpstreamMode(
  value?: unknown
): ChatCompletionsUpstreamMode {
  if (value === "chat_completions" || value === "images") return value;
  return "responses";
}

export function normalizeImagesUpstreamMode(
  value?: unknown
): ImagesUpstreamMode {
  return value === "responses" ? "responses" : "images";
}

function isImageRequestKind(requestKind?: ImageBackendRequestKind) {
  return requestKind === "image_generation" || requestKind === "image_edit";
}

export function imageBackendApiInterfaceAllowsRequest(
  value: unknown,
  requestKind: ImageBackendRequestKind,
  imagesUpstreamMode?: unknown,
  chatCompletionsUpstreamMode?: unknown
) {
  const mode = normalizeImageBackendApiInterfaceMode(value);
  if (isImageRequestKind(requestKind)) {
    const imageMode = normalizeImagesUpstreamMode(imagesUpstreamMode);
    if (imageMode === "responses") return mode !== "images";
    return mode !== "responses";
  }
  if (
    requestKind === "chat" &&
    normalizeChatCompletionsUpstreamMode(chatCompletionsUpstreamMode) ===
      "images"
  ) {
    return mode !== "responses";
  }
  if (mode === "images") {
    return false;
  }
  if (mode === "responses") {
    return requestKind === "chat" || requestKind === "responses";
  }
  return true;
}

export function imageBackendApiUsesResponsesEndpoint(
  value: unknown,
  requestKind?: ImageBackendRequestKind,
  forceResponsesEndpoint = false,
  imagesUpstreamMode?: unknown
) {
  if (isImageRequestKind(requestKind)) {
    return (
      normalizeImagesUpstreamMode(imagesUpstreamMode) === "responses" &&
      normalizeImageBackendApiInterfaceMode(value) !== "images"
    );
  }
  if (forceResponsesEndpoint) {
    return normalizeImageBackendApiInterfaceMode(value) !== "images";
  }
  const mode = normalizeImageBackendApiInterfaceMode(value);
  if (mode === "responses") {
    return requestKind === "chat" || requestKind === "responses";
  }
  if (mode === "mixed") {
    return requestKind === "chat" || requestKind === "responses";
  }
  return false;
}
