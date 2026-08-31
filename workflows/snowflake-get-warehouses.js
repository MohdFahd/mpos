export default async function (ctx) {
  const res = await fastn.connector.snowflake.listWarehouses({});
  const data = res?.output?.data ?? res?.output ?? res;
  const items = Array.isArray(data?.warehouses) ? data.warehouses : (Array.isArray(data) ? data : []);

  // A Snowflake warehouse is keyed by its name: label === value by design.
  const options = items
    .map((w) => ({ label: w?.name, value: w?.name }))
    .filter((o) => o.value != null);

  return { options };
}