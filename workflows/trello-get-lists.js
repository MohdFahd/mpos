export default async function (ctx) {
  // Cascade dependency is read by WIDGET CONFIG FIELD NAME: `boards`.
  const boardId = ctx?.input?.data?.boards?.value;

  // BUG FIX (v1): v1 fell back to "" here, producing GET /1/boards//lists.
  if (!boardId) {
    return { options: [] };
  }

  // PARAM RENAME: v1 sent `boardId`; v2 getBoardLists takes the generic `id` path param.
  const res = await fastn.connector.trello.getBoardLists({ id: boardId });

  // v2 returns a BARE TOP-LEVEL ARRAY.
  const data = res?.output?.data ?? res?.output ?? res;
  const rows = Array.isArray(data) ? data : (Array.isArray(data?.lists) ? data.lists : []);

  const options = rows.map(function (l) {
    return { label: l?.name ?? l?.id ?? "", value: l?.id };
  });

  return { options: options };
}