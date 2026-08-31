export default async function (ctx) {
  // Cascade dependency is read by WIDGET CONFIG FIELD NAME: `lists`.
  const listId = ctx?.input?.data?.lists?.value;

  // BUG FIX (v1): v1 fell back to "" here, producing GET /1/lists//cards.
  if (!listId) {
    return { options: [] };
  }

  // PARAM RENAME: v1 sent `listId`; v2 getListCards takes the generic `id` path param.
  const res = await fastn.connector.trello.getListCards({ id: listId });

  // v2 returns a BARE TOP-LEVEL ARRAY.
  const data = res?.output?.data ?? res?.output ?? res;
  const rows = Array.isArray(data) ? data : (Array.isArray(data?.cards) ? data.cards : []);

  const options = rows.map(function (c) {
    return { label: c?.name ?? c?.id ?? "", value: c?.id };
  });

  return { options: options };
}