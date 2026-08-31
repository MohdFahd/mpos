// zapInputSchema - migrated from fastn v1 template templates#api#global#zapInputFormat
// (v1 flow name zapInputSchema; template id zapInputFormat - they differ).
//
// v1 was one INLINE node returning this static sample payload. It advertises the trigger
// payload SHAPE to Zapier at Zap design time; Zapier reads only the JSON structure.
// There is no connector call, no DB read, and no per-tenant data - so no tenant lookup is
// needed here and none is performed. Nothing can leak across tenants from a constant.

export default async function (ctx) {
  // Byte-for-byte the v1 payload, including the top-level array wrapper Zapier expects.
  return [
    {
      ids: ["signalId1"],
      message: {
        subject: "Sample Subject",
        content: "Sample Content",
        attachments: ["file1.pdf", "image.jpg"]
      },
      metadata: {}
    }
  ];
}