import type {
  ChatCompletionsUpstreamMode,
  ImageBackendApiInterfaceMode,
  ImageBackendRequestKind,
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
  return value === "chat_completions" ? "chat_completions" : "responses";
}

export function imageBackendApiInterfaceAllowsRequest(
  value: unknown,
  requestKind: ImageBackendRequestKind
) {
  const mode = normalizeImageBackendApiInterfaceMode(value);
  if (mode === "images") {
    return requestKind === "image_generation" || requestKind === "image_edit";
  }
  if (mode === "responses") {
    return requestKind === "chat" || requestKind === "responses";
  }
  return true;
}

export function imageBackendApiUsesResponsesEndpoint(
  value: unknown,
  requestKind?: ImageBackendRequestKind,
  forceResponsesEndpoint = false
) {
  if (forceResponsesEndpoint) {
    return (
      normalizeImageBackendApiInterfaceMode(value) !== "images" &&
      requestKind !== "image_generation" &&
      requestKind !== "image_edit"
    );
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
