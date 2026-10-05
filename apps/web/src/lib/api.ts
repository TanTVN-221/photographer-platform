import { systemInfoSchema, type SystemInfo } from "@photographer-platform/shared";

export type SystemInfoResult =
  | { readonly status: "available"; readonly data: SystemInfo }
  | { readonly status: "unavailable" };

export async function getSystemInfo(): Promise<SystemInfoResult> {
  const baseUrl = process.env.API_BASE_URL ?? "http://127.0.0.1:4000";

  try {
    const url = new URL("/api/v1/system", baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { status: "unavailable" };
    }

    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) {
      return { status: "unavailable" };
    }

    const parsed = systemInfoSchema.safeParse(await response.json());
    return parsed.success
      ? { status: "available", data: parsed.data }
      : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}
