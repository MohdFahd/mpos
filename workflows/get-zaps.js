// getZaps - migrated from fastn v1 (widget option loader). SECURITY FIX: v1 returned
// every tenant's zap_subscriptions rows because its `WHERE tenant_id = ...` was commented
// out. v2 always applies a parameterised tenant predicate and fails closed.

const ZAP_TABLE_DDL = `CREATE TABLE IF NOT EXISTS zap_subscriptions (
  tenant_id    TEXT NOT NULL,
  zap_id       TEXT NOT NULL,
  zap_name     TEXT,
  webhook_url  TEXT NOT NULL,
  workspace_id TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, zap_id)
)`;

const ZAP_TABLE_INDEX = `CREATE INDEX IF NOT EXISTS zap_subscriptions_tenant_idx
  ON zap_subscriptions (tenant_id)`;

// Verified against a live ctx probe: ctx = { input, headers, env, endOrgId, externalRef,
// attempt, isRetry }. The tenant lives in ctx.endOrgId (platform-resolved end-org /
// installation binding) and, as the JWT claim, in ctx.headers["x-jwt-end-org-id"].
// x-jwt-org-id is the SaaS PARTNER org, NOT the customer - accepting it would merge all
// tenants into one bucket and re-open the v1 leak, so it is intentionally excluded.
function resolveTenantId(ctx) {
  const h = (ctx && ctx.headers) || {};
  const candidates = [ctx && ctx.endOrgId, h["x-jwt-end-org-id"]];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim() !== "") return c.trim();
  }
  return null;
}

// fastn.db.query returns a plain row array; unwrap defensively anyway.
function asRows(res) {
  const d = res?.output?.data ?? res?.output ?? res;
  if (Array.isArray(d)) return d;
  if (d && Array.isArray(d.rows)) return d.rows;
  return [];
}

export default async function (ctx) {
  const tenantId = resolveTenantId(ctx);

  // FAIL CLOSED. Never fall back to an unfiltered read.
  if (!tenantId) {
    console.warn(
      "getZaps: no tenant identity resolved (ctx.endOrgId and headers['x-jwt-end-org-id'] " +
      "are both empty) - returning zero options instead of every tenant's rows"
    );
    return { options: [] };
  }

  // Self-heal on a fresh org so a missing table yields empty options, not a widget error.
  try {
    await fastn.db.query(ZAP_TABLE_DDL);
    await fastn.db.query(ZAP_TABLE_INDEX);
  } catch (e) {
    console.warn("getZaps: zap_subscriptions ensure failed: " + String(e?.message ?? e));
  }

  let rows = [];
  try {
    const res = await fastn.db.query(
      "SELECT zap_id, zap_name, webhook_url FROM zap_subscriptions " +
      "WHERE tenant_id = $1 ORDER BY zap_name ASC, zap_id ASC",
      [tenantId]
    );
    rows = asRows(res);
  } catch (e) {
    // Fail closed on error too - an option loader must never leak on a degraded path.
    console.error("getZaps: query failed, failing closed: " + String(e?.message ?? e));
    return { options: [] };
  }

  const options = rows
    .filter((r) => r && typeof r.webhook_url === "string" && r.webhook_url.trim() !== "")
    .map((r) => ({
      // v1 mapped label <- zap_name, value <- webhook_url. zap_name is nullable, so fall
      // back to the zap id rather than rendering an empty dropdown entry.
      label: (r.zap_name != null && String(r.zap_name).trim() !== "")
        ? String(r.zap_name)
        : String(r.zap_id),
      value: r.webhook_url
    }));

  // v1 emitted exactly {options:[...]} - no cursor, no searchable. Keep that contract.
  return { options };
}