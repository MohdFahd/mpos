export default async function (ctx) {
  // Ported verbatim from fastn v1. Lowercase s, unlike the capital-S variant
  // used by deactivateMSTeams / deactivateHubspot / deactivateZapier.
  return { message: "Deactivated successfully" };
}
