export default async function (ctx) {
  const args = {};
  if (ctx.input?.cursor) args.offset = ctx.input.cursor;

  const res = await fastn.connector.airtable.listBases(args);
  const data = res?.output?.data ?? res?.output ?? res;
  const items = Array.isArray(data?.bases) ? data.bases : (Array.isArray(data) ? data : []);

  const options = items
    .map((b) => ({ label: b?.name, value: b?.id }))
    .filter((o) => o.value != null);

  return { options, cursor: data?.offset ?? null };
}