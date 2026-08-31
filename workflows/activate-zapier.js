export default async function (ctx) {
  // The 4 formerly-cloned template flows, now single SHARED published workflows.
  const REQUIRED = [
    { name: "zapTriggerSubscribe",   id: "wf_54f1be9428fe" },
    { name: "zapTriggerUnsubscribe", id: "wf_9ac953b55b72" },
    { name: "zapInputSchema",        id: "wf_b25146684f59" },
    { name: "configureZapTrigger",   id: "wf_f05792b60bed" }
  ];

  // --- Tenant identity. Nothing tenant-scoped is written (nothing is cloned any more),
  // but an activation call with no caller identity is still refused, for auditability.
  // NEVER x-jwt-org-id: that is the SaaS partner org, not the customer.
  const h = ctx.headers || {};
  const tenantId = ctx.endOrgId || h["x-jwt-end-org-id"] || null;
  if (!tenantId) {
    return {
      error: "NO_TENANT",
      message: "Activation refused: no tenant identity on the request (ctx.endOrgId and x-jwt-end-org-id both absent)."
    };
  }

  const plat = new Fastn({ connectors: { fastnPlatform: { orgId: "managed" } } });

  let all;
  try {
    const res = await plat.connector.fastnPlatform.listWorkflows({});
    const body = res.output;
    const arr = Array.isArray(body) ? body : (body && (body.data || body.workflows)) || [];
    all = Array.isArray(arr) ? arr : [];
  } catch (e) {
    return {
      error: "PLATFORM_UNAVAILABLE",
      message: "Activation refused: cannot reach the fastn platform API to verify the 4 shared " +
        "Zapier workflows. Connector 'fastnPlatform' has no active connection in this org and " +
        "must be connected first. Detail: " + String((e && e.message) || e)
    };
  }

  const byId = {};
  for (const w of all) if (w && w.id) byId[w.id] = w;

  const verified = [], missing = [], disabled = [];
  for (const req of REQUIRED) {
    const found = byId[req.id] || all.find(function (w) {
      return w && (w.name === req.name || w.slug === req.name);
    }) || null;

    if (!found) {
      missing.push({ name: req.name, expectedId: req.id });
      continue;
    }
    const entry = {
      name: req.name,
      expectedId: req.id,
      foundId: found.id || null,
      idMatches: found.id === req.id,
      enabled: found.enabled !== false,
      published: !!(found.devPublishedAt || found.livePublishedAt)
    };
    if (!entry.enabled) disabled.push(entry);
    verified.push(entry);
  }

  // Fail closed: a broken shared dependency must surface here, not at the customer's first Zap.
  if (missing.length > 0 || disabled.length > 0) {
    return {
      error: "ZAPIER_PREREQS_MISSING",
      message: "Activation refused for tenant " + tenantId + ": the shared Zapier workflows are " +
        "not all present and enabled (" + missing.length + " missing, " + disabled.length +
        " disabled). Nothing is cloned per tenant in v2, so these 4 shared flows are the " +
        "integration; Zapier would be broken for this tenant.",
      tenantId: tenantId, verified: verified, missing: missing, disabled: disabled
    };
  }

  return {
    message: "Activated Successfully!",
    tenantId: tenantId,
    cloned: [],
    verified: verified,
    note: "v2 clones nothing per tenant; the 4 shared published workflows were verified reachable."
  };
}