export default async function (ctx) {
  // Ported verbatim from fastn v1. Distinct from the 28-flow group, which
  // returns the misspelled "Activated Succesfully".
  return { message: "Activated successfully" };
}
