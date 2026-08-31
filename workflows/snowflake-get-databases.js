export default async function (ctx) {
  // Cascade dependency is read by WIDGET CONFIG FIELD NAME: `warehouses`.
  const warehouse = ctx?.input?.data?.warehouses?.value;

  // BUG FIX (v1): v1 fell back to "" and called the API anyway.
  // `warehouses` is a pure cascade gate here - listDatabases takes no warehouse param.
  if (!warehouse) {
    return { options: [] };
  }

  const res = await fastn.connector.snowflake.listDatabases({});

  const data = res?.output?.data ?? res?.output ?? res;

  // SHAPE UNVERIFIED (no ACTIVE Snowflake connection in this org, so no live probe).
  // Accept every documented/declared/observed possibility rather than guessing one.
  const rows = Array.isArray(data) ? data
    : Array.isArray(data?.databases) ? data.databases
    : Array.isArray(data?.results) ? data.results
    : Array.isArray(data?.data) ? data.data
    : [];

  const options = [];
  for (const row of rows) {
    // Snowflake has no separate id: label == value == name.
    const name = (typeof row === "string") ? row : (row?.name ?? row?.database_name ?? null);
    if (name) options.push({ label: name, value: name });
  }

  return { options: options };
}