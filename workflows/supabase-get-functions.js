export default async function (ctx) {
  // Cascade dependency is read by WIDGET CONFIG FIELD NAME: `projects`.
  const projectRef = ctx?.input?.data?.projects?.value;

  // BUG FIX (v1): v1 fell back to "" here, producing GET /projects//functions,
  // which Supabase misreads as project ref "functions".
  if (!projectRef) {
    return { options: [] };
  }

  const res = await fastn.connector.supabaseManagementApi.listEdgeFunctions({ projectRef: projectRef });

  // v2 returns a BARE top-level array.
  const data = res?.output?.data ?? res?.output ?? res;
  const rows = Array.isArray(data) ? data : (Array.isArray(data?.functions) ? data.functions : []);

  const options = rows.map(function (f) {
    return { label: f?.name ?? f?.slug ?? "", value: f?.slug };
  });

  return { options: options };
}