export default async function (ctx) {
  const { input, headers } = ctx;
  // Your workflow logic here
  const res = await fastn.connector.salesforce.listAccounts({});
  return { result: "Hello from workflow!", res };
}