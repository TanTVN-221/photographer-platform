function bareHttpOrigin(value: string): URL | null {
  try {
    const url = new URL(value);
    return (["http:", "https:"].includes(url.protocol) && url.username === "" && url.password === "" &&
      url.pathname === "/" && url.search === "" && url.hash === "") ? url : null;
  } catch {
    return null;
  }
}

export function resolveGalleryApiConfig(): { readonly web: URL; readonly internalApi: URL; readonly publicApi: URL } | null {
  const web = bareHttpOrigin(process.env.PUBLIC_WEB_BASE_URL ?? "http://127.0.0.1:3000");
  const publicApi = bareHttpOrigin(process.env.PUBLIC_API_BASE_URL ?? "http://127.0.0.1:4000");
  const internalApi = bareHttpOrigin(process.env.API_BASE_URL ?? "http://127.0.0.1:4000");
  if (web === null || publicApi === null || internalApi === null ||
    web.hostname !== publicApi.hostname || web.protocol !== publicApi.protocol) return null;
  if (web.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(web.hostname)) return null;
  return { web, internalApi, publicApi };
}
