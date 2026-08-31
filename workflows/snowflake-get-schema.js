export default async function (ctx) {
  // Cascade dependencies read by WIDGET CONFIG FIELD NAME: `warehouses` AND `databases`.
  // This is the only loader in the set that reads two ancestors; both stay declared.
  const warehouse = ctx?.input?.data?.warehouses?.value;
  const database = ctx?.input?.data?.databases?.value;

  // BUG FIX (v1): v1 fell back to "" for either parent, producing
  // GET /api/v2/databases//schemas. Both parents are required.
  if (!warehouse || !database) {
    return { options: [] };
  }

  // BUG FIX (v1): v1 interpolated the database name into the request as a raw string,
  // which broke on names containing quotes. Passed as a proper param so the connector
  // does the encoding.
  const res = await fastn.connector.snowflake.listSchemas({ database: database });

  const data = res?.output?.data ?? res?.output ?? res;

  // SHAPE UNVERIFIED (no ACTIVE Snowflake connection, so no live probe).
  const rows = Array.isArray(data) ? data
    : Array.isArray(data?.schemas) ? data.schemas
    : Array.isArray(data?.results) ? data.results
    : Array.isArray(data?.data) ? data.data
    : [];

  const options = [];
  for (const row of rows) {
    // BUG FIX / SHAPE CHANGE: v1 returned a flat array of STRINGS; v2 returns objects.
    // Map objects to .name, and still tolerate a plain string row.
    const name = (typeof row === "string") ? row : (row?.name ?? row?.schema_name ?? null);
    if (name) options.push({ label: name, value: name });
  }

  return { options: options };
}