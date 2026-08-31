export default async function (ctx) {
  const input = (ctx && ctx.input) ? ctx.input : {};

  const MAX_TOP = 50;              // Graph max page size for the chats endpoint
  const ENRICH_CONCURRENCY = 5;    // bound the DM N+1 fan-out
  const QUOTE = String.fromCharCode(39);

  // BUG FIX 2: OData escaping - a single quote is escaped by DOUBLING it.
  // v1 concatenated the raw value, so any apostrophe produced a 400 from Graph.
  function odataEscape(value) {
    return String(value).split(QUOTE).join(QUOTE + QUOTE);
  }

  function resolveTop(limit) {
    const n = Math.floor(Number(limit));
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.min(n, MAX_TOP);
  }

  // Parse the query string properly rather than regexing the URL blindly.
  // NOTE: a plus sign is intentionally NOT decoded to a space - the skiptoken
  // is base64-ish and a literal plus is significant.
  function extractSkipToken(nextLink) {
    if (typeof nextLink !== "string" || nextLink.length === 0) return null;
    const qIdx = nextLink.indexOf("?");
    if (qIdx === -1) return null;
    let qs = nextLink.slice(qIdx + 1);
    const hIdx = qs.indexOf("#");
    if (hIdx !== -1) qs = qs.slice(0, hIdx);
    const pairs = qs.split("&");
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      if (!pair) continue;
      const eq = pair.indexOf("=");
      const rawKey = (eq === -1) ? pair : pair.slice(0, eq);
      const rawVal = (eq === -1) ? "" : pair.slice(eq + 1);
      let key;
      try { key = decodeURIComponent(rawKey); } catch (e) { key = rawKey; }
      if (key !== "$skiptoken") continue;
      if (rawVal.length === 0) return null;
      try { return decodeURIComponent(rawVal); } catch (e) { return rawVal; }
    }
    return null;
  }

  // Stable, human-scannable disambiguator for a chat with no resolvable name.
  function shortRef(id) {
    let core = String(id === null || id === undefined ? "" : id);
    if (core.indexOf("19:") === 0) core = core.slice(3);
    const at = core.indexOf("@");
    if (at !== -1) core = core.slice(0, at);
    if (core.length > 16) return core.slice(0, 8) + "..." + core.slice(-4);
    return core;
  }

  function unwrap(res) {
    if (res && res.output && res.output.data) return res.output.data;
    if (res && res.output) return res.output;
    return res || {};
  }

  function nonEmpty(s) {
    return (typeof s === "string" && s.length > 0) ? s : null;
  }

  // ---- ONE call replaces v1's four near-duplicate nodes. getMe is gone (BUG FIX 3). ----
  const args = {};
  const top = resolveTop(input.limit);
  if (top !== null) args["$top"] = top;
  if (typeof input.cursor === "string" && input.cursor.length > 0) {
    args["$skiptoken"] = input.cursor;
  }
  if (typeof input.query === "string" && input.query.length > 0) {
    args["$filter"] = "startswith(topic," + QUOTE + odataEscape(input.query) + QUOTE + ")";
  }

  const res = await fastn.connector.microsoftTeams.listChats(args);
  const data = unwrap(res);
  const chats = Array.isArray(data.value) ? data.value : [];

  // BUG FIX 1: derive the cursor ONCE, here, from the page response.
  // v1 derived it inside the per-chat loop with the wrong casing, so a page
  // ending in a DM silently produced a null cursor.
  const cursor = extractSkipToken(data["@odata.nextLink"]);

  // ---- DM enrichment (N+1, preserved from v1), bounded concurrency ----
  const dmIndexes = [];
  for (let i = 0; i < chats.length; i++) {
    const c = chats[i];
    if (c && c.chatType === "oneOnOne") dmIndexes.push(i);
  }

  const enrichedNames = {};
  for (let i = 0; i < dmIndexes.length; i += ENRICH_CONCURRENCY) {
    const batch = dmIndexes.slice(i, i + ENRICH_CONCURRENCY);
    const settled = await Promise.all(batch.map(async function (idx) {
      const chat = chats[idx];
      const chatId = chat ? chat.id : null;
      if (!chatId) return [idx, null];
      try {
        const g = await fastn.connector.microsoftTeams.getChat({ chatId: chatId });
        const gd = unwrap(g);
        // v2 getChat returns the chat ENTITY: no value[] array, no displayName.
        // Primary read is the entity own topic; the v1 shape and a bare
        // displayName are kept only as defensive fallbacks.
        const name = nonEmpty(gd && gd.topic)
          || nonEmpty(gd && gd.value && gd.value[0] && gd.value[0].displayName)
          || nonEmpty(gd && gd.displayName);
        return [idx, name];
      } catch (e) {
        // A failed enrichment must not fail the page - fall back to the label default.
        return [idx, null];
      }
    }));
    for (let k = 0; k < settled.length; k++) {
      enrichedNames[settled[k][0]] = settled[k][1];
    }
  }

  const options = chats.map(function (c, i) {
    let label;
    if (c && c.chatType === "oneOnOne") {
      label = enrichedNames[i] || nonEmpty(c && c.topic) || ("Direct message (" + shortRef(c && c.id) + ")");
    } else {
      label = nonEmpty(c && c.topic) || ("Untitled chat (" + shortRef(c && c.id) + ")");
    }
    return { label: label, value: c ? c.id : null };
  });

  return { options: options, cursor: cursor };
}