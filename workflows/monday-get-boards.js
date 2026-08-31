export default async function (ctx) {
  // monday.listBoards declares BOTH limit and page as required and interpolates
  // them raw into a GraphQL JSON bodyTemplate, so they must always be numbers.
  const limit = Number.isFinite(Number(ctx.input?.limit)) ? Number(ctx.input.limit) : 25;
  const page = Number.isFinite(Number(ctx.input?.page)) ? Number(ctx.input.page) : 1;

  const res = await fastn.connector.monday.listBoards({ limit, page });

  // GraphQL envelope: output.data.boards
  const data = res?.output?.data ?? res?.output ?? res;
  const items = Array.isArray(data?.boards)
    ? data.boards
    : (Array.isArray(data?.data?.boards) ? data.data.boards : (Array.isArray(data) ? data : []));

  const options = items
    .map((b) => ({ label: b?.name, value: b?.id }))
    .filter((o) => o.value != null);

  return { options };
}