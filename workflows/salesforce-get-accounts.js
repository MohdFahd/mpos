export default async function (ctx) {
  // Migrated from fastn v1 flow "salesForceGetAccounts" (capital F kept from v1).
  // v1 queried the Salesforce connector directly; v2 reads the unified entity
  // crm/account (ue_47ee13bea1d9) with provider "salesforce".
  //
  // This is the only one of the nine migrated loaders with NO search branch in v1,
  // so none is added and no "searchable" flag is emitted. Output is { options } only.
  const PROVIDER = "salesforce";
  const PROVIDER_LABEL = "Salesforce";
  const DEFAULT_LIMIT = 50;
  const MAX_PAGE_SIZE = 200;

  const input = ctx.input || {};
  const rawLimit = Number(input.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(Math.trunc(rawLimit), MAX_PAGE_SIZE)
    : DEFAULT_LIMIT;
  // No hardcoded offset / first-page pin: the caller's cursor passes straight through.
  const cursor = typeof input.cursor === "string" && input.cursor.length ? input.cursor : undefined;

  const toLabel = (rec) => {
    const d = (rec && rec.data) || {};
    return typeof d.name === "string" && d.name.trim().length ? d.name.trim() : String(rec.id);
  };

  const listPage = (c) => fastn.unified.crm.account.list({ provider: PROVIDER, pageSize: limit, cursor: c });

  let page;
  try {
    page = await listPage(cursor);
  } catch (err) {
    const msg = String((err && err.message) || err);
    if (cursor && msg.includes("UNIFIED_CURSOR_INVALID")) {
      page = await listPage(undefined); // stale cursor -> restart from the first page
    } else if (msg.includes("UNIFIED_NO_CONNECTED_PROVIDER") || msg.includes("UNIFIED_UNSUPPORTED_ENTITY")) {
      return { options: [] }; // nothing connected yet
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
      return { options: [] };
    } else {
      throw err;
    }
  }

  const records = Array.isArray(page && page.records) ? page.records : [];
  let options = records
    .filter((r) => r && r.id !== null && r.id !== undefined)
    .map((r) => ({ label: toLabel(r), value: String(r.id) }));
  if (options.length > limit) options = options.slice(0, limit);

  return { options };
}