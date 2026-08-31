// zapTriggerUnsubscribe - migrated from fastn v1 template templates#api#global#zapTriggerUnsubscribe.
// True port of the v1 graph (dataExtract -> DeleteTableZapsubscriptions -> Input).
// SECURITY FIX: v1 deleted by zap_id alone with no tenant predicate, so any caller who knew
// a zap_id could delete another tenant's subscription.

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

// Verified by live ctx probe: ctx = { input, headers, env, endOrgId, externalRef, attempt,
// isRetry }. x-jwt-org-id is the PARTNER org, not the customer - excluded on purpose.
function resolveTenantId(ctx) {
  const h = (ctx && ctx.headers) || {};
  const candidates = [ctx && ctx.endOrgId, h["x-jwt-end-org-id"]];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim() !== "") return c.trim();
  }
  return null;
}

function asRows(res) {
  const d = res?.output?.data ?? res?.output ?? res;
  if (Array.isArray(d)) return d;
  if (d && Array.isArray(d.rows)) return d.rows;
  return [];
}

// v1 dataExtract used the JINJA filter extract('(?:subscription:)?(backslash-d+)').
// [0-9] is the identical character class, written without a backslash.
const ZAP_ID_RE = /(?:subscription:)?([0-9]+)/;

function extractZapId(raw) {
  if (raw == null) return null;
  const m = String(raw).match(ZAP_ID_RE);
  return m ? m[1] : null;
}

export default async function (ctx) {
  const input = ctx.input || {};

  // FAIL CLOSED: never widen the DELETE predicate when the tenant is unknown.
  const tenantId = resolveTenantId(ctx);
  if (!tenantId) {
    throw new Error(
      "zapTriggerUnsubscribe: refusing to delete - no tenant identity on the request " +
      "(ctx.endOrgId and headers['x-jwt-end-org-id'] are both empty). v1 deleted by " +
      "zap_id alone, which let one tenant remove another tenant's subscription."
    );
  }

  // --- v1 dataExtract
  const zapId = extractZapId(input.zapId);
  if (!zapId) {
    throw new Error(
      "zapTriggerUnsubscribe: could not extract a numeric zapId from input.zapId=" +
      JSON.stringify(input.zapId ?? null)
    );
  }

  try {
    await fastn.db.query(ZAP_TABLE_DDL);
    await fastn.db.query(ZAP_TABLE_INDEX);
  } catch (e) {
    console.warn(
      "zapTriggerUnsubscribe: zap_subscriptions ensure failed: " + String(e?.message ?? e)
    );
  }

  // --- v1 DeleteTableZapsubscriptions, now tenant-scoped and parameterised.
  const res = await fastn.db.query(
    "DELETE FROM zap_subscriptions WHERE tenant_id = $1 AND zap_id = $2 RETURNING zap_id",
    [tenantId, zapId]
  );
  const deleted = asRows(res).length;

  if (deleted === 0) {
    // Not an error: Zapier retries unsubscribe, and a row owned by another tenant is
    // correctly invisible here. Log it so a real no-op is distinguishable.
    console.warn(
      "zapTriggerUnsubscribe: no row for this tenant with zap_id " + zapId +
      " (already removed, never subscribed, or owned by a different tenant)"
    );
  }

  // --- v1 Input node echoed the request body back. Preserved, with the normalised zapId
  // and a deleted count added.
  return { ...input, zapId, deleted };
}