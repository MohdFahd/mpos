export default async function (ctx) {
  // Ported verbatim from fastn v1. The Gmail flows are the only pair returning
  // this bare lowercase form rather than a sentence.
  return { message: "success" };
}
