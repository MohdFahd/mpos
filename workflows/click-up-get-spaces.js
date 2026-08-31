export default async function (ctx) {
  // Cascade dependency is read by WIDGET CONFIG FIELD NAME: `teams`.
  const teamId = ctx?.input?.data?.teams?.value;

  // BUG FIX (v1): v1 fell back to "" here, producing GET /api/v2/team//space.
  if (!teamId) {
    return { options: [] };
  }

  // PARAM RENAME: v1 sent `team_id`; v2 listSpaces requires camelCase `teamId`.
  // Do NOT generalise - clickup.getTeamMembers still uses snake_case `team_id`.
  const res = await fastn.connector.clickup.listSpaces({ teamId: teamId });

  const data = res?.output?.data ?? res?.output ?? res;
  const rows = Array.isArray(data?.spaces) ? data.spaces : (Array.isArray(data) ? data : []);

  const options = rows.map(function (s) {
    return { label: s?.name ?? s?.id ?? "", value: s?.id };
  });

  return { options: options };
}