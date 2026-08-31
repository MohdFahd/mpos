export default async function (ctx) {
  const args = {};
  if (ctx.input?.cursor) args.pageToken = ctx.input.cursor;
  if (ctx.input?.limit != null) args.pageSize = ctx.input.limit;

  const res = await fastn.connector.googleDocs.listDocuments(args);
  const data = res?.output?.data ?? res?.output ?? res;
  const items = Array.isArray(data?.files) ? data.files : (Array.isArray(data) ? data : []);

  const options = items
    .map((f) => ({ label: f?.name, value: f?.id }))
    .filter((o) => o.value != null);

  return { options, cursor: data?.nextPageToken ?? null };
}