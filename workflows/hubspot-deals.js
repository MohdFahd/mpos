export default async function (ctx) {
  // Migrated from fastn v1 flow "hubspotDeals".
  // v1 called the HubSpot connector directly; v2 reads the unified entity
  // crm/opportunity (ue_c89f86935426) with provider "hubspot".
  const PROVIDER = "hubspot";
  const PROVIDER_LABEL = "HubSpot";
  const DEFAULT_LIMIT = 50;
  const MAX_PAGE_SIZE = 200;

  const input = ctx.input || {};
  // BUG FIX: v1 hardcoded limit:100 and ignored the caller's limit.
  const rawLimit = Number(input.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(Math.trunc(rawLimit), MAX_PAGE_SIZE)
    : DEFAULT_LIMIT;
  const query = typeof input.query === "string" ? input.query.trim().toLowerCase() : "";
  const cursor = typeof input.cursor === "string" && input.cursor.length ? input.cursor : undefined;

  // PROBED: unified list accepts only { provider, pageSize, cursor }. A search /
  // query / filter / q argument is accepted SILENTLY and ignored, so v1's search
  // branch becomes a client-side label filter. Over-fetch while searching.
  const pageSize = query ? Math.min(limit * 5, MAX_PAGE_SIZE) : limit;

  const toLabel = (rec) => {
    const d = (rec && rec.data) || {};
    return typeof d.name === "string" && d.name.trim().length ? d.name.trim() : String(rec.id);
  };

  const listPage = (c) => fastn.unified.crm.opportunity.list({ provider: PROVIDER, pageSize, cursor: c });

  let page;
  try {
    page = await listPage(cursor);
  } catch (err) {
    const msg = String((err && err.message) || err);
    if (cursor && msg.includes("UNIFIED_CURSOR_INVALID")) {
      page = await listPage(undefined); // stale cursor -> restart from the first page
    } else if (msg.includes("UNIFIED_NO_CONNECTED_PROVIDER") || msg.includes("UNIFIED_UNSUPPORTED_ENTITY")) {
      // BUG FIX: searchable is boolean true on EVERY branch (v1 emitted "true" here).
      return { options: [], cursor: null, searchable: true };
    } else if (
      msg.includes("UNIFIED_PROVIDER_AUTH_FAILED") ||
      (msg.includes("UNIFIED_PROVIDER_ERROR") && /INVALID_SESSION_ID|INVALID_TOKEN|expired|unauthor/i.test(msg))
    ) {
      // Provider credentials are dead. Deliberately NOT rethrown: a thrown option-loader
      // error reaches the caller as an opaque 422 / "reconnect Fastn API", pointing the
      // operator at the wrong system. Degrade to an empty list in the exact v1 output
      // shape and log the reason. No tokens or record data are logged.
      console.warn("[option-loader] " + PROVIDER_LABEL + " rejected the request - reconnect " + PROVIDER_LABEL + ". Returning no options.");
      return { options: [], cursor: null, searchable: true };
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

  return { options, cursor: (page && page.nextCursor) || null, searchable: true };
}