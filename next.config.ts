import type { NextConfig } from "next";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

/* ── Manual .env.local loading ──────────────────────────────
   Turbopack in git worktrees sometimes resolves the wrong root
   directory for .env.local. This manually loads environment
   variables from the worktree's own .env.local to ensure they
   are available to server routes.
   ────────────────────────────────────────────────────────── */
const envPath = resolve(__dirname, ".env.local");
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

const nextConfig: NextConfig = {
  devIndicators: false, // hide "Rendering" indicator in dev mode
};

export default nextConfig;
