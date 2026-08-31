export default async function (ctx) {
  // Ported verbatim from fastn v1. The message string preserves v1's original
  // spelling ("Succesfully", one s) because callers may assert on it.
  return { message: "Deactivation Succesfully" };
}
