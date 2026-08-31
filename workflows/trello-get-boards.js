export default async function (ctx) {
  const args = { memberId: ctx.input?.memberId || 'me' };

  const res = await fastn.connector.trello.listBoards(args);
  const data = res?.output?.data ?? res?.output ?? res;
  const items = Array.isArray(data) ? data : (Array.isArray(data?.boards) ? data.boards : []);

  const options = items
    .map((b) => ({ label: b?.name, value: b?.id }))
    .filter((o) => o.value != null);

  return { options };
}