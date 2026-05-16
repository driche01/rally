import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin the workspace root so Next stops picking the Expo app's
  // lockfile at the repo root. /web is its own world.
  outputFileTracingRoot: __dirname,
  // /shared lives outside /web. Next transpiles imports through the
  // alias defined in tsconfig.json. No extra config needed.
};

export default nextConfig;
