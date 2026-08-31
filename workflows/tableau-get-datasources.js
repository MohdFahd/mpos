export default async function (ctx) {
  const res = await fastn.connector.tableau.listDataSources({});
  const data = res?.output?.data ?? res?.output ?? res;

  const node = data?.datasources;
  const items = Array.isArray(node)
    ? node
    : (Array.isArray(node?.datasource) ? node.datasource : (Array.isArray(data) ? data : []));

  const options = items
    .map((d) => ({ label: d?.name, value: d?.id }))
    .filter((o) => o.value != null);

  return { options };
}