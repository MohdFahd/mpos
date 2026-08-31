export default async function (ctx) {
  const args = {
    limit: ctx.input?.limit != null ? ctx.input.limit : 100,
    types: 'public_channel,private_channel'
  };
  if (ctx.input?.cursor) args.cursor = ctx.input.cursor;

  const res = await fastn.connector.slack.listConversationsList(args);
  const data = res?.output?.data ?? res?.output ?? res;
  const items = Array.isArray(data?.channels) ? data.channels : (Array.isArray(data) ? data : []);

  const options = items
    .map((c) => ({ label: c?.name, value: c?.id }))
    .filter((o) => o.value != null);

  return { options, cursor: data?.response_metadata?.next_cursor || null };
}