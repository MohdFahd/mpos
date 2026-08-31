export default async function (ctx) {
  // Cascade dependencies read by WIDGET CONFIG FIELD NAME:
  // `warehouses` (gate only), `databases` -> database, `schema` -> schema.
  const warehouse = ctx?.input?.data?.warehouses?.value;
  const database = ctx?.input?.data?.databases?.value;
  const schema = ctx?.input?.data?.schema?.value;

  // BUG FIX (v1): v1 fell back to "" for any missing parent, producing
  // GET /api/v2/databases//schemas//tables. All three parents are required.
  if (!warehouse || !database || !schema) {
    return { options: [] };
  }

  // BUG FIX (v1): v1 interpolated database/schema names into the request as raw
  // strings, which broke on names containing quotes. Passed as proper params.
  const res = await fastn.connector.snowflake.listTables({ database: database, schema: schema });

  const data = res?.output?.data ?? res?.output ?? res;

  // SHAPE UNVERIFIED (no ACTIVE Snowflake connection, so no live probe).
  const rows = Array.isArray(data) ? data
    : Array.isArray(data?.tables) ? data.tables
    : Array.isArray(data?.results) ? data.results
    : Array.isArray(data?.data) ? data.data
    : [];

  const options = [];
  for (const row of rows) {
    const isObj = row !== null && typeof row === "object";
    const name = isObj ? (row?.name ?? row?.table_name ?? null) : (typeof row === "string" ? row : null);
    if (!name) continue;

    // BUG FIX / FIELD REMAP: v2 table objects use `schema_name`, NOT `schema`.
    // v1 emitted a `schema` key on every option, so remap it and fall back to the
    // schema that was actually requested.
    const rowSchema = (isObj ? (row?.schema_name ?? row?.schema) : null) ?? schema;

    options.push({ label: name, value: name, schema: rowSchema });
  }

  return { options: options };
}