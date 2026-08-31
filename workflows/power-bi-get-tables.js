export default async function (ctx) {
  // Cascade dependencies are read by WIDGET CONFIG FIELD NAME: `groups` and `datasets`.
  const groupId = ctx?.input?.data?.groups?.value;
  const datasetId = ctx?.input?.data?.datasets?.value;

  // BUG FIX (v1): v1 fell back to "" for either parent, producing
  // GET /v1.0/myorg/groups//datasets//tables. Both parents are required.
  if (!groupId || !datasetId) {
    return { options: [] };
  }

  const res = await fastn.connector.powerbi.getDatasetTablesInGroup({ groupId: groupId, datasetId: datasetId });

  const data = res?.output?.data ?? res?.output ?? res;
  const rows = Array.isArray(data?.value) ? data.value : (Array.isArray(data) ? data : []);

  // Power BI table objects expose no id, so value is the table name.
  const options = rows.map(function (t) {
    return { label: t?.name ?? "", value: t?.name };
  });

  return { options: options };
}