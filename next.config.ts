import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev server is reached over the VM's forwarded ports, not just localhost.
  allowedDevOrigins: ["127.0.0.1", "localhost", "0.0.0.0"],
};

export default nextConfig;
