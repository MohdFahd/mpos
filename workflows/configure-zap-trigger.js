// configureZapTrigger - migrated from fastn v1 template templates#api#global#configureZapTrigger.
// True port of the v1 single-node graph ("zapConfig"), which returned the per-tenant
// Zap-trigger config template [{ id: "", connectorId: "", zaps: $fastn_array_default || [] }].
//
// In v1 the zaps field was wired to the getZaps option loader through widget uiCode
// (configs.selection.flowId = "getZaps"). v2 has no flow-level equivalent of that binding,
// so tenant scoping is enforced here: saved selections are validated against the calling
// tenant's OWN zap_subscriptions rows and anything else is dropped.

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

// v1 emitted "" placeholders for id / connectorId.
function strOrEmpty(v) {
  return v == null ? "" : String(v);
}

// getZaps options are { label, value } with value = webhook_url, but a saved config may
// hold the bare string. Accept both.
function selectedWebhookUrl(entry) {
  if (typeof entry === "string") return entry.trim();
  if (entry && typeof entry === "object") {
    const v = entry.value ?? entry.webhook_url ?? entry.webhookUrl;
    if (typeof v === "string") return v.trim();
  }
  return null;
}

export default async function (ctx) {
  const input = ctx.input || {};
  const tenantId = resolveTenantId(ctx);
  const saved = Array.isArray(input.zaps) ? input.zaps : [];

  let zaps = [];

  if (!tenantId) {
    // FAIL CLOSED. Without a tenant we cannot prove any saved webhook belongs to the
    // caller, so hand back an empty selection rather than echoing unverified values.
    console.warn(
      "configureZapTrigger: no tenant identity resolved (ctx.endOrgId and " +
      "headers['x-jwt-end-org-id'] are both empty) - returning an empty zaps selection"
    );
  } else {
    let owned = new Set();
    try {
      await fastn.db.query(ZAP_TABLE_DDL);
      await fastn.db.query(ZAP_TABLE_INDEX);
      const res = await fastn.db.query(
        "SELECT webhook_url FROM zap_subscriptions WHERE tenant_id = $1",
        [tenantId]
      );
      for (const r of asRows(res)) {
        if (r && typeof r.webhook_url === "string") owned.add(r.webhook_url.trim());
      }
    } catch (e) {
      // Fail closed: an unreadable ownership set must not become "allow everything".
      console.error(
        "configureZapTrigger: could not load this tenant's zap_subscriptions, returning an " +
        "empty selection: " + String(e?.message ?? e)
      );
      owned = new Set();
    }

    zaps = saved.filter((entry) => {
      const url = selectedWebhookUrl(entry);
      if (!url) return false;
      if (!owned.has(url)) {
        // v1's getZaps leaked other tenants' webhook URLs into this dropdown, so a saved
        // v1 config can legitimately contain a foreign value. Drop it, do not echo it.
        console.warn(
          "configureZapTrigger: dropping a saved zap selection not owned by this tenant"
        );
        return false;
      }
      return true;
    });
  }

  // v1 return shape, preserved exactly: a one-element array of { id, connectorId, zaps }.
  return [
    {
      id: strOrEmpty(input.id),
      connectorId: strOrEmpty(input.connectorId),
      zaps: zaps
    }
  ];
}