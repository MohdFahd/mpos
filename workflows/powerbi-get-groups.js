export default async function (ctx) {
  const res = await fastn.connector.powerbi.listGroups({});
  const data = res?.output?.data ?? res?.output ?? res;
  const items = Array.isArray(data?.value) ? data.value : (Array.isArray(data) ? data : []);

  const options = items
    .map((g) => ({ label: g?.name, value: g?.id }))
    .filter((o) => o.value != null);

  return { options };
}