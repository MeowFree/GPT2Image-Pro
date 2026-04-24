import type { StorageProvider } from "../types";

let cachedProvider: StorageProvider | null = null;

export async function getStorageProvider(): Promise<StorageProvider> {
  if (cachedProvider) return cachedProvider;

  if (process.env.STORAGE_ENDPOINT) {
    const { s3Provider } = await import("./s3");
    cachedProvider = s3Provider;
  } else {
    const { localProvider } = await import("./local");
    cachedProvider = localProvider;
  }

  return cachedProvider;
}
