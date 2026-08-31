export default async function (ctx) {
  // Migrated from fastn v1 flow "salesforceGetLeads".
  // v1 ran a SOQL leads query on the Salesforce connector; v2 reads the unified
  // entity crm/lead (ue_db608c269407) with provider "salesforce".
  const PROVIDER = "salesforce";
  const PROVIDER_LABEL = "Salesforce";
  const DEFAULT_LIMIT = 50;
  const MAX_PAGE_SIZE = 200;

  const input = ctx.input || {};
  const rawLimit = Number(input.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(Math.trunc(rawLimit), MAX_PAGE_SIZE)
    : DEFAULT_LIMIT;
  const query = typeof input.query === "string" ? input.query.trim().toLowerCase() : "";
  // BUG FIX: v1 hardcoded "OFFSET 0" in the search SOQL, so search could never
  // paginate. Nothing is hardcoded here - the caller's cursor passes straight through.
  const cursor = typeof input.cursor === "string" && input.cursor.length ? input.cursor : undefined;

  // PROBED: unified list accepts only { provider, pageSize, cursor }. A search /
  // query / filter / q argument is accepted SILENTLY and ignored, so v1's search
  // branch becomes a client-side label filter. Over-fetch while searching.
  const pageSize = query ? Math.min(limit * 5, MAX_PAGE_SIZE) : limit;

  const toLabel = (rec) => {
    const d = (rec && rec.data) || {};
    const parts = [d.first_name, d.last_name].filter((v) => typeof v === "string" && v.trim().length);
    const name = parts.join(" ").trim();
    return name || (typeof d.email === "string" && d.email ? d.email : String(rec.id));
  };

  const listPage = (c) => fastn.unified.crm.lead.list({ provider: PROVIDER, pageSize, cursor: c });

  let page;
  try {
    page = await listPage(cursor);
  } catch (err) {
    const msg = String((err && err.message) || err);
    if (cursor && msg.includes("UNIFIED_CURSOR_INVALID")) {
      page = await listPage(undefined); // stale cursor -> restart from the first page
    } else if (msg.includes("UNIFIED_NO_CONNECTED_PROVIDER") || msg.includes("UNIFIED_UNSUPPORTED_ENTITY")) {
      return { options: [], searchable: true };
    } else if (
      msg.includes("UNIFIED_PROVIDER_AUTH_FAILED") ||
      (msg.includes("UNIFIED_PROVIDER_ERROR") && /INVALID_SESSION_ID|INVALID_TOKEN|expired|unauthor/i.test(msg))
    ) {
      // Salesforce surfaces an expired OAuth session as INVALID_SESSION_ID wrapped in
      // UNIFIED_PROVIDER_ERROR, not UNIFIED_PROVIDER_AUTH_FAILED - both are handled.
      // Provider credentials are dead. Deliberately NOT rethrown: a thrown option-loader
      // error reaches the caller as an opaque 422 / "reconnect Fastn API", pointing the
      // operator at the wrong system. Degrade to an empty list in the exact v1 output
      // shape and log the reason. No tokens or record data are logged.
      console.warn("[option-loader] " + PROVIDER_LABEL + " rejected the request - reconnect " + PROVIDER_LABEL + ". Returning no options.");
      return { options: [], searchable: true };
    } else {
      throw err;
    }
  }

  const records = Array.isArray(page && page.records) ? page.records : [];
  let options = records
    .filter((r) => r && r.id !== null && r.id !== undefined)
    .map((r) => ({ label: toLabel(r), value: String(r.id) }));
  if (query) options = options.filter((o) => o.label.toLowerCase().includes(query));
  if (options.length > limit) options = options.slice(0, limit);

  return { options, searchable: true };
}