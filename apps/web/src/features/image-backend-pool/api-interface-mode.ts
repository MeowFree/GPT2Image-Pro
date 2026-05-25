import type {
  ImageBackendApiInterfaceMode,
  ImageBackendRequestKind,
} from "./types";

export function normalizeImageBackendApiInterfaceMode(
  value?: unknown
): ImageBackendApiInterfaceMode {
  if (value === "responses" || value === "mixed") return value;
  return "images";
}

export function imageBackendApiInterfaceAllowsRequest(
  value: unknown,
  requestKind: ImageBackendRequestKind
) {
  const mode = normalizeImageBackendApiInterfaceMode(value);
  if (mode === "images") {
    return requestKind === "image_generation" || requestKind === "image_edit";
  }
  return true;
}

export function imageBackendApiUsesResponsesEndpoint(
  value: unknown,
  requestKind?: ImageBackendRequestKind,
  forceResponsesEndpoint = false
) {
  if (forceResponsesEndpoint) {
    return normalizeImageBackendApiInterfaceMode(value) !== "images";
  }
  const mode = normalizeImageBackendApiInterfaceMode(value);
  if (mode === "responses") return true;
  if (mode === "mixed") {
    return requestKind === "chat" || requestKind === "responses";
  }
  return false;
}
