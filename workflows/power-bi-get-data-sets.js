export default async function (ctx) {
  // Cascade dependency is read by WIDGET CONFIG FIELD NAME: `groups`.
  const groupId = ctx?.input?.data?.groups?.value;

  // BUG FIX (v1): v1 fell back to "" here, producing GET /v1.0/myorg/groups//datasets.
  if (!groupId) {
    return { options: [] };
  }

  const res = await fastn.connector.powerbi.listDatasetsInGroup({ groupId: groupId });

  const data = res?.output?.data ?? res?.output ?? res;
  const rows = Array.isArray(data?.value) ? data.value : (Array.isArray(data) ? data : []);

  const options = rows.map(function (d) {
    return { label: d?.name ?? d?.id ?? "", value: d?.id };
  });

  return { options: options };
}