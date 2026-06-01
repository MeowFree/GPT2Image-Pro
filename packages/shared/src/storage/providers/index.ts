import type { StorageProvider } from "../types";

/**
 * 进程级 provider 单例缓存
 *
 * 注意：缓存一旦写入即永不失效。选择依据 STORAGE_ENDPOINT 与 S3 凭证均来自
 * 运行时设置（getRuntimeSettingString，可经管理后台修改），因此在 local 与
 * S3 之间切换或轮换存储密钥后，运行进程仍会沿用旧 provider/凭证——须重启进程
 * 才会生效。多实例部署下各实例的缓存也可能不一致。
 */
let cachedProvider: StorageProvider | null = null;

/**
 * 获取存储提供者（单例）
 *
 * 据 STORAGE_ENDPOINT 是否配置在 S3 与本地存储间选择，首次解析后缓存。
 * 改动存储相关运行时设置（端点/凭证）需重启进程方可生效，详见 cachedProvider 注释。
 */
export async function getStorageProvider(): Promise<StorageProvider> {
  if (cachedProvider) return cachedProvider;

  const { getRuntimeSettingString } = await import("../../system-settings");
  if (await getRuntimeSettingString("STORAGE_ENDPOINT")) {
    const { s3Provider } = await import("./s3");
    cachedProvider = s3Provider;
  } else {
    const { localProvider } = await import("./local");
    cachedProvider = localProvider;
  }

  return cachedProvider;
}
