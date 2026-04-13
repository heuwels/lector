import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  devIndicators: false,
  // Turbopack is the default in Next.js 16. Empty config silences the
  // "webpack config but no turbopack config" warning.
  // Turbopack respects .gitignore so data/ (SQLite WAL files) is already ignored.
  turbopack: {},
};

export default nextConfig;
