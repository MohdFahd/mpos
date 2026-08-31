export default async function (ctx) {
  // Cascade dependency is read by WIDGET CONFIG FIELD NAME: `spaces`.
  const spaceId = ctx?.input?.data?.spaces?.value;

  // BUG FIX (v1): v1 fell back to "" here, producing GET /api/v2/space//folder.
  if (!spaceId) {
    return { options: [] };
  }

  const res = await fastn.connector.clickup.listFolders({ spaceId: spaceId });

  const data = res?.output?.data ?? res?.output ?? res;
  const rows = Array.isArray(data?.folders) ? data.folders : (Array.isArray(data) ? data : []);

  const options = rows.map(function (f) {
    return { label: f?.name ?? f?.id ?? "", value: f?.id };
  });

  return { options: options };
}