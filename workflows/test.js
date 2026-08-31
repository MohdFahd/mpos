export default async function(ctx) {
  const { input, headers } = ctx;
  // Your workflow logic here
  const config = await fastn.config.getByTemplate("cfg_efa8b65c58ec");
  return { result: "Hello from workflow!", config };
}