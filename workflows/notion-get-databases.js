export default async function (ctx) {
  const input = (ctx && ctx.input) ? ctx.input : {};

  const MAX_PAGE_SIZE = 100;

  // page_size is REQUIRED by the notion.search contract - always send it.
  function resolvePageSize(limit) {
    const n = Math.floor(Number(limit));
    if (!Number.isFinite(n) || n <= 0) return MAX_PAGE_SIZE;
    return Math.min(n, MAX_PAGE_SIZE);
  }

  function plainTextFromRichText(rich) {
    const arr = Array.isArray(rich) ? rich : [];
    const text = arr.length > 0 && arr[0] ? arr[0].plain_text : null;
    return (typeof text === "string" && text.length > 0) ? text : null;
  }

  // Fallback path: first property whose type === "title" (the page-shaped lookup).
  function titleFromProperties(properties) {
    if (!properties || typeof properties !== "object") return null;
    const keys = Object.keys(properties);
    for (let i = 0; i < keys.length; i++) {
      const prop = properties[keys[i]];
      if (prop && prop.type === "title") {
        return plainTextFromRichText(prop.title);
      }
    }
    return null;
  }

  const args = {
    page_size: resolvePageSize(input.limit),
    filter: { value: "database", property: "object" }
  };

  // Omit start_cursor entirely on the first page.
  if (typeof input.cursor === "string" && input.cursor.length > 0) {
    args.start_cursor = input.cursor;
  }
  if (typeof input.query === "string" && input.query.length > 0) {
    args.query = input.query;
  }

  const res = await fastn.connector.notion.search(args);
  const data = (res && res.output && res.output.data) ? res.output.data
             : (res && res.output) ? res.output
             : (res || {});

  const results = Array.isArray(data.results) ? data.results : [];

  const options = results.map(function (r) {
    // Databases put the title at the TOP LEVEL, not under properties.
    let label = plainTextFromRichText(r && r.title);
    if (label === null) label = titleFromProperties(r && r.properties);
    return {
      label: (label === null || label === undefined) ? "NO TITLE" : label,
      value: r ? r.id : null
    };
  });

  return {
    options: options,
    cursor: (data.next_cursor === undefined) ? null : data.next_cursor
  };
}