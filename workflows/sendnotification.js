export default async function (ctx) {
  const input = ctx.input || {};
  const ids = Array.isArray(input.ids) ? input.ids : [];
  if (!ids[0]) return { code: "BAD_REQUEST", message: "input.ids[] missing." };

  // Community connectors must be declared (managed scope)
  const conn = new Fastn({
    connectors: {
      coda: { orgId: "managed" },
      airtable: { orgId: "managed" },
      googleSheets: { orgId: "managed" },
      googleDocs: { orgId: "managed" },
      snowflake: { orgId: "managed" },
      trello: { orgId: "managed" },
      hubspot: { orgId: "managed" },
      salesforce: { orgId: "managed" },
      zohoCrm: { orgId: "managed" },
      triggerdev: { orgId: "managed" },
      notion: { orgId: "managed" }
    }
  });

  const ERR1 = "Signal could not be delivered to the";
  const ERR2 = ". Please verify the configuration settings for the delivery connector.";
  const tenantId = ctx.headers?.["x-end-org-id"] || ctx.headers?.["x-fastn-space-tenantid"] || "unknown";

  // ---- v1 getData: pick signal payload ----
  const md = input.metadata;
  const mdHasKeys = md && typeof md === "object" && Object.keys(md).length > 0;
  const signalData = (mdHasKeys && Array.isArray(md.signals) && md.signals[0])
    ? md.signals[0]
    : { subject: input.message ? input.message.subject : "", content: input.message ? input.message.content : "" };
  const msgSubject = input.message?.subject ?? "";
  const msgContent = input.message?.content ?? "";

  // ---- internal DB (workspace Postgres) ----
  await fastn.db.query("CREATE TABLE IF NOT EXISTS perigon_errors_v2 (id serial primary key, error jsonb)");
  await fastn.db.query("CREATE TABLE IF NOT EXISTS perigon_signals_v2 (msgid varchar(250) primary key, signalid varchar(250) NOT NULL)");
  await fastn.db.query("CREATE TABLE IF NOT EXISTS perigon_tenant_resources_v2 (tenantid text NOT NULL, connector text NOT NULL, resource text, extra text, PRIMARY KEY (tenantid, connector))");

  const errors = [];   // [{connector, message}]
  const delivered = []; // [{connector, resource}]

  async function storeRawError(payload) {
    try { await fastn.db.query("insert into perigon_errors_v2 values(default, $1)", [JSON.stringify(payload ?? null)]); } catch (e) { /* non-fatal */ }
  }
  async function fail(connectorName, resourceNoun, label, rawErr) {
    errors.push({ connector: connectorName, message: `${ERR1} ${resourceNoun} '${label}' ${ERR2}` });
    await storeRawError({ connector: connectorName, resource: resourceNoun, label, error: String(rawErr && rawErr.message ? rawErr.message : rawErr) });
  }
  const arr = (x) => Array.isArray(x) ? x : (x && typeof x === "object" && x.value !== undefined ? [x] : []);

  // ---- render via the returnTemplatedData v2 workflow (verbatim v1 templates) ----
  const rtdCache = {};
  async function rtd(args) {
    const key = JSON.stringify([args.templateType || "", args.connectorId || ""]);
    if (!(key in rtdCache)) {
      rtdCache[key] = await fastn.flow.invoke("returntemplateddata", { templateType: args.templateType || "", connectorId: args.connectorId || "", data: args.data, metadata: args.metadata });
    }
    return rtdCache[key];
  }
  async function rtdFresh(args) { // uncached (per-event rendering in CRM branches)
    return await fastn.flow.invoke("returntemplateddata", { templateType: args.templateType || "", connectorId: args.connectorId || "", data: args.data, metadata: args.metadata });
  }

  // ---- collect ENABLED config entries matching input.ids from migrated widget configs ----
  // Source of truth: the org's widgets. Each templateId is the org-level (endOrgId=null,
  // templateConfigId=null) config attached to that widget — regenerate with
  // listWidgets() + listConfigs({widget_id}) whenever a widget is recreated, because
  // recreating a widget mints a NEW cfg_* and silently orphans the old id here.
  // Last refreshed: 2026-08-31 against the 21 Perigon widgets (Gmail has no config).
  // Snowflake (cfg_d616242bdf06), Tableau (cfg_f9e85f981016) and Power BI (cfg_fd17d81b85b2)
  // exist as widgets but are intentionally NOT listed: DISPATCH has no handler for them,
  // so a job with those keys would be dropped by the `if (!handler) continue;` guard.
  const WIDGET_TEMPLATES = [
    { key: "slack",        templateId: "cfg_814b53f4b714" }, // wgt_bbffc9fd7997 slack
    { key: "teams",        templateId: "cfg_0aea37b42404" }, // wgt_fbb0f27fe161 microsoft-teams
    { key: "notion",       templateId: "cfg_29f6ed82ce94" }, // wgt_a98c2cbf554b notion
    { key: "asana",        templateId: "cfg_f1886550326d" }, // wgt_6747f3ae01a3 asana
    { key: "hubspot",      templateId: "cfg_db3bd40ae9fb" }, // wgt_ba600635af01 hubspot
    { key: "salesforce",   templateId: "cfg_bf0681107b87" }, // wgt_04aaffc1d102 salesforce
    { key: "zoho",         templateId: "cfg_2e60302f150b" }, // wgt_aefe67c155e4 zoho
    { key: "googleDocs",   templateId: "cfg_b35520c4d3a0" }, // wgt_0b01fcece24d google-docs
    { key: "googleSheets", templateId: "cfg_315f82bd5586" }, // wgt_40103d57efac google-sheets
    { key: "googleDrive",  templateId: "cfg_2497469bc8a9" }, // wgt_f1626653551c google-drive
    { key: "coda",         templateId: "cfg_d6c176677a67" }, // wgt_ad08d31f5908 coda
    { key: "monday",       templateId: "cfg_1e7282c696eb" }, // wgt_b5ed4b992708 monday
    { key: "clickup",      templateId: "cfg_b0548b32f142" }, // wgt_6a7ea0311ec6 clickup
    { key: "trello",       templateId: "cfg_6493e326378d" }, // wgt_4501681ec43e trello
    { key: "airtable",     templateId: "cfg_bb170084bef8" }, // wgt_0200c125f9e8 airtable
    { key: "supabase",     templateId: "cfg_f53ed1a038d2" }, // wgt_0b2290d9f408 supabase-management
    { key: "triggerdev",   templateId: "cfg_df986e9daabe" }  // wgt_3f166dc0d745 trigger-dev
  ];

  const connectorIdsFilter = Array.isArray(md?.connectorIds) && md.connectorIds.length > 0 ? md.connectorIds : null;
  const jobs = []; // { widget, entry }
  for (const w of WIDGET_TEMPLATES) {
    let cfg = null;
    try { cfg = await fastn.config.getByTemplate(w.templateId);
    } catch (e) { continue; }
    const entsList = cfg?.entities;
    if (!Array.isArray(entsList)) continue;
    for (const ent of entsList) {
      const val = ent?.configuration?.value;
      const entries = Array.isArray(val) ? val : (val && typeof val === "object" ? [val] : []);
      for (const entry of entries) {
        if (!entry || !entry.id) continue;
        if (!ids.includes(entry.id)) continue;
        if (entry.status === "DISABLED") continue;
        if (connectorIdsFilter) {
          const match = connectorIdsFilter.includes(entry.connectorId) || connectorIdsFilter.includes(entry.v2ConnectorId) || connectorIdsFilter.includes(entry.v2ConnectorSlug);
          if (!match) continue;
        }
        jobs.push({ widget: w.key, entry });
      }
    }
  }

  // ---- Slack ----
  async function recordSlackMsg(rec, channelOrUser) {
    try {
      const tsDigits = String(rec?.id ?? "").match(/^\d+/);
      const d = rec?.data || {};
      const msgId = `slack-${tsDigits ? tsDigits[0] : rec?.id ?? ""}-${d.bot_id ?? ""}-${d.team ?? ""}-${d.user ?? ""}-${channelOrUser}`;
      await fastn.db.query("INSERT INTO perigon_signals_v2 (msgid, signalid) VALUES ($1, $2) ON CONFLICT DO NOTHING", [msgId, String(ids[0])]);
    } catch (e) { /* CONTINUE (v1 semantics) */ }
  }
  async function deliverSlack(entry) {
    const t = await rtd({ connectorId: "slack", data: signalData });
    const text = t?.text || "";
    for (const u of arr(entry.users)) {
      try {
        const rec = await fastn.unified.messaging.direct_message.create({ recipient_id: u.value, text }, { provider: "slack" });
        delivered.push({ connector: "Slack", resource: `user ${u.label}` });
        await recordSlackMsg(rec, u.value);
      } catch (e) { await fail("Slack", "user", u.label, e); }
    }
    for (const c of arr(entry.channels)) {
      try {
        const rec = await fastn.unified.messaging.channel_message.create({ channel_id: c.value, text }, { provider: "slack" });
        delivered.push({ connector: "Slack", resource: `channel ${c.label}` });
        await recordSlackMsg(rec, c.value);
      } catch (e) { await fail("Slack", "channel", c.label, e); }
    }
  }

  // ---- Microsoft Teams ----
  async function deliverTeams(entry) {
    const t = await rtd({ connectorId: "microsoftTeams", data: signalData });
    const html = t?.body?.content || "";
    for (const c of arr(entry.chats)) {
      try {
        await fastn.unified.messaging.direct_message.create({ recipient_id: c.value, text: html }, { provider: "microsoftTeams" });
        delivered.push({ connector: "Microsoft Teams", resource: `chat ${c.label}` });
      } catch (e) { await fail("Microsoft Teams", "chat", c.label, e); }
    }
  }

  // ---- Notion ----
  async function deliverNotion(entry) {
    // v1 parity: render real Notion blocks (heading_3 + bold "Event N" + bulleted
    // fields + divider) instead of the flat "basic" text template. The unified
    // documents.document_content entity carries only plain text, and the stock
    // notion.appendBlockChildren action wraps a single string in one paragraph -
    // neither can express block structure, so this uses appendBlockChildrenRaw.
    const t = await rtd({ connectorId: "notion", data: signalData });
    let children = Array.isArray(t?.children) ? t.children : [];
    if (children.length === 0) {
      // Defensive fallback: never deliver nothing. Notion rejects an empty children array.
      const fb = await rtd({ templateType: "basic", data: signalData });
      const fbText = fb?.text || "";
      if (fbText) {
        children = [{ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: fbText.slice(0, 2000) } }] } }];
      }
    }
    children = children.slice(0, 100); // Notion caps children at 100 blocks per call
    for (const p of arr(entry.pages)) {
      try {
        await conn.connector.notion.appendBlockChildrenRaw({ blockId: p.value, children: children });
        delivered.push({ connector: "Notion", resource: `page ${p.label}` });
      } catch (e) { await fail("Notion", "page", p.label, e); }
    }
    for (const d of arr(entry.databases)) {
      try {
        const doc = await fastn.unified.documents.document.create({ title: "New Perigon Signal", parent_id: d.value }, { provider: "notion" });
        if (doc?.id) {
          await conn.connector.notion.appendBlockChildrenRaw({ blockId: doc.id, children: children });
        }
        delivered.push({ connector: "Notion", resource: `database ${d.label}` });
      } catch (e) { await fail("Notion", "database", d.label, e); }
    }
  }

  // ---- Google Docs (configureDocs widget) ----
  async function deliverGoogleDocs(entry) {
    // v1 parity: handlerGoogleDocs emits a Google Docs batchUpdate requests array
    // (heading, bold "Event N:" labels, dotted field paths, divider) instead of the flat
    // "basic" text. Offsets are absolute, so read each document's current end index first
    // and render per document with rtdFresh - rtd caches by templateType+connectorId and
    // would reuse the first document's offsets for every subsequent one.
    for (const d of arr(entry.docs)) {
      try {
        const docRes = await conn.connector.googleDocs.getDocument({ documentId: d.value });
        const content = docRes?.output?.body?.content || docRes?.body?.content || [];
        let startIndex = 1;
        for (const el of content) {
          if (typeof el?.endIndex === "number" && el.endIndex > startIndex) startIndex = el.endIndex;
        }
        if (startIndex > 1) startIndex -= 1;
        const t = await rtdFresh({ connectorId: "googleDocs", data: signalData, metadata: { googleDocs: { startIndex: startIndex } } });
        const requests = Array.isArray(t?.requests) ? t.requests : [];
        if (requests.length === 0) throw new Error("googleDocs renderer returned no batchUpdate requests");
        await conn.connector.googleDocs.batchUpdateRaw({ documentId: d.value, requests: requests });
        delivered.push({ connector: "Google Docs", resource: `doc ${d.label}` });
      } catch (e) { await fail("Google Docs", "doc", d.label, e); }
    }
  }

  // ---- Asana ----
  async function deliverAsana(entry) {
    const t = await rtd({ templateType: "basic", data: signalData });
    const text = t?.text || "";
    for (const p of arr(entry.projects)) {
      try {
        await fastn.unified.project_management.task.create({ title: "New Perigon Signal Alert", description: text, parent_id: p.value }, { provider: "asana" });
        delivered.push({ connector: "Asana", resource: `project ${p.label}` });
      } catch (e) { await fail("Asana", "project", p.label, e); }
    }
  }

  // ---- Monday ----
  async function deliverMonday(entry) {
    const t = await rtd({ templateType: "html", data: signalData });
    const html = t?.body?.content || "";
    for (const b of arr(entry.boards)) {
      try {
        await fastn.unified.project_management.task.create({ title: "⚡ New Perigon Signal Alert", description: html, parent_id: b.value }, { provider: "monday" });
        delivered.push({ connector: "Monday", resource: `board ${b.label}` });
      } catch (e) { await fail("Monday", "board", b.label, e); }
    }
  }

  // ---- ClickUp ----
  async function deliverClickup(entry) {
    const t = await rtd({ templateType: "Human-readable", data: signalData });
    const text = t?.text || "";
    for (const l of arr(entry.lists)) {
      try {
        await fastn.unified.project_management.task.create({ title: "⚡ New Perigon Signal Alert", description: text, parent_id: l.value }, { provider: "clickup" });
        delivered.push({ connector: "Click Up", resource: `list ${l.label}` });
      } catch (e) { await fail("Click Up", "list", l.label, e); }
    }
  }

  // ---- Trello ----
  async function deliverTrello(entry) {
    // Trello rejects empty checklist/check-item names. This is the only destination
    // that reads message.subject/content instead of rendering metadata.signals, and
    // Perigon sends those empty, so fall back to the rendered signal like every other
    // destination does, then to a fixed title.
    const cleanSubject = String(msgSubject).replace(/[^a-zA-Z0-9 ]/g, "").trim() || "New Perigon Signal Alert";
    let cleanContent = String(msgContent).replace(/[^a-zA-Z0-9 .,:/-]/g, "").trim();
    if (!cleanContent) {
      const trelloFallback = await rtd({ templateType: "basic", data: signalData });
      cleanContent = String(trelloFallback?.text || "").replace(/[^a-zA-Z0-9 .,:/-]/g, "").trim() || "New Perigon Signal Alert";
    }
    const cards = arr(entry.cards);
    if (cards.length > 0) {
      for (const c of cards) {
        try {
          const cl = await conn.connector.trello.createChecklistOnCard({ id: c.value, name: cleanSubject });
          const checklistId = cl.output?.id;
          if (checklistId) await conn.connector.trello.createCheckItem({ id: checklistId, name: cleanContent });
          delivered.push({ connector: "Trello", resource: `card ${c.label}` });
        } catch (e) { await fail("Trello", "card", c.label, e); }
      }
    } else {
      const listId = entry.lists?.value;
      try {
        await fastn.unified.project_management.task.create({ title: cleanSubject, description: cleanContent, parent_id: listId }, { provider: "trello" });
        delivered.push({ connector: "Trello", resource: `list ${entry.lists?.label ?? listId}` });
      } catch (e) { await fail("Trello", "list", entry.lists?.label ?? String(listId), e); }
    }
  }

  // ---- Coda ----
  async function deliverCoda(entry) {
    for (const d of arr(entry.docs)) {
      try {
        await conn.connector.coda.createPage({ docId: d.value, name: "⚡ New Perigon Signal Alert", subtitle: "⚡ New Perigon Signal Alert" });
        delivered.push({ connector: "Coda", resource: `doc ${d.label}` });
      } catch (e) { await fail("Coda", "doc", d.label, e); }
    }
  }

  // ---- Airtable ----
  const AIRTABLE_FIELDS = ["url", "source", "pubDate", "eventType", "companyName", "companyDomain", "policyArea", "eventSummary", "geographicFocus", "politicalFigureName", "involvedOrganization", "eventDate", "Related Articles", "Related Stories"];
  function airtableRecordsFromRaw(raw) {
    const headers = raw?.headers || [];
    const values = raw?.values || [];
    return values.map(row => ({ fields: Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ""])) }));
  }
  async function airtableInsert(baseId, tableIdOrName, records) {
    for (let i = 0; i < records.length; i += 10) {
      await conn.connector.airtable.createRecords({ baseId, tableIdOrName, records: records.slice(i, i + 10), typecast: true });
    }
  }
  // Airtable rejects the WHOLE insert with 422 UNKNOWN_FIELD_NAME when a record carries a
  // field the table does not have, and typecast only coerces values - it never creates fields.
  // The rendered headers are derived per-signal from the event's data keys, so a tenant-picked
  // table (and even the fixed AIRTABLE_FIELDS schema) will always drift from some signal type.
  // Reconcile the target's schema against the headers before inserting. createField errors are
  // NOT swallowed: they surface through fail() so a missing schema.bases:write scope is visible
  // in perigon_errors_v2 instead of reappearing as the same opaque 422.
  async function airtableEnsureFields(baseId, tableIdOrName, headers) {
    const schema = await conn.connector.airtable.getBaseSchema({ baseId });
    const tables = schema.output?.tables || [];
    const t = tables.find(x => x.id === tableIdOrName) || tables.find(x => x.name === tableIdOrName);
    if (!t) return tableIdOrName; // unknown table - let createRecords surface the real error
    const existing = new Set((t.fields || []).map(f => f.name));
    for (const h of headers) {
      if (!h || existing.has(h)) continue;
      await conn.connector.airtable.createField({ baseId, tableId: t.id, name: h, type: "singleLineText" });
      existing.add(h);
    }
    return t.id;
  }
  async function deliverAirtable(entry) {
    const raw = await rtd({ templateType: "raw", data: signalData });
    const headers = raw?.headers || [];
    const records = airtableRecordsFromRaw(raw);
    const baseId = entry.bases?.value;
    const tables = arr(entry.tables);
    if (tables.length > 0) {
      for (const tb of tables) {
        try {
          // no rows to write -> no API call at all (v1 parity: delivered still counted)
          const tid = records.length ? await airtableEnsureFields(baseId, tb.value, headers) : tb.value;
          await airtableInsert(baseId, tid, records);
          delivered.push({ connector: "Airtable", resource: `table ${tb.label}` });
        } catch (e) { await fail("Airtable", "sheet", tb.label, e); }
      }
    } else {
      try {
        const mem = await fastn.db.query("select resource from perigon_tenant_resources_v2 where tenantid = $1 and connector = 'airtable'", [tenantId]);
        let tableId = mem.rows?.[0]?.resource;
        if (!tableId) {
          // union: keep the canonical Perigon schema, plus whatever this signal type renders
          const tableFields = [...new Set([...AIRTABLE_FIELDS, ...headers])].filter(Boolean);
          const created = await conn.connector.airtable.createTable({
            baseId, name: "Perigon", description: "Perigon Signal Table",
            fields: tableFields.map(n => ({ name: n, type: "singleLineText" }))
          });
          tableId = created.output?.id;
          await fastn.db.query("INSERT INTO perigon_tenant_resources_v2 (tenantid, connector, resource) VALUES ($1, 'airtable', $2) ON CONFLICT DO NOTHING", [tenantId, tableId]);
        } else if (records.length) {
          // remembered table was created for an earlier signal shape - reconcile it
          tableId = await airtableEnsureFields(baseId, tableId, headers);
        }
        await airtableInsert(baseId, tableId, records);
        delivered.push({ connector: "Airtable", resource: "table Perigon" });
      } catch (e) { await fail("Airtable", "sheet", "Perigon", e); }
    }
  }

  // ---- Google Sheets ----
  async function deliverSheets(entry) {
    const raw = await rtd({ templateType: "raw", data: signalData });
    const headers = raw?.headers || [];
    const rows = raw?.values || [];
    for (const s of arr(entry.sheets)) {
      try {
        const meta = await conn.connector.googleSheets.getSpreadsheet({ spreadsheetId: s.value, fields: "sheets.properties.title" });
        const title = meta.output?.sheets?.[0]?.properties?.title || "Sheet1";
        const existing = await conn.connector.googleSheets.getValues({ spreadsheetId: s.value, range: `${title}!A1:ZZZ` });
        const existingRows = existing.output?.values || [];
        const isEmpty = existingRows.length === 0;
        const values = isEmpty ? [headers, ...rows] : rows;
        const startRow = isEmpty ? 1 : existingRows.length + 1;
        await conn.connector.googleSheets.appendValues({ spreadsheetId: s.value, range: `${title}!A${startRow}`, values, valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS" });
        delivered.push({ connector: "Google Sheets", resource: `sheet ${s.label}` });
      } catch (e) { await fail("Google Sheets", "sheet", s.label, e); }
    }
  }

  // ---- Google Drive (Files routed by mimeType) ----
  async function deliverDrive(entry) {
    for (const f of arr(entry.Files)) {
      const mime = f.metadata?.mimeType || "";
      try {
        if (mime === "application/vnd.google-apps.document") {
          await conn.connector.googleDocs.appendText({ documentId: f.value, text: msgContent });
          delivered.push({ connector: "Google Drive", resource: `file ${f.label}` });
        } else if (mime === "application/vnd.google-apps.spreadsheet") {
          const meta = await conn.connector.googleSheets.getSpreadsheet({ spreadsheetId: f.value, fields: "sheets.properties.title" });
          const title = meta.output?.sheets?.[0]?.properties?.title || "Sheet1";
          await conn.connector.googleSheets.appendValues({ spreadsheetId: f.value, range: title, values: [[msgSubject, msgContent]], valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS" });
          delivered.push({ connector: "Google Drive", resource: `file ${f.label}` });
        }
        // other mime types: skipped (v1 semantics — no else branch)
      } catch (e) { await fail("Google Drive", "file", f.label, e); }
    }
  }

  // ---- Snowflake (unreachable until a Snowflake widget exists in v2; ported per operator decision) ----
  const SF_SANITIZE_RE = new RegExp("['\"\\\\\\n\\r]", "g");
  function sfSanitize(v) { return String(v ?? "").replace(SF_SANITIZE_RE, ""); }
  async function deliverSnowflake(entry) {
    const base = { database: entry.databases?.value, schema: entry.schema?.value, warehouse: entry.warehouses?.value, role: "", timeout: 60 };
    const subj = sfSanitize(msgSubject), cont = sfSanitize(msgContent);
    const tables = arr(entry.tables);
    if (tables.length > 0) {
      for (const tb of tables) {
        try {
          await conn.connector.snowflake.submitStatement({ ...base, statement: `INSERT INTO ${tb.value} VALUES ('${subj}', '${cont}')` });
          delivered.push({ connector: "snowflake", resource: `table ${tb.label}` });
        } catch (e) { await fail("Snowflake", "table", tb.label, e); }
      }
    } else {
      try {
        const mem = await fastn.db.query("select resource from perigon_tenant_resources_v2 where tenantid = $1 and connector = 'snowflake'", [tenantId]);
        if (!mem.rows?.[0]?.resource) {
          await conn.connector.snowflake.submitStatement({ ...base, statement: "create table if not exists perigon_signals(ID varchar(255), Signal varchar(255));" });
          await fastn.db.query("INSERT INTO perigon_tenant_resources_v2 (tenantid, connector, resource) VALUES ($1, 'snowflake', 'perigon_signals') ON CONFLICT DO NOTHING", [tenantId]);
        }
        await conn.connector.snowflake.submitStatement({ ...base, statement: `INSERT INTO perigon_signals VALUES ('${sfSanitize(JSON.stringify(ids))}', '${subj} - ${cont}')` });
        delivered.push({ connector: "snowflake", resource: "table perigon_signals" });
      } catch (e) { await fail("Snowflake", "table", "perigon_signals", e); }
    }
  }

  // ---- CRM helpers (inlined v1 sendToCRMs) ----
  function extractEventSignalData(signal, event) {
    const allArticles = signal.articles || {};
    const relatedIds = Array.isArray(event.relatedArticleIds) ? event.relatedArticleIds : [];
    const filteredArticles = {};
    for (const id of relatedIds) { if (allArticles[id]) filteredArticles[id] = allArticles[id]; }
    return { events: [event], articles: filteredArticles, signalName: signal.signalName, signalType: signal.signalType, signalUuid: signal.signalUuid, signalImageUrl: signal.signalImageUrl };
  }
  function cleanNote(content) {
    return String(content ?? "").replace(/<([^|>]+)\|([^>]+)>/g, (m, url, label) => `${label}: ${url}`);
  }
  const isEventMode = Array.isArray(signalData.events) && signalData.events[0] && signalData.events[0].data;

  async function crmNote(provider, args, connectorName, noun, label) {
    try {
      await fastn.unified.crm.note.create(args, { provider });
      delivered.push({ connector: connectorName, resource: `${noun} ${label}` });
    } catch (e) { await fail(connectorName, noun, label, e); }
  }

  // ---- HubSpot ----
  async function deliverHubspot(entry) {
    async function noteFor(data) {
      const r = await rtdFresh({ templateType: "html", data });
      return cleanNote(r?.body?.content);
    }
    async function noteConfigured(note) {
      const now = new Date().toISOString();
      for (const d of arr(entry.deals)) await crmNote("hubspot", { body: note, parent_id: d.value, parent_type: "deal", created_at: now }, "Hubspot", "deal", d.label);
      for (const c of arr(entry.contacts)) await crmNote("hubspot", { body: note, parent_id: c.value, parent_type: "contact", created_at: now }, "Hubspot", "contact", c.label);
      for (const co of arr(entry.companies)) await crmNote("hubspot", { body: note, parent_id: co.value, parent_type: "company", created_at: now }, "Hubspot", "company", co.label);
    }
    if (isEventMode) {
      for (const ev of signalData.events) {
        const note = await noteFor(extractEventSignalData(signalData, ev));
        const entities = Array.isArray(ev.entities) ? ev.entities : [];
        if (entities.length > 0 && entities[0].type) {
          for (const ent of entities) {
            if (ent.type !== "company" || !ent.domain || (Array.isArray(ent.domains) && ent.domains[0])) continue;
            try {
              const s = await conn.connector.hubspot.searchCompanies({ filterGroups: [{ filters: [{ propertyName: "domain", operator: "EQ", value: ent.domain }] }], sorts: [], query: "", properties: ["domain", "name"], limit: 5, after: "0" });
              const id = s.output?.results?.[0]?.id;
              if (!id) continue; // v1: not found -> silent skip
              await crmNote("hubspot", { body: note, parent_id: id, parent_type: "company", created_at: new Date().toISOString() }, "Hubspot", "account", ent.domain);
            } catch (e) { await fail("Hubspot", "account", ent.domain, e); }
          }
        } else {
          await noteConfigured(note);
        }
      }
    } else {
      await noteConfigured(await noteFor(signalData));
    }
  }

  // ---- Salesforce ----
  async function deliverSalesforce(entry) {
    async function textFor(data) { const r = await rtdFresh({ templateType: "basic", data }); return r?.text || ""; }
    async function noteConfigured(text) {
      for (const a of arr(entry.accounts)) await crmNote("salesforce", { title: "New Perigon Signal", body: text, parent_id: a.value, parent_type: "account" }, "Salesforce", "account", a.label);
      for (const l of arr(entry.leads)) await crmNote("salesforce", { title: "New Perigon Signal", body: text, parent_id: l.value, parent_type: "lead" }, "Salesforce", "lead", l.label);
      for (const c of arr(entry.contacts)) await crmNote("salesforce", { title: "New Perigon Signal", body: text, parent_id: c.value, parent_type: "contact" }, "Salesforce", "contact", c.label);
      for (const o of arr(entry.opportunities)) await crmNote("salesforce", { title: "New Perigon Signal", body: text, parent_id: o.value, parent_type: "opportunity" }, "Salesforce", "opportunity", o.label);
    }
    if (isEventMode) {
      for (const ev of signalData.events) {
        const text = await textFor(extractEventSignalData(signalData, ev));
        const entities = Array.isArray(ev.entities) ? ev.entities : [];
        if (entities.length > 0 && entities[0].type) {
          for (const ent of entities) {
            if (ent.type !== "company" || !ent.domain || (Array.isArray(ent.domains) && ent.domains[0])) continue;
            try {
              const q = await conn.connector.salesforce.executeSoqlQuery({ query: `SELECT Id, Name, Website FROM Account WHERE Website = '${String(ent.domain).split("'").join("\\'")}'` });
              const id = q.output?.records?.[0]?.Id;
              if (!id) continue;
              await crmNote("salesforce", { title: "New Perigon Signal", body: text, parent_id: id, parent_type: "account" }, "Salesforce", "account", ent.name ?? ent.domain);
            } catch (e) { await fail("Salesforce", "account", ent.name ?? ent.domain, e); }
          }
        } else {
          await noteConfigured(text);
        }
      }
    } else {
      await noteConfigured(await textFor(signalData));
    }
  }

  // ---- Zoho CRM ----
  async function deliverZoho(entry) {
    async function textFor(data) { const r = await rtdFresh({ connectorId: "zohoCrm", data }); return r?.text || ""; }
    async function noteConfigured(text) {
      for (const l of arr(entry.Leads)) await crmNote("zohoCrm", { title: "New Perigon Signal Alert", body: text, parent_id: l.value, parent_type: "lead" }, "Zoho CRM", "lead", l.label);
      for (const a of arr(entry.Accounts)) await crmNote("zohoCrm", { title: "New Perigon Signal Alert", body: text, parent_id: a.value, parent_type: "account" }, "Zoho CRM", "account", a.label);
    }
    if (isEventMode) {
      for (const ev of signalData.events) {
        const text = await textFor(extractEventSignalData(signalData, ev));
        const entities = Array.isArray(ev.entities) ? ev.entities : [];
        if (entities.length > 0 && entities[0].type) {
          for (const ent of entities) {
            if (ent.type !== "company" || !ent.domain || (Array.isArray(ent.domains) && ent.domains[0])) continue;
            try {
              // v2 zohoCrm has no criteria-search action: list + client-side Website match
              const list = await conn.connector.zohoCrm.listAccounts({ fields: "id,Account_Name,Website", per_page: 200 });
              const recs = list.output?.data || [];
              const hit = recs.find(r => r.Website && String(r.Website).includes(ent.domain));
              if (!hit) continue;
              await crmNote("zohoCrm", { title: "New Perigon Signal Alert", body: text, parent_id: hit.id, parent_type: "account" }, "Zoho CRM", "account", ent.name ?? ent.domain);
            } catch (e) { await fail("Zoho CRM", "account", ent.name ?? ent.domain, e); }
          }
        } else {
          await noteConfigured(text);
        }
      }
    } else {
      await noteConfigured(await textFor(signalData));
    }
  }

  // ---- Supabase (v2 has no invoke-edge-function action: direct HTTP invoke) ----
  async function deliverSupabase(entry) {
    const projectRef = entry.projects?.value;
    for (const fn of arr(entry.functions)) {
      try {
        const res = await fetch(`https://${projectRef}.supabase.co/functions/v1/${fn.value}`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(signalData)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        delivered.push({ connector: "Supabase Management", resource: `function ${fn.label}` });
      } catch (e) { await fail("Supabase Management", "function", fn.label, e); }
    }
  }

  // ---- Trigger.dev ----
  async function deliverTriggerdev(entry) {
    const taskId = entry.taskId;
    if (!taskId) return; // v1: no resource selected -> silent skip
    try {
      await conn.connector.triggerdev.triggerTask({ taskIdentifier: taskId, payload: signalData });
      delivered.push({ connector: "Trigger", resource: `task ${taskId}` });
    } catch (e) { await fail("Trigger", "task", taskId, e); }
  }

  // ---- Zapier (no v2 connector: direct webhook POST, v1 semantics) ----
  async function deliverZapier(entry) {
    for (const z of arr(entry.zaps)) {
      try {
        const res = await fetch(z.value, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        delivered.push({ connector: "Zapier", resource: `zap ${z.label}` });
      } catch (e) { await fail("Zapier", "zap", z.label, e); }
    }
  }

  // ---- dispatch ----
  const DISPATCH = {
    slack: deliverSlack,
    teams: deliverTeams,
    notion: deliverNotion,
    asana: deliverAsana,
    hubspot: deliverHubspot,
    salesforce: deliverSalesforce,
    zoho: deliverZoho,
    googleDocs: deliverGoogleDocs,
    googleSheets: deliverSheets,
    googleDrive: deliverDrive,
    coda: deliverCoda,
    monday: deliverMonday,
    clickup: deliverClickup,
    trello: deliverTrello,
    airtable: deliverAirtable,
    supabase: deliverSupabase,
    triggerdev: deliverTriggerdev
  };
  for (const job of jobs) {
    const handler = DISPATCH[job.widget];
    if (!handler) continue;
    // extra dispatch guards for future widgets carrying explicit slugs
    if (job.entry.v2ConnectorSlug === "snowflake") { await deliverSnowflake(job.entry); continue; }
    if (Array.isArray(job.entry.zaps) && job.entry.zaps.length > 0) { await deliverZapier(job.entry); continue; }
    await handler(job.entry);
  }

  // ---- response (v1 semantics) ----
  if (errors.length === 0) {
    return { message: "Signal sent.", statusCode: "200", delivered: delivered.length, deliveries: delivered };
  }
  return { statusCode: "400", connectorErrors: errors, delivered: delivered.length, deliveries: delivered };
}