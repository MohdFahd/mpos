export default async function (ctx) {
  // Cascade dependency is read by WIDGET CONFIG FIELD NAME: `bases`.
  const baseId = ctx?.input?.data?.bases?.value;

  // BUG FIX (v1): v1 fell back to "" here, producing GET /v0/meta/bases//tables.
  if (!baseId) {
    return { options: [] };
  }

  // RENAMED from v1's airtable.getTables - v2 has no getTables action at all.
  const res = await fastn.connector.airtable.getBaseSchema({ baseId: baseId });

  const data = res?.output?.data ?? res?.output ?? res;
  const rows = Array.isArray(data?.tables) ? data.tables : (Array.isArray(data) ? data : []);

  // getBaseSchema returns the FULL base schema (every table with all its fields and
  // views). Project ONLY id + name and discard the rest so the widget config form
  // does not carry the whole schema.
  const options = rows.map(function (t) {
    return { label: t?.name ?? t?.id ?? "", value: t?.id };
  });

  return { options: options };
}