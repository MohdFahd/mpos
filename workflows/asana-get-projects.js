export default async function (ctx) {
  // Cascade dependency is read by WIDGET CONFIG FIELD NAME: `workspaces`.
  const workspace = ctx?.input?.data?.workspaces?.value;

  // BUG FIX (v1): v1 fell back to "" here, producing a malformed URL against Asana.
  // Return the empty option set instead of calling the API with an empty param.
  if (!workspace) {
    return { options: [], cursor: null };
  }

  const args = { workspace };
  if (ctx?.input?.limit) args.limit = ctx.input.limit;
  if (ctx?.input?.cursor) args.offset = ctx.input.cursor;

  const res = await fastn.connector.asana.getProjects(args);

  const data = res?.output?.data ?? res?.output ?? res;
  const rows = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);

  const options = rows.map(function (p) {
    return { label: p?.name ?? p?.gid ?? "", value: p?.gid };
  });

  // BUG FIX (v1): the cursor is read from THIS call's own response.
  // v1's first-page node read it from the sibling branch's `getProjectsCopy` step,
  // so it was always null and pagination never advanced.
  const nextPage = res?.output?.next_page ?? null;

  return { options: options, cursor: nextPage?.offset ?? null };
}