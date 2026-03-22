import type { Request, Response, NextFunction } from "express";
import db from "../db.js";

export interface AuthContext {
  apiKeyId: string;
  tenantIds: string[];
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or malformed Authorization header" });
    return;
  }

  const key = header.slice(7);

  const row = db.prepare("SELECT id FROM api_keys WHERE key = ?").get(key) as
    | { id: string }
    | undefined;

  if (!row) {
    res.status(401).json({ error: "Invalid API key" });
    return;
  }

  const tenantRows = db
    .prepare("SELECT tenant_id FROM api_key_tenants WHERE api_key_id = ?")
    .all(row.id) as { tenant_id: string }[];

  req.auth = {
    apiKeyId: row.id,
    tenantIds: tenantRows.map((r) => r.tenant_id),
  };

  next();
}

/** Verify the destination belongs to a tenant this API key can access. */
export function assertDestinationAccess(destinationId: string, auth: AuthContext): boolean {
  const row = db
    .prepare("SELECT tenant_id FROM destinations WHERE id = ?")
    .get(destinationId) as { tenant_id: string } | undefined;

  if (!row) return false;
  return auth.tenantIds.includes(row.tenant_id);
}
