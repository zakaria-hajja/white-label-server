import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@node-rs/argon2", "pino"],
  poweredByHeader: false,
};

export default nextConfig;
