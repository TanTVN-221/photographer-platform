import type { NextConfig } from "next";
import { webSecurityHeaders } from "./src/lib/browser-security";

const nextConfig: NextConfig = {
  transpilePackages: ["@photographer-platform/ui"],
  poweredByHeader: false,
  async headers() {
    // Nonce CSP is request-specific in Proxy; other headers cover assets too.
    return [{ source: "/:path*", headers: [...webSecurityHeaders] }];
  },
};

export default nextConfig;
