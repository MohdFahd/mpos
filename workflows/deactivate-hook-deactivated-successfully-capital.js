export default async function (ctx) {
  // Ported verbatim from fastn v1. Capital S in "Successfully" is intentional -
  // v1 has a separate lowercase-s variant used by deactivateSalesforce.
  return { message: "Deactivated Successfully" };
}
