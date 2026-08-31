export default async function (ctx) {
  // Cascade dependency is read by WIDGET CONFIG FIELD NAME: `folders`.
  const folderId = ctx?.input?.data?.folders?.value;

  // BUG FIX (v1): v1 fell back to "" here, producing GET /api/v2/folder//list.
  if (!folderId) {
    return { options: [] };
  }

  // KNOWN GAP (inherited from v1, intentionally preserved): this chain only sees
  // lists that live INSIDE a folder. ClickUp also allows folderless lists directly
  // under a space; listListsInFolder only accepts folderId, so those are not offered.
  const res = await fastn.connector.clickup.listListsInFolder({ folderId: folderId });

  const data = res?.output?.data ?? res?.output ?? res;
  const rows = Array.isArray(data?.lists) ? data.lists : (Array.isArray(data) ? data : []);

  const options = rows.map(function (l) {
    return { label: l?.name ?? l?.id ?? "", value: l?.id };
  });

  return { options: options };
}