export default async function (ctx) {
  const args = {};
  if (ctx.input?.limit != null) args.limit = ctx.input.limit;
  if (ctx.input?.cursor) args.offset = ctx.input.cursor;

  const res = await fastn.connector.asana.getWorkspaces(args);
  const envelope = res?.output ?? res;
  const data = res?.output?.data ?? res?.output ?? res;
  const items = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);

  const options = items
    .map((w) => ({ label: w?.name, value: w?.gid }))
    .filter((o) => o.value != null);

  return { options, cursor: envelope?.next_page?.offset ?? null };
}