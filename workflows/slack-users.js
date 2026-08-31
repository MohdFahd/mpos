export default async function (ctx) {
  const args = { limit: ctx.input?.limit != null ? ctx.input.limit : 100 };
  if (ctx.input?.cursor) args.cursor = ctx.input.cursor;

  const res = await fastn.connector.slack.listUsersList(args);
  const data = res?.output?.data ?? res?.output ?? res;
  const items = Array.isArray(data?.members) ? data.members : (Array.isArray(data) ? data : []);

  const options = items
    .filter((m) => m?.deleted !== true)
    .map((m) => ({ label: m?.real_name, value: m?.id }))
    .filter((o) => o.value != null);

  return { options, cursor: data?.response_metadata?.next_cursor || null };
}