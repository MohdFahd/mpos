export default async function (ctx) {
  const res = await fastn.connector.supabaseManagementApi.listAllOrganizations({});
  const data = res?.output?.data ?? res?.output ?? res;
  const items = Array.isArray(data)
    ? data
    : (Array.isArray(data?.organizations) ? data.organizations : []);

  const options = items
    .map((o) => ({ label: o?.name, value: o?.slug }))
    .filter((o) => o.value != null);

  return { options };
}