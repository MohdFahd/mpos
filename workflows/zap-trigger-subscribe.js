// zapTriggerSubscribe - migrated from fastn v1 template templates#api#global#zapTriggerSubscribe.
// True port of the v1 graph (dataExtract -> CreateTableZapSubscriptions -> message), with
// the write made tenant-scoped and the primary key made composite.

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

function str(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
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

  // FAIL CLOSED: refuse to write a row we cannot attribute to a tenant. v1 had no tenant
  // column at all, which is what let getZaps serve every tenant's webhook URLs.
  const tenantId = resolveTenantId(ctx);
  if (!tenantId) {
    throw new Error(
      "zapTriggerSubscribe: refusing to write - no tenant identity on the request " +
      "(ctx.endOrgId and headers['x-jwt-end-org-id'] are both empty). A zap subscription " +
      "must be attributable to exactly one tenant."
    );
  }

  // --- v1 dataExtract
  const zapId = extractZapId(input.zapId);
  const webhookUrl = str(input.webhookUrl);
  const zapName = str(input.zapAlias);
  const workspaceId = str(input.workspaceId);

  if (!zapId) {
    throw new Error(
      "zapTriggerSubscribe: could not extract a numeric zapId from input.zapId=" +
      JSON.stringify(input.zapId ?? null)
    );
  }
  if (!webhookUrl) {
    throw new Error("zapTriggerSubscribe: input.webhookUrl is required and must be non-empty");
  }

  // --- v1 CreateTableZapSubscriptions (idempotent DDL, then upsert)
  await fastn.db.query(ZAP_TABLE_DDL);
  await fastn.db.query(ZAP_TABLE_INDEX);

  // ON CONFLICT is on the COMPOSITE key. v1 conflicted on zap_id alone, so tenant B
  // subscribing a zap_id tenant A already held would overwrite A's webhook_url.
  await fastn.db.query(
    "INSERT INTO zap_subscriptions " +
    "(tenant_id, zap_id, zap_name, webhook_url, workspace_id) " +
    "VALUES ($1, $2, $3, $4, $5) " +
    "ON CONFLICT (tenant_id, zap_id) DO UPDATE SET " +
    "webhook_url = EXCLUDED.webhook_url, " +
    "zap_name = COALESCE(EXCLUDED.zap_name, zap_subscriptions.zap_name), " +
    "workspace_id = COALESCE(EXCLUDED.workspace_id, zap_subscriptions.workspace_id), " +
    "updated_at = now()",
    [tenantId, zapId, zapName, webhookUrl, workspaceId]
  );

  const check = await fastn.db.query(
    "SELECT zap_id FROM zap_subscriptions WHERE tenant_id = $1 AND zap_id = $2",
    [tenantId, zapId]
  );
  if (asRows(check).length !== 1) {
    throw new Error("zapTriggerSubscribe: upsert did not persist zap_id " + zapId);
  }

  // --- v1 message node: {"msg": "<zapName> subscribed!"}. zapName is nullable in practice,
  // so fall back to the zap id instead of rendering a null into the sentence.
  return { msg: (zapName || zapId) + " subscribed!" };
}