export default async function (ctx) {
  const res = await fastn.connector.tableau.listProjects({});
  const data = res?.output?.data ?? res?.output ?? res;

  const node = data?.projects;
  const items = Array.isArray(node)
    ? node
    : (Array.isArray(node?.project) ? node.project : (Array.isArray(data) ? data : []));

  const options = items
    .map((p) => ({ label: p?.name, value: p?.id }))
    .filter((o) => o.value != null);

  return { options };
}