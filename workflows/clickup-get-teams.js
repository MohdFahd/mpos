export default async function (ctx) {
  const res = await fastn.connector.clickup.listTeams({});
  const data = res?.output?.data ?? res?.output ?? res;
  const items = Array.isArray(data?.teams) ? data.teams : (Array.isArray(data) ? data : []);

  const options = items
    .map((t) => ({ label: t?.name, value: t?.id }))
    .filter((o) => o.value != null);

  return { options };
}