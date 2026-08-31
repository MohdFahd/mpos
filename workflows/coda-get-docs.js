export default async function (ctx) {
  const args = {};
  if (ctx.input?.limit != null) args.limit = ctx.input.limit;

  const res = await fastn.connector.coda.listDocs(args);
  const data = res?.output?.data ?? res?.output ?? res;
  const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);

  const options = items
    .map((d) => ({ label: d?.name, value: d?.id }))
    .filter((o) => o.value != null);

  return { options };
}