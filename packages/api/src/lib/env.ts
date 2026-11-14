import { createHash } from "node:crypto";
import { logger } from "./logger.js";

interface EnvCheck {
  key: string;
  required: boolean;
  condition?: () => boolean; // only required when condition returns true
  hint?: string;
}

const checks: EnvCheck[] = [
  { key: "DATABASE_URL", required: true, hint: "PostgreSQL connection string" },
  { key: "CORS_ORIGINS", required: false, hint: "Comma-separated allowed origins (e.g. https://app.hisaabo.in)" },
  { key: "APP_URL", required: false, hint: "Frontend URL for magic link emails" },
  {
    key: "API_PUBLIC_URL",
    required: false,
    hint: "Public base URL of this API (http:// or https://), used for absolute links and webhooks",
  },
  { key: "ALLOW_OPEN_SIGNUP", required: false, hint: "Set to \"true\" to let anyone register on a self-hosted server (default: invite-only after the first owner)" },
  {
    key: "ENCRYPTION_KEY",
    required: false,
    hint: "Required for field-level encryption of sensitive credentials",
  },
  {
    key: "RESEND_API_KEY",
    required: false,
    hint: "Optional email sending API key (magic links, invites)",
  },
];

export function isValidEncryptionKey(key: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(key);
}

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Validate required environment variables at startup.
 * Logs warnings for missing optional vars, throws for required vars.
 */
export function validateEnv(): void {
  // Auto-derive API_PUBLIC_URL from APP_URL or default
  if (!process.env.API_PUBLIC_URL) {
    process.env.API_PUBLIC_URL = process.env.APP_URL || "https://veparibook.onrender.com";
  }

  // Auto-derive valid 64-hex ENCRYPTION_KEY if not explicitly provided
  if (!process.env.ENCRYPTION_KEY || !isValidEncryptionKey(process.env.ENCRYPTION_KEY)) {
    const seed = process.env.SESSION_SECRET || process.env.JWT_SECRET || process.env.DATABASE_URL || "vrunda_infotech_encryption_seed";
    process.env.ENCRYPTION_KEY = createHash("sha256").update(seed).digest("hex");
    logger.info("Auto-configured 64-hex ENCRYPTION_KEY derived from environment secret");
  }

  const errors: string[] = [];

  for (const check of checks) {
    const value = process.env[check.key];
    const isRequired = check.required || (check.condition ? check.condition() : false);

    if (!value) {
      if (isRequired) {
        errors.push(`${check.key} is required. ${check.hint || ""}`);
      } else if (check.hint) {
        logger.warn({ key: check.key }, `${check.key} not set — ${check.hint}`);
      }
    }
  }

  const encKey = process.env.ENCRYPTION_KEY;
  const needsStrictKey = process.env.NODE_ENV === "production" || process.env.MULTI_TENANT === "true";
  if (encKey && needsStrictKey && !isValidEncryptionKey(encKey)) {
    errors.push("ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes) in production and multi-tenant mode.");
  }

  const publicUrl = process.env.API_PUBLIC_URL;
  if (publicUrl && process.env.NODE_ENV === "production" && !isValidHttpUrl(publicUrl)) {
    errors.push("API_PUBLIC_URL must be a valid http:// or https:// URL.");
  }

  if (errors.length > 0) {
    for (const err of errors) logger.error(err);
    throw new Error(`Missing required environment variables:\n  ${errors.join("\n  ")}`);
  }

  logger.info("Environment validation passed");
}
