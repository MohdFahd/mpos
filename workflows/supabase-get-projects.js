export default async function (ctx) {
  // Cascade dependency is read by WIDGET CONFIG FIELD NAME: `organizations`.
  const orgSlug = ctx?.input?.data?.organizations?.value;

  // BUG FIX (v1): v1 fell back to "" here, producing GET /organizations//projects.
  // Return the empty option set instead of calling the API with an empty path segment.
  if (!orgSlug) {
    return { options: [] };
  }

  const res = await fastn.connector.supabaseManagementApi.getAllProjectsForOrganization({ orgSlug: orgSlug });

  const data = res?.output?.data ?? res?.output ?? res;
  const rows = Array.isArray(data?.projects) ? data.projects : (Array.isArray(data) ? data : []);

  const options = rows.map(function (p) {
    return { label: p?.name ?? p?.ref ?? "", value: p?.ref };
  });

  return { options: options };
}