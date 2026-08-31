// v2 port of fastn v1 workflow "returnTemplatedData" (pure template renderer, no connectors).
// Each v1 INLINE handler body is kept VERBATIM below; only the function names were changed.
// v1 node -> v2 function mapping:
//   Function      -> handlerHumanReadable   (templateType "Human-readable")
//   Function2     -> handlerRaw             (templateType "raw")
//   Data (JINJA)  -> handlerCsv             (templateType "csv" — faithful JS reimplementation of the JINJA passthrough)
//   Function3     -> handlerHtml            (templateType "html")
//   Function7     -> handlerXml             (templateType "xml")
//   Function4     -> handlerBasic           (templateType "basic")
//   Function8     -> handlerGoogleDocs      (connectorId googleDocs)
//   Function5     -> handlerHubspot         (connectorId hubspot — v1 responded HTTP 400/isError; v2 returns the payload normally)
//   Function6     -> handlerNotion          (connectorId notion)
//   FunctionCopy  -> handlerSlack           (connectorId slack)
//   Function10    -> handlerTeams           (connectorId microsoftTeams)
//   Function4Copy -> handlerZoho            (connectorId zohoCrm)

function handlerHumanReadable(params) {
  var d = params.data.input.data;

  // ✅ Case 1: content only
  if (d && d.content) {
    let output = `> ${d.content}`;
    // replace any rogue "-" from appended article/story/event strings
    output = output.replace(/^- /gm, "> ");
    return { text: output, mrkdwn: true };
  }

  // ✅ Case 2: walker (unchanged)
  var lines = [];

  function walk(obj) {
    if (!obj) return;
    for (var field in obj) {         
      var value = obj[field];
      if (value === null || value === undefined || value === "") continue;

      if (typeof value === "object") {
        walk(value);
      } else {
        // original walker logic
        lines.push("> *" + field + "*: " + value);
      }
    }
  }

  if (d) {
    if (d.signalUuid) delete d.signalUuid;
    walk(d);
  }

  if (lines.length === 0) {
    return { text: "⚠️ walker ran, but no primitives were collected" };
  }

  // 🔥 Replace any dashes in the final output with ">"
  const formatted = lines.join("\n").replace(/^- /gm, "> ");

  return { text: formatted, mrkdwn: true };
}

function handlerRaw(params) {
  var d = params.data.input.data;

  // ✅ Helper: flatten any value into a plain string
  function flattenValue(val) {
    if (val === null || val === undefined) return "";
    if (Array.isArray(val)) {
      return val.map(flattenValue).join(", ");
    }
    if (typeof val === "object") {
      if (val.domain && typeof val.domain === "string") return val.domain;
      if (val.domain && val.domain.domain) return val.domain.domain;
      return Object.values(val).map(flattenValue).filter(Boolean).join(", ");
    }
    return String(val);
  }

  // Optional preferred order for common event fields
  var PREFERRED_EVENT_ORDER = [
    "eventDate",
    "eventType",
    "primaryIssue",
    "shutdownStatus",
    "estimatedCost",
    "affectedServices",
    "resolutionOutlook",
    "url",
    "source",
    "pubDate"
  ];

  // Preferred order for mention signals
  var PREFERRED_MENTION_ORDER = [
    "eventDate",
    "personName",
    "associatedTopic",
    "mentionContext",
    "referencedLocation",
    "eventType"
  ];

  // ✅ Case 1: subject/content
  if (d && d.subject && d.content) {
    return {
      headers: ["Subject", "Content"],
      values: [[String(d.subject), String(d.content)]],
    };
  }

  // ✅ Case 2: events → dynamic headers from event.data and top-level event fields
  if (d && d.events && d.events.length > 0) {
    var values = [];

    // Collect keys in first-seen order from both ev.data and ev (top-level)
    var seen = Object.create(null);
    var keyOrder = [];
    for (var iH = 0; iH < d.events.length; iH++) {
      var evH = d.events[iH];

      // data-level keys
      if (evH && evH.data) {
        for (var kH in evH.data) {
          if (!seen[kH]) {
            seen[kH] = true;
            keyOrder.push(kH);
          }
        }
      }
      // top-level event keys that should appear as columns
      if (evH) {
        for (var tk in evH) {
          if (tk === "data" || tk === "relatedArticleIds" || tk === "relatedStoryIds") continue;
          if (!seen[tk]) {
            seen[tk] = true;
            keyOrder.push(tk);
          }
        }
      }
    }

    // Reorder for known signal types
    if (keyOrder.length) {
      var inSet = {};
      keyOrder.forEach(function (k) { inSet[k] = true; });

      var ordered = [];
      var pref =
        d.signalType === "MENTIONS"
          ? PREFERRED_MENTION_ORDER
          : (d.signalType === "EVENT" || d.signalType === "INCIDENT" || d.signalType === "TOPIC" || d.signalType === "ALERT")
          ? PREFERRED_EVENT_ORDER
          : null;

      if (pref) {
        for (var pi = 0; pi < pref.length; pi++) {
          var pk = pref[pi];
          if (inSet[pk]) ordered.push(pk);
        }
        for (var ki = 0; ki < keyOrder.length; ki++) {
          var kk = keyOrder[ki];
          if (ordered.indexOf(kk) === -1) ordered.push(kk);
        }
        keyOrder = ordered;
      }
    }

    var headers = keyOrder.slice();
    headers.push("Related Articles", "Related Stories");

    for (var i = 0; i < d.events.length; i++) {
      var ev = d.events[i];
      var row = [];

      // Cells in header order; read from ev.data first, then ev top-level
      for (var h = 0; h < keyOrder.length; h++) {
        var key = keyOrder[h];
        var raw =
          (ev && ev.data && ev.data[key] !== undefined) ? ev.data[key]
          : (ev && ev[key] !== undefined) ? ev[key]
          : "";
        row.push(flattenValue(raw));
      }

      // Linked articles
      var articleList = [];
      if (ev && ev.relatedArticleIds && d.articles) {
        for (var j = 0; j < ev.relatedArticleIds.length; j++) {
          var aid = ev.relatedArticleIds[j];
          var art = d.articles[aid];
          if (art) {
            var text = (art.title || "");
            if (art.url) text += " (" + art.url + ")";
            articleList.push(text);
          }
        }
      }
      row.push(articleList.join("\n"));

      // Linked stories
      var storyList = [];
      if (ev && ev.relatedStoryIds && d.stories) {
        for (var k = 0; k < ev.relatedStoryIds.length; k++) {
          var sid = ev.relatedStoryIds[k];
          var story = d.stories[sid];
          if (story) {
            var stext = (story.title || "");
            if (story.url) stext += " (" + story.url + ")";
            storyList.push(stext);
          }
        }
      }
      row.push(storyList.join("\n"));

      values.push(row);
    }

    return { headers: headers, values: values };
  }

  // ✅ Case 3: no events → headers depend on signal type, include title/content if present
  if (d) {
    var values = [];
    var row = [];
    var headers = [];

    var hasTitle = !!d.title;
    var hasContent = !!d.content;
    var hasArticles = !!d.articles;
    var hasStories = !!d.stories;

    // Choose headers by signal type
    if (d.signalType === "TOPIC") {
      if (hasTitle) headers.push("Title");
      if (hasContent) headers.push("Content");
      if (hasArticles) headers.push("Articles");
      if (hasStories) headers.push("Stories");
    } else if (d.signalType === "INCIDENT" || d.signalType === "ALERT") {
      if (hasTitle) headers.push("Title");
      if (hasContent) headers.push("Content");
      if (hasArticles) headers.push("Related Articles");
      if (hasStories) headers.push("Related Stories");
    } else if (d.signalType === "MENTIONS") {
      if (hasTitle) headers.push("Title");
      if (hasContent) headers.push("Content");
      if (hasArticles) headers.push("Related Articles");
      if (hasStories) headers.push("Related Stories");
    } else {
      // Default
      if (hasTitle) headers.push("Title");
      if (hasContent) headers.push("Content");
      if (hasArticles) headers.push("Articles");
      if (hasStories) headers.push("Stories");
    }

    // Row in same order
    if (hasTitle) row.push(String(d.title || ""));
    if (hasContent) row.push(String(d.content || ""));

    if (hasArticles) {
      var articleList2 = [];
      for (var id in d.articles) {
        var art2 = d.articles[id];
        if (art2) {
          var text2 = (art2.title || "");
          if (art2.url) text2 += " (" + art2.url + ")";
          articleList2.push(text2);
        }
      }
      row.push(articleList2.join("\n"));
    }

    if (hasStories) {
      var storyList2 = [];
      for (var sid2 in d.stories) {
        var story2 = d.stories[sid2];
        if (story2) {
          var stext2 = (story2.title || "");
          if (story2.url) stext2 += " (" + story2.url + ")";
          storyList2.push(stext2);
        }
      }
      row.push(storyList2.join("\n"));
    }

    if (row.length > 0) values.push(row);
    return { headers: headers, values: values };
  }

  return { headers: [], values: [] };
}

// Faithful JS reimplementation of the v1 JINJA node "Data" (templateType "csv"):
//   { "text": {% if data.input.data %}{{data.input.data| shape}}{% else %}null{% endif %} }
// Jinja truthiness: null/undefined/false/0/""/empty array/empty object are falsy -> text: null.
function handlerCsv(params) {
  var d = params.data.input.data;
  function jinjaTruthy(v) {
    if (v === undefined || v === null || v === false) return false;
    if (typeof v === "number") return v !== 0;
    if (typeof v === "string") return v.length > 0;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "object") return Object.keys(v).length > 0;
    return true;
  }
  return { text: jinjaTruthy(d) ? d : null };
}

function handlerHtml(params) {
  var d = params.data.input.data;

  function esc(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // ✅ Helper for source flattening
  function formatSource(value) {
    if (typeof value === "object") {
      if (value.domain) {
        if (typeof value.domain === "object" && value.domain.domain) {
          return value.domain.domain;
        }
        return value.domain;
      }
    }
    return value;
  }

  // Helper to flatten nested objects and arrays
  function formatValue(value, field) {
    // ✅ Handle source explicitly
    if (field === "source") return formatSource(value);

    if (value === null || value === undefined) return "";
    if (typeof value === "object") {
      if (Array.isArray(value)) return value.map(v => formatValue(v)).join(", ");
      let flat = [];
      for (var k in value) {
        flat.push(`${k}: ${formatValue(value[k])}`);
      }
      return flat.join(", ");
    }
    return String(value);
  }

  // Top-level header
  var topHeader = `<h4>⚡️New Perigon Signal Alert</h4>`;

  // 🌟 Case 0 — when payload has data.title + data.content (Markdown)
  if (d && d.title && d.content) {
    function mdToHtml(src) {
      let s = String(src).replace(/\r\n/g, "\n");
      // links
      s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
      // bold
      s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
      // italics: *...* then _..._
      s = s.replace(/\*(.+?)\*/g, "<em>$1</em>");
      s = s.replace(/_([^_]+)_/g, "<em>$1</em>");
      // blockquote
      s = s.replace(/^\s*>\s?(.*)$/gm, "<blockquote>$1</blockquote>");
      // hr
      s = s.replace(/\n---\n/g, "\n<hr>\n");

      const lines = s.split("\n");
      let out = [];
      let inList = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*•\s+/.test(line)) {
          if (!inList) {
            inList = true;
            out.push("<ul>");
          }
          out.push("<li>" + line.replace(/^\s*•\s+/, "") + "</li>");
        } else {
          if (inList) {
            out.push("</ul>");
            inList = false;
          }
          out.push(line);
        }
      }
      if (inList) out.push("</ul>");
      s = out.join("\n");
      s = s.replace(/\n/g, "<br>");
      return s;
    }

    let html =
      topHeader +
      `<div>` +
      `<h2>${esc(d.title)}</h2>` +
      mdToHtml(d.content) +
      `</div>`;

    return {
      body: {
        contentType: "html",
        content: html
      }
    };
  }

  // ✅ Case 1: subject + content
  if (d && d.subject && d.content) {
    let html = `${topHeader}<div><h2>${esc(d.subject)}</h2><p><i>${esc(d.content)}</i></p></div>`;
    return {
      body: {
        contentType: "html",
        content: html
      }
    };
  }

  // ✅ Case 2: events
  if (d && d.events && d.events.length > 0) {
    var maxEvents = 3;
    var limit = d.events.length > maxEvents ? maxEvents : d.events.length;

    var htmlParts = [];
    htmlParts.push(topHeader);
    htmlParts.push("<div>");

    for (var i = 0; i < limit; i++) {
      var ev = d.events[i];

      if (ev.data) {
        for (var field in ev.data) {
          var value = ev.data[field];
          if (value !== null && value !== undefined && value !== "") {
            htmlParts.push(`<b>${esc(field)}</b>: ${esc(formatValue(value, field))}<br>`);
          }
        }
      }

      if (ev.relatedArticleIds && d.articles) {
        for (var j = 0; j < ev.relatedArticleIds.length; j++) {
          var aid = ev.relatedArticleIds[j];
          var art = d.articles[aid];
          if (art) {
            htmlParts.push(
              `📄 <b>Article</b>: <a href="${esc(art.url)}">${esc(art.title)}</a><br>`
            );
          }
        }
      }

      if (ev.relatedStoryIds && d.stories) {
        for (var k = 0; k < ev.relatedStoryIds.length; k++) {
          var sid = ev.relatedStoryIds[k];
          var story = d.stories[sid];
          if (story) {
            htmlParts.push(
              `📰 <b>Story</b>: ${esc(story.title)}${story.slug ? ` (slug: ${esc(story.slug)})` : ""}<br>`
            );
          }
        }
      }

      if (i < limit - 1) {
        htmlParts.push('<hr style="border:0;border-top:1px solid #ccc;">');
      } else {
        htmlParts.push("<br>");
      }
    }

    if (d.events.length > maxEvents) {
      htmlParts.push(
        `<i>To see the rest of your Signal data, head to <a href="https://perigon.io/signals/${d.signalUuid}">this link</a></i>`
      );
    }

    htmlParts.push("</div>");
    return {
      body: {
        contentType: "html",
        content: htmlParts.join("")
      }
    };
  }

  // ✅ Case 3: No events, but articles/stories exist
  if (d && (!d.events || d.events.length === 0) && (d.articles || d.stories)) {
    var htmlParts = [];
    htmlParts.push(topHeader);
    htmlParts.push("<div>");

    if (d.title) htmlParts.push(`<h2>${esc(d.title)}</h2>`);
    if (d.content) htmlParts.push(`<p><i>${esc(d.content)}</i></p>`);

    if (d.articles) {
      for (var aid in d.articles) {
        var art = d.articles[aid];
        if (!art) continue;
        htmlParts.push(`📄 <a href="${esc(art.url)}">${esc(art.title)}</a><br>`);
      }
      htmlParts.push("<br>");
    }

    if (d.stories) {
      for (var sid in d.stories) {
        var story = d.stories[sid];
        if (!story) continue;
        htmlParts.push(
          `📰 ${esc(story.title)}${story.slug ? ` (slug: ${esc(story.slug)})` : ""}<br>`
        );
      }
    }

    htmlParts.push("</div>");
    return {
      body: {
        contentType: "html",
        content: htmlParts.join("")
      }
    };
  }

  // ✅ Fallback
  return {
    body: {
      contentType: "html",
      content: `${topHeader}<div>⚠️ No data available</div>`
    }
  };
}

function handlerXml(params) {
  const data = (params.data && params.data.input && params.data.input.data) || {};
  let html = "<body>";

  // Subject + Content
  if (data.subject) {
    html += `<h3>${data.subject}</h3>`;
  }
  if (data.content) {
    html += `<p>${data.content}</p><hr/>`;
  }

  // Articles
  if (data.articles) {
    let hasArticles = false;
    for (let k in data.articles) {
      const article = data.articles[k];
      if (!article) continue;
      if (!hasArticles) {
        html += `<h4>Articles:</h4><ul>`;
        hasArticles = true;
      }

      // Title with link
      if (article.title) {
        html += `<li>`;
        html += article.url
          ? `<a href="${article.url}">${article.title}</a>`
          : article.title;
        if (article.domain) html += ` (${article.domain})`;
        html += `</li>`;
      }

      // Other fields
      for (let field in article) {
        if (["title", "url", "domain"].includes(field)) continue;
        const val = article[field];
        if (typeof val === "string" || typeof val === "number") {
          html += `<li>${field}: ${val}</li>`;
        } else if (Array.isArray(val)) {
          val.forEach(v => (html += `<li>${field}: ${v}</li>`));
        } else if (val && typeof val === "object") {
          for (let sub in val) {
            const subVal = val[sub];
            if (Array.isArray(subVal)) {
              subVal.forEach(v => (html += `<li>${field}.${sub}: ${v}</li>`));
            } else {
              html += `<li>${field}.${sub}: ${subVal}</li>`;
            }
          }
        }
      }
    }
    if (hasArticles) html += `</ul>`;
  }

  // Events
  if (Array.isArray(data.events) && data.events.length > 0) {
    html += `<h4>Events:</h4><ul>`;
    data.events.forEach(ev => {
      const e = (ev && ev.data) || {};
      for (let field in e) {
        html += `<li>${field}: ${e[field]}</li>`;
      }
    });
    html += `</ul>`;
  }

  // Stories
  if (data.stories) {
    let hasStories = false;
    for (let k in data.stories) {
      const story = data.stories[k];
      if (!story) continue;
      if (!hasStories) {
        html += `<h4>Stories:</h4><ul>`;
        hasStories = true;
      }
      for (let field in story) {
        html += `<li>${field}: ${story[field]}</li>`;
      }
    }
    if (hasStories) html += `</ul>`;
  }

  // Fallback
  if (html === "<body>") {
    for (let field in data) {
      html += `<p>${field}: ${data[field]}</p>`;
    }
  }

  html += "</body>";

  return {
    body: {
      contentType: "html",
      content: html
    }
  };
}

function handlerBasic(params) {
  var d = params.data.input.data;
  var lines = [];
  var MAX_LENGTH = 30000;
  var totalLength = 0;
  var truncated = false;
  var signalUrl = "";

  function addLine(text) {
    if (truncated) return;
    if (totalLength + text.length > MAX_LENGTH) {
      truncated = true;
      lines.push("... [TRUNCATED]");
      return;
    }
    lines.push(text);
    totalLength += text.length + 1;
  }

  // Resolve "source" to a readable string
  function resolveSource(src) {
    if (!src) return "";
    if (typeof src === "string") return src;
    // common shapes: { domain: { domain: "example.com" } } or { domain: "example.com" } or { url: "https://..." }
    if (typeof src === "object") {
      if (src.domain) {
        if (typeof src.domain === "object" && src.domain.domain) return src.domain.domain;
        if (typeof src.domain === "string") return src.domain;
      }
      if (src.url) return String(src.url);
    }
    try { return JSON.stringify(src); } catch (e) { return ""; }
  }

  // helper to print an article object in compact form
  function printArticle(id, article) {
    if (!article) {
      addLine("  Article ID: " + id + " (not found)");
      return;
    }
    addLine("  Article ID: " + id);
    if (article.title) addLine("    title: " + article.title);
    if (article.url) addLine("    url: " + article.url);
    if (article.domain) addLine("    domain: " + article.domain);
    if (article.pubDate) addLine("    pubDate: " + article.pubDate);
    try {
      if (article.highlights && article.highlights.summary && article.highlights.summary.length) {
        addLine("    highlights.summary: " + article.highlights.summary.join(" | "));
      }
    } catch (e) {}
  }

  function walk(obj, parentKey, articlesMap) {
    if (!obj || truncated) return;
    if (Array.isArray(obj)) {
      obj.forEach((item) => {
        if (typeof item === "object") {
          walk(item, parentKey, articlesMap);
          addLine("");
        } else {
          addLine((parentKey ? parentKey + ": " : "") + item);
        }
      });
      return;
    }
    if (typeof obj === "object") {
      for (var field in obj) {
        if (truncated) return;
        var value = obj[field];
        if (value === null || value === undefined || value === "") continue;

        // Inline event + article pairing
        if (field === "events" && Array.isArray(value)) {
          value.forEach(function(event) {
            addLine("eventType: " + (event.data && event.data.eventType ? event.data.eventType : ""));
            if (event.data && typeof event.data === "object") {
              for (var ed in event.data) {
                if (ed === "eventType") continue; // avoid duplicate eventType
                var ev = event.data[ed];
                if (ev === null || ev === undefined || ev === "") continue;

                // FIX: ensure "source" is not empty for Salesforce EVENT payloads
                if (ed === "source") {
                  var srcText = resolveSource(ev);
                  if (srcText) {
                    addLine("  source: " + srcText);
                  }
                  continue;
                }

                if (typeof ev === "object") {
                  addLine("  " + ed + ": " + JSON.stringify(ev));
                } else {
                  addLine("  " + ed + ": " + ev);
                }
              }
            }
            if (event.eventDate) addLine("  eventDate: " + event.eventDate);
            if (event.relatedArticleIds && Array.isArray(event.relatedArticleIds) && event.relatedArticleIds.length) {
              addLine("  Articles:");
              event.relatedArticleIds.forEach(function(aid) {
                printArticle(aid, articlesMap[aid]);
              });
            }
            addLine("");
          });
          continue;
        }

        if (field === "articles") continue;

        if (typeof value === "object") {
          // also normalize stray "source" objects outside event.data
          if (field === "source") {
            var norm = resolveSource(value);
            if (norm) addLine("source: " + norm);
            continue;
          }
          walk(value, field, articlesMap);
          if (field === "events" || field === "stories") addLine("");
        } else {
          addLine(field + ": " + value);
        }
      }
      if (parentKey === "events" || parentKey === "stories") addLine("");
      return;
    }
    addLine((parentKey ? parentKey + ": " : "") + obj);
  }

  if (d) {
    if (d.signalName) {
      addLine("signalName: " + d.signalName);
      addLine("");
      delete d.signalName;
    }

    if (d.signalType) delete d.signalType;
    if (d.signalImageUrl) delete d.signalImageUrl;

    var articlesMap = {};
    if (d.articles && typeof d.articles === "object") {
      articlesMap = d.articles;
      delete d.articles;
    }

    if (d.signalUuid) {
      signalUrl = "https://perigon.io/signals/" + d.signalUuid;
      delete d.signalUuid;
    }

    walk(d, null, articlesMap);
  }

  while (lines.length && lines[lines.length - 1] === "") lines.pop();

  if (signalUrl) {
    lines.push("");
    lines.push("To view full signal, go to " + signalUrl);
  }

  return { text: lines.join("\n") };
}

function handlerGoogleDocs(params) {
  var d = params.data.input.data;
  var requests = [];
  var index = Number(params.data.input.metadata.googleDocs.startIndex || 1);

  function getTimestamp() {
    var now = new Date();
    return now.toISOString().replace("T", " ").split(".")[0] + " UTC";
  }

  function insertText(text) {
    if (!text) return;
    requests.push({ insertText: { location: { index: index }, text: text } });
    index += text.length;
  }

  function insertLineBreak() {
    requests.push({ insertText: { location: { index: index }, text: "\n" } });
    index += 1;
  }

  function setBold(start, end, bold) {
    if (start >= end) return;
    requests.push({
      updateTextStyle: {
        range: { startIndex: start, endIndex: end },
        textStyle: { bold: bold },
        fields: "bold",
      },
    });
  }

  function setItalic(start, end, italic) {
    if (start >= end) return;
    requests.push({
      updateTextStyle: {
        range: { startIndex: start, endIndex: end },
        textStyle: { italic: italic },
        fields: "italic",
      },
    });
  }

  function setFontSize(start, end, size) {
    if (start >= end) return;
    requests.push({
      updateTextStyle: {
        range: { startIndex: start, endIndex: end },
        textStyle: { fontSize: { magnitude: size, unit: "PT" } },
        fields: "fontSize",
      },
    });
  }

  function setColor(start, end, rgb) {
    if (start >= end) return;
    requests.push({
      updateTextStyle: {
        range: { startIndex: start, endIndex: end },
        textStyle: { foregroundColor: { color: { rgbColor: rgb } } },
        fields: "foregroundColor",
      },
    });
  }

  function insertBoldKeyValue(key, value) {
    if (!key) return;
    var keyText = key + ": ";
    var start = index;
    insertText(keyText);
    setBold(start, start + keyText.length, true);
    insertText(value + "\n");
    setBold(start + keyText.length, index, false);
  }

  // sanitize markdown to plain text exactly like we use for content
  function sanitize(md) {
    if (!md) return "";
    var s = md;
    s = s.replace(/\*\*(.*?)\*\*/g, "$1");
    s = s.replace(/\[\[?(.*?)\]?\((https?:\/\/[^\s)]+)\)/g, "$1");
    s = s.replace(/\[([^\]]+)\]/g, "$1");
    s = s.replace(/^>\s*/gm, "");
    s = s.replace(/---/g, "");
    s = s.replace(/\*(\w+):\s*\*/g, "$1:");
    s = s.replace(/_(\w+):\s*_+/g, "$1:");
    s = s.replace(/_(.*?)_/g, "$1");
    s = s.replace(/\*(?!\s)([^*]+?)\*/g, "$1");
    s = s.replace(/\r/g, "");
    s = s.replace(/[ \t]+\n/g, "\n");
    s = s.replace(/\n{3,}/g, "\n\n");
    s = s.replace(/[ \t]{2,}/g, " ");
    return s;
  }

  if (d.title && d.content) {
    var header =
      "⚡ New Signal Alert: " +
      (d.signalName || "Untitled Signal") +
      " – " +
      getTimestamp() +
      "\n";
    var start = index;
    insertText(header);
    setBold(start, index, true);
    setFontSize(start, index, 14);

    // Title line
    var titleStart = index;
    var label = "Title: ";
    insertText(label + d.title + "\n");
    setBold(titleStart, titleStart + 5, true);
    setBold(titleStart + 5, titleStart + 7, false);
    var valueStart = titleStart + 7;
    setBold(valueStart, valueStart + d.title.length, false);
    setColor(valueStart, valueStart + d.title.length, {
      red: 67 / 255,
      green: 67 / 255,
      blue: 67 / 255,
    });
    insertLineBreak();

    var content = sanitize(d.content).trim();

    var italicMatches = [];
    var m;

    var italUnderscore = /(^|[^_])_(?!\s)([^_]+?)_(?!_)/g;
    while ((m = italUnderscore.exec(d.content)) !== null) {
      var innerU = sanitize(m[2]);
      if (innerU && innerU.length > 0 && !/:$/.test(innerU)) italicMatches.push(innerU);
    }

    var italAsterisk = /(^|[^*])\*(?!\s)([^*]+?)\*(?!\*)/g;
    while ((m = italAsterisk.exec(d.content)) !== null) {
      var innerA = sanitize(m[2]);
      if (innerA && innerA.length > 0 && !/:$/.test(innerA)) italicMatches.push(innerA);
    }

    var startContent = index;
    insertText(content + "\n");
    setFontSize(startContent, index, 12);

    var searchFrom = 0;
    for (var k = 0; k < italicMatches.length; k++) {
      var txt = italicMatches[k];
      var foundPos = content.indexOf(txt, searchFrom);
      if (foundPos >= 0 && txt.length > 0) {
        setItalic(startContent + foundPos, startContent + foundPos + txt.length, true);
        searchFrom = foundPos + txt.length;
      }
    }

    var linkRegex = /\[\[?(.*?)\]?\((https?:\/\/[^\s)]+)\)/g;
    while ((m = linkRegex.exec(d.content)) !== null) {
      var text = sanitize(m[1]).trim();
      var url = m[2].trim();
      if (!text) continue;
      var pos = content.indexOf(text, 0);
      if (pos >= 0) {
        var linkStart = startContent + pos;
        requests.push({
          updateTextStyle: {
            range: { startIndex: linkStart, endIndex: linkStart + text.length },
            textStyle: { link: { url: url } },
            fields: "link",
          },
        });
      }
    }

    insertLineBreak();

    if (d.articles && Object.keys(d.articles).length > 0) {
      var startA = index;
      insertText("Articles:\n");
      setBold(startA, index, true);
      setFontSize(startA, index, 13);
      insertLineBreak();

      for (var key in d.articles) {
        var a = d.articles[key];
        if (!a || !a.title || !a.url) continue;
        var domainA =
          a.domain ||
          (a.url.match(/https?:\/\/([^/]+)/)
            ? a.url.match(/https?:\/\/([^/]+)/)[1].replace("www.", "")
            : "");
        var lineA = "    • " + a.title + " – " + domainA + "\n";
        var startTitle = index + 6;
        insertText(lineA);
        setItalic(startTitle, startTitle + a.title.length, true);
        if (domainA.length > 0) {
          requests.push({
            updateTextStyle: {
              range: { startIndex: index - domainA.length - 1, endIndex: index - 1 },
              textStyle: { link: { url: a.url } },
              fields: "link",
            },
          });
        }
      }
      insertLineBreak();
    }
  } else {
    if (d.signalName) {
      var header =
        "⚡ New Signal Alert: " + d.signalName + " – " + getTimestamp() + "\n";
      var start = index;
      insertText(header);
      setBold(start, index, true);
      setFontSize(start, index, 14);
      if (d.title) insertText("Title: " + d.title + "\n");
      insertLineBreak();
    }

    insertLineBreak();
    if (d.events && d.events.length > 0) {
      for (var i = 0; i < d.events.length; i++) {
        var ev = d.events[i];
        var e = ev.data || {};

        var eventHeader = "• Event " + (i + 1) + ":\n";
        var ehStart = index;
        insertText(eventHeader);
        setBold(ehStart, index, true);

        function flatten(obj, prefix) {
          for (var k in obj) {
            if (obj[k] && typeof obj[k] === "object") {
              flatten(obj[k], prefix ? prefix + "." + k : k);
            } else if (
              obj[k] !== null &&
              obj[k] !== undefined &&
              obj[k] !== ""
            ) {
              var keyName = prefix ? prefix + "." + k : k;
              insertBoldKeyValue(keyName, String(obj[k]));
            }
          }
        }

        flatten(e);
        // removed extra blank line before "Related Articles"
        // insertLineBreak();

        if (
          ev.relatedArticleIds &&
          ev.relatedArticleIds.length > 0 &&
          d.articles
        ) {
          var relatedArticles = ev.relatedArticleIds
            .map(function (id) {
              return d.articles[id];
            })
            .filter(Boolean);

          if (relatedArticles.length > 0) {
            var startA = index;
            insertText("Related Articles:\n");
            setBold(startA, index, true);
            setFontSize(startA, index, 11); // keep 11pt
            // removed extra blank line between header and bullets
            // insertLineBreak();

            for (var j = 0; j < relatedArticles.length; j++) {
              var a = relatedArticles[j];
              if (!a || !a.title || !a.url) continue;
              var domainA =
                a.domain ||
                (a.url.match(/https?:\/\/([^/]+)/)
                  ? a.url.match(/https?:\/\/([^/]+)/)[1].replace("www.", "")
                  : "");

              var lineA = "    • " + a.title + " – " + domainA + "\n";
              var startTitle = index + 6;
              insertText(lineA);
              setItalic(startTitle, startTitle + a.title.length, true);
              if (domainA.length > 0) {
                requests.push({
                  updateTextStyle: {
                    range: { startIndex: index - domainA.length - 1, endIndex: index - 1 },
                    textStyle: { link: { url: a.url } },
                    fields: "link",
                  },
                });
              }
            }

            insertLineBreak();
          }
        }
      }
    }
  }

  insertLineBreak();
  if (d.signalUuid) {
    var url = "https://perigon.io/signals/" + d.signalUuid;
    insertText("To view full signal, go to ");
    var linkStart = index;
    insertText(url + "\n");
    requests.push({
      updateTextStyle: {
        range: { startIndex: linkStart, endIndex: linkStart + url.length },
        textStyle: { link: { url: url } },
        fields: "link",
      },
    });
  }

  insertLineBreak();
  var dividerStart = index;
  insertText("\n");
  var dividerEnd = dividerStart + 1;

  requests.push({
    updateParagraphStyle: {
      paragraphStyle: {
        borderBottom: {
          width: { magnitude: 1.5, unit: "PT" },
          padding: { magnitude: 1, unit: "PT" },
          dashStyle: "SOLID",
          color: { color: { rgbColor: { red: 0, green: 0, blue: 0 } } },
        },
      },
      range: { startIndex: dividerStart, endIndex: dividerEnd },
      fields: "borderBottom",
    },
  });

  return { requests: requests };
}

function handlerHubspot(params) {
  var d = params.data.input.data;
  var lines = [];

  function walk(obj) {
    if (!obj) return;
    for (var field in obj) {
      // {...<field>} style
      var value = obj[field];
      if (value === null || value === undefined || value === "") continue;

      if (typeof value === "object") {
        walk(value);
      } else {
        // Bold key with markdown **
        lines.push("**" + field + "**: " + value);
      }
    }
  }

  if (d) {
    if (d.signalUuid) delete d.signalUuid;
    walk(d);
  }

  if (lines.length === 0) {
    return { text: "⚠️ walker ran, but no primitives were collected" };
  }

  return { text: lines.join("\n") };
}

function handlerNotion(params) {
  var d = params.data.input.data;
  var children = [];
  var MAX_EVENTS = 3;
  var MAX_ARTICLES = 3;
  var MAX_STORIES = 3;
  var footerLink = null;

  function getTimestamp() {
    const now = new Date();
    return now.toISOString().replace("T", " ").split(".")[0] + " UTC";
  }

  function addHeader() {
    const headerText = `New Perigon Signal Alert – ${getTimestamp()}`;
    children.push({
      object: "block",
      type: "heading_3",
      heading_3: {
        rich_text: [{ type: "text", text: { content: headerText } }]
      }
    });
  }

  function addHeading(text) {
    children.push({
      object: "block",
      type: "heading_3",
      heading_3: {
        rich_text: [{ type: "text", text: { content: text } }]
      }
    });
  }

  function addParagraph(text, bold) {
    children.push({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: text
          ? [{ type: "text", text: { content: text }, annotations: { bold: !!bold } }]
          : []
      }
    });
  }

  function addBullet(richTextArray) {
    children.push({
      object: "block",
      type: "bulleted_list_item",
      bulleted_list_item: {
        rich_text: richTextArray
      }
    });
  }

  function addDivider() {
    children.push({
      object: "block",
      type: "divider",
      divider: {}
    });
  }

  function formatValue(val) {
    if (val === null || val === undefined) return "";
    if (typeof val === "object") {
      let flat = [];
      for (var k in val) {
        flat.push(`${k}: ${formatValue(val[k])}`);
      }
      return flat.join(", ");
    }
    return String(val);
  }

  function cleanMarkdown(text) {
    if (!text) return "";
    return text
      .replace(/---/g, "")
      .replace(/^>\s*/gm, "")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/\[(.*?)\]\((.*?)\)/g, "$1 ($2)")
      .trim();
  }

  addHeader();

  if (d.title) addParagraph(d.title, true);
  if (d.content) {
    let cleaned = cleanMarkdown(d.content);
    if (cleaned.length > 1900) cleaned = cleaned.slice(0, 1900) + "…";
    addParagraph(cleaned, false);
  }

  // ✅ If there are events → show them + inline articles
  if (d.events && d.events.length > 0) {
    for (var i = 0; i < d.events.length && i < MAX_EVENTS; i++) {
      var ev = d.events[i];
      addParagraph("Event " + (i + 1), true);

      for (var f in ev) {
        if (f === "data" || f === "relatedArticleIds") continue;
        addBullet([{ type: "text", text: { content: f + ": " + formatValue(ev[f]) } }]);
      }

      if (ev.data) {
        var __evOrder = (d.signalType === "EVENT" || d.signalType === "INCIDENT" || d.signalType === "TOPIC" || d.signalType === "ALERT")
          ? ["eventDate", "eventType", "primaryIssue", "shutdownStatus", "estimatedCost", "affectedServices", "resolutionOutlook", "url", "source", "pubDate"]
          : null;
        var __keys = [];
        if (__evOrder) {
          for (var __pi = 0; __pi < __evOrder.length; __pi++) {
            if (Object.prototype.hasOwnProperty.call(ev.data, __evOrder[__pi])) __keys.push(__evOrder[__pi]);
          }
        }
        for (var __rk in ev.data) {
          if (__keys.indexOf(__rk) === -1) __keys.push(__rk);
        }
        for (var __ki = 0; __ki < __keys.length; __ki++) {
          var f2 = __keys[__ki];
          addBullet([{ type: "text", text: { content: f2 + ": " + formatValue(ev.data[f2]) } }]);
        }
      }

      // ✅ Inline related articles per event
      if (ev.relatedArticleIds && ev.relatedArticleIds.length > 0 && d.articles) {
        addParagraph("Related Articles:", true);
        var count = 0;
        for (var j = 0; j < ev.relatedArticleIds.length; j++) {
          var articleId = ev.relatedArticleIds[j];
          var article = d.articles[articleId];
          if (!article) continue;
          if (count >= MAX_ARTICLES) break;

          var domain =
            article.domain ||
            (article.url.match(/https?:\/\/([^/]+)/)
              ? article.url.match(/https?:\/\/([^/]+)/)[1]
              : "");

          addBullet([
            { type: "text", text: { content: article.title + " – " } },
            { type: "text", text: { content: domain, link: { url: article.url } } }
          ]);

          count++;
        }
      }
    }

    if (d.events.length > MAX_EVENTS && d.signalUuid) {
      footerLink = "…View full signal: https://v5.perigon.io/signals/" + d.signalUuid;
    }

  // ✅ Else: If no events, show standalone articles
  } else if (d.articles) {
    addHeading("Articles:");
    var count = 0;
    for (var k in d.articles) {
      if (count >= MAX_ARTICLES) {
        footerLink = "…View more: https://perigon.io/signals/" + d.signalUuid;
        break;
      }
      var article = d.articles[k];
      if (!article) continue;

      var domain =
        article.domain ||
        (article.url.match(/https?:\/\/([^/]+)/)
          ? article.url.match(/https?:\/\/([^/]+)/)[1]
          : "");

      addBullet([
        { type: "text", text: { content: article.title + " – " } },
        { type: "text", text: { content: domain, link: { url: article.url } } }
      ]);

      count++;
    }
  }

  // --- STORIES (unchanged) ---
  if (d.stories) {
    addHeading("Stories:");
    var scount = 0;
    for (var k2 in d.stories) {
      if (scount >= MAX_STORIES) {
        footerLink = "…View more: https://v5.perigon.io/signals/" + d.signalUuid;
        break;
      }
      var story = d.stories[k2];
      if (!story) continue;

      addBullet([
        { type: "text", text: { content: story.title + " – " } },
        { type: "text", text: { content: "perigon.io", link: { url: story.slug } } }
      ]);

      scount++;
    }
  }

  // ✅ Always show footer link
  if (footerLink) {
    addParagraph("");
    addParagraph(footerLink, false);
  }

  addDivider();

  if (children.length === 0) {
    addParagraph("⚠️ No events, articles, or stories available.");
    addDivider();
  }

  return { children };
}

function handlerSlack(params) {
  // 🔧 FIX: support both nested (data.data) and flat (data) payloads
  var d = params.data.input.data?.data || params.data.input.data;
  var header = "⚡️ *New Perigon Signal Alert*";

  function clean(str) {
    if (!str) return "";
    if (typeof str === "object") return JSON.stringify(str, null, 2);
    return String(str)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, (m, text, url) => `<${url}|${text}>`)
      .replace(/\[([a-z0-9.,\\-\\s]+?\\.[a-z]{2,}(?:,[^]]+?)*)\]/gi, (_, domains) =>
        domains
          .split(/,\\s*/)
          .map(domain => {
            const d = domain.trim().replace(/^https?:\/\//, "");
            return `<https://${d}|${d}>`;
          })
          .join(", ")
      )
      .replace(/---/g, "────────────")
      .replace(/\*\*/g, "*")
      .replace(/<br\s*\/?>/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // ✅ NEW HELPER: Flatten nested objects, with special case for `source`
  function formatValue(value, parentKey = "") {
    if (value == null) return "";
    if (typeof value === "string") return clean(value);

    if (typeof value === "object") {
      // ✅ Special case: if parent key is "source" and it has nested domain
      if (parentKey === "source") {
        if (value.domain) {
          // Handle nested object { domain: { domain: "spectrumnews1.com" } }
          if (typeof value.domain === "object" && value.domain.domain) {
            return formatValue(value.domain.domain, "source");
          }
          return formatValue(value.domain, "source");
        }
      }

      const keys = Object.keys(value);
      if (keys.length === 1) return formatValue(value[keys[0]], parentKey);

      const flat = [];
      for (const key of keys) {
        const val = formatValue(value[key], key);
        if (val !== "") flat.push(`${key}: ${val}`);
      }
      return flat.join(", ");
    }

    return String(value);
  }

  function truncateWithFooter(bodyText, footerText, limit = 2900) {
    if (!footerText) return bodyText.slice(0, limit);
    const reserved = footerText.length + 10;
    const maxBody = Math.max(0, limit - reserved);
    if (bodyText.length <= maxBody) return bodyText + "\n\n" + footerText;

    let truncated = bodyText.slice(0, maxBody);
    const lastBreak = Math.max(truncated.lastIndexOf("\n"), truncated.lastIndexOf(" "));
    if (lastBreak > maxBody * 0.8) truncated = truncated.slice(0, lastBreak);
    truncated = truncated.trimEnd() + "\n\n… (truncated)";
    return truncated + "\n\n" + footerText;
  }

  function buildFooter() {
    if (!d.signalUuid) return "";
    const url = `https://perigon.io/signals/${d.signalUuid}`;
    return `🔗 *View complete signal:* <${url}|Open in Perigon>`;
  }

  // === main ===
  var lines = [];

  if (d && d.events && d.events.length > 0) {
    lines.push(`${header}\n*${clean(d.signalName || "Perigon Signal")}*`, "");
    for (var i = 0; i < d.events.length && i < 3; i++) {
      var e = d.events[i].data || {};
      var kv = [];
      for (var key in e) {
        var val = e[key];
        // ✅ FIX: handle empty/null/structured source properly
        if (key === "source") {
          const formattedSource = formatValue(val, "source");
          if (formattedSource) kv.push(`*${key}:* ${formattedSource}`);
        } else if (val != null && val !== "") {
          kv.push(`*${key}:* ${formatValue(val, key)}`);
        }
      }

      // Inline event section
      var eventText = kv.map(v => `> ${v}`).join("\n");

      // Inline article link (same paragraph)
      var relatedIds = d.events[i].relatedArticleIds || [];
      if (relatedIds && relatedIds.length > 0) {
        for (var j = 0; j < relatedIds.length; j++) {
          var aid = relatedIds[j];
          var art = d.articles && d.articles[aid];
          if (art) {
            eventText += `\n> 📄 *Article:* <${art.url}|${clean(art.title)}>`;
          }
        }
      }

      lines.push("> *Event:*\n" + eventText, "");
    }

    if (d.events.length > 3) lines.push("… (more events truncated)");
  } else if (d && (d.title || d.content)) {
    const title = clean(d.title || "Perigon Signal");
    const content = clean(d.content || "");
    lines.push(`${header}\n\n*${title}*\n\n${content}`);
    if (d.articles) {
      lines.push("\n*Articles:*");
      for (var aid in d.articles) {
        var art = d.articles[aid];
        if (art) lines.push(`📄 <${art.url}|${clean(art.title)}>`); 
      }
    }
  } else if (d && d.subject && d.content) {
    lines.push(`${header}\n\n*${clean(d.subject)}*\n\n${clean(d.content)}`);
  } else {
    lines.push(`${header}\n\n⚠️ No data available`);
  }

  const footer = buildFooter();
  const text = truncateWithFooter(lines.join("\n"), footer, 2900);
  return { text, mrkdwn: true };
}

function handlerTeams(params) {
  var d = params.data.input.data;

  function esc(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // ✅ Markdown to HTML converter (lightweight)
  function mdToHtml(text) {
    if (!text) return "";
    return text
      .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")                              // bold
      .replace(/(^|[^\w])_([^_]+?)_(?!\w)/g, "$1<i>$2</i>")                // italics via _
      .replace(/\*(.*?)\*/g, "<i>$1</i>")                                  // italics via *
      .replace(/`(.*?)`/g, "<code>$1</code>")                              // inline code
      .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>')               // hyperlinks
      .replace(/\n---\n/g, "<hr>")                                         // horizontal rule
      .replace(/\n/g, "<br>");                                             // line breaks
  }

  // ✅ Helper to format source value cleanly
  function formatValue(field, value) {
    if (field === "source" && typeof value === "object") {
      if (value.domain) {
        if (typeof value.domain === "object" && value.domain.domain) {
          return esc(value.domain.domain);
        }
        return esc(value.domain);
      }
    }
    return esc(value);
  }

  // Start with top-level header
  var topHeader = `<h1>⚡️New Perigon Signal Alert</h1>`;

  // ✅ Case 1: title + content handled separately (markdown enabled)
  if (d && d.title && d.content) {
    let html = `${topHeader}<div><h2>${esc(d.title)}</h2><p>${mdToHtml(d.content)}</p>`;
    
    // Append Articles if exist
    if (d.articles) {
      html += "<h2>Articles</h2>";
      for (var aid in d.articles) {
        var art = d.articles[aid];
        if (!art) continue;
        html += `📄 <a href="${esc(art.url)}">${esc(art.title)}</a><br>`;
      }
    }

    // Append Stories if exist
    if (d.stories) {
      html += "<h2>Stories</h2>";
      for (var sid in d.stories) {
        var story = d.stories[sid];
        if (!story) continue;
        html += `📰 ${esc(story.title)}${story.slug ? ` (slug: <a href="${esc(story.slug)}">${esc(story.slug)}</a>)` : ""}<br>`;
      }
    }

    html += "</div>";
    return {
      body: {
        contentType: "html",
        content: html
      }
    };
  }

  // ✅ Case 2: events
  if (d && d.events && d.events.length > 0) {
    var maxEvents = 3;
    var limit = d.events.length > maxEvents ? maxEvents : d.events.length;

    var htmlParts = [];
    htmlParts.push(topHeader);
    htmlParts.push("<div><h2>Events</h2>");

    for (var i = 0; i < limit; i++) {
      var ev = d.events[i];

      if (ev.data) {
        for (var field in ev.data) {
          var value = ev.data[field];
          if (value !== null && value !== undefined && value !== "") {
            htmlParts.push(`<b>${esc(field)}</b>: ${formatValue(field, value)}<br>`);
          }
        }
      }

      if (ev.relatedArticleIds && d.articles) {
        for (var j = 0; j < ev.relatedArticleIds.length; j++) {
          var aid = ev.relatedArticleIds[j];
          var art = d.articles[aid];
          if (art) {
            htmlParts.push(
              `📄 <b>Article</b>: <a href="${esc(art.url)}">${esc(art.title)}</a><br>`
            );
          }
        }
      }

      if (ev.relatedStoryIds && d.stories) {
        for (var k = 0; k < ev.relatedStoryIds.length; k++) {
          var sid = ev.relatedStoryIds[k];
          var story = d.stories[sid];
          if (story) {
            htmlParts.push(
              `📰 <b>Story</b>: ${esc(story.title)}${story.slug ? ` (slug: ${esc(story.slug)})` : ""}<br>`
            );
          }
        }
      }

      if (i < limit - 1) {
        htmlParts.push('<hr style="border:0;border-top:1px solid #ccc;">');
      } else {
        htmlParts.push("<br>");
      }
    }

    if (d.events.length > maxEvents) {
      htmlParts.push(
        `<i>To see the rest of your Signal data, head to <a href="https://perigon.io/signals/${d.signalUuid}">this link</a></i>`
      );
    }

    htmlParts.push("</div>");
    return {
      body: {
        contentType: "html",
        content: htmlParts.join("")
      }
    };
  }

  // ✅ Case 3: No events, but articles/stories exist
  if (d && (!d.events || d.events.length === 0) && (d.articles || d.stories)) {
    var htmlParts = [];
    htmlParts.push(topHeader);
    htmlParts.push("<div>");

    if (d.title) htmlParts.push(`<h2>${esc(d.title)}</h2>`);
    if (d.content) htmlParts.push(`<p>${mdToHtml(d.content)}</p>`); // use markdown, do not force italics

    if (d.articles) {
      htmlParts.push("<h2>Articles</h2>");
      for (var aid in d.articles) {
        var art = d.articles[aid];
        if (!art) continue;
        htmlParts.push(`📄 <a href="${esc(art.url)}">${esc(art.title)}</a><br>`);
      }
      htmlParts.push("<br>");
    }

    if (d.stories) {
      htmlParts.push("<h2>Stories</h2>");
      for (var sid in d.stories) {
        var story = d.stories[sid];
        if (!story) continue;
        htmlParts.push(`📰 ${esc(story.title)}${story.slug ? ` (slug: ${esc(story.slug)})` : ""}<br>`);
      }
    }

    htmlParts.push("</div>");
    return {
      body: {
        contentType: "html",
        content: htmlParts.join("")
      }
    };
  }

  // ✅ Fallback
  return {
    body: {
      contentType: "html",
      content: `${topHeader}<div>⚠️ No data available</div>`
    }
  };
}

function handlerZoho(params) {
  var d = params.data.input.data;
  if (!d) return { text: "⚠️ No data received" };

  // ✅ NEW: handle case where we have title + content
  if (d.title && d.content) {
    var lines = [];

    // Basic Markdown → HTML cleanup
    var contentHTML = d.content
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>") // bold
      .replace(/\*(.*?)\*/g, "<i>$1</i>") // italic with asterisks → <i>
      .replace(/_(.*?)_/g, "<i>$1</i>") // italic with underscores → <i>
      .replace(/^>\s*(.*)$/gm, "<blockquote>$1</blockquote>") // blockquote
      .replace(/^•\s*(.*)$/gm, "• $1") // bullets
      .replace(/\n---\n/g, "<hr>"); // horizontal rules

    lines.push(
      "<strong>⚡ New Signal Alert:</strong> " +
        (d.signalName || "Untitled Signal")
    );
    lines.push(
      "<strong>🕒 Timestamp:</strong> " +
        new Date().toISOString().replace("T", " ").split(".")[0] +
        " UTC"
    );
    lines.push("");
    lines.push("<strong>🧩 Title:</strong> " + d.title);
    lines.push("");
    lines.push(contentHTML.trim());
    lines.push("");
    lines.push(
      "<a href='https://perigon.io/signals/" +
        (d.signalUuid || "") +
        "'>🔗 View Full Signal</a>"
    );
    return { text: lines.join("\n") };
  }

  // 1️⃣ Message mode
  if (d.message && d.message.subject && d.message.content) {
    return {
      text: [
        "<strong>📌 " + d.message.subject + "</strong>",
        "",
        d.message.content,
      ].join("\n"),
    };
  }

  var lines = [];

  // 2️⃣ Signal array case
  if (d.signals && Array.isArray(d.signals)) {
    d.signals.forEach((signal) => processSignal(signal, lines));
  }
  // 3️⃣ Single signal object case
  else if (d.signalName) {
    processSignal(d, lines);
  } else {
    return { text: "⚠️ No signals found in data" };
  }

  return { text: lines.join("\n") };

  // ✅ NEW Helper to format source value cleanly (minimal addition)
  function formatValue(field, value) {
    if (field === "source" && typeof value === "object") {
      if (value.domain) {
        if (typeof value.domain === "object" && value.domain.domain) {
          return value.domain.domain;
        }
        return value.domain;
      }
    }
    return value;
  }

  // 🔧 Helper function
  function processSignal(signal, lines) {
    lines.push(
      "<strong>🔔 Signal:</strong> " + (signal.signalName || "Unnamed")
    );
    lines.push("");

    // Events (limit 3)
    if (
      signal.events &&
      Array.isArray(signal.events) &&
      signal.events.length > 0
    ) {
      var limit = Math.min(3, signal.events.length);
      for (var i = 0; i < limit; i++) {
        var ev = signal.events[i];
        lines.push(
          "🗓️ <strong>Event Date:</strong> " + (ev.eventDate || "N/A")
        );

        if (ev.data) {
          for (var key in ev.data) {
            var value = formatValue(key, ev.data[key]); // ✅ use formatted value
            lines.push("<strong>" + key + ":</strong> " + value);
          }
        }

        if (ev.relatedArticleIds && signal.articles) {
          ev.relatedArticleIds.forEach((aid) => {
            var art = signal.articles[aid];
            if (art) {
              lines.push("🔗 <a href='" + art.url + "'>" + art.title + "</a>");
            }
          });
        }

        lines.push(""); // spacing
      }

      if (signal.events.length > 3) {
        lines.push("➡️ <em>To see the rest of your Signal data, head to:</em>");
        lines.push(
          "<a href='https://perigon.io/signals/" +
            signal.signalUuid +
            "'>Open Signal</a>"
        );
      }
    }
    // Articles + Stories if no events
    else {
      if (signal.articles) {
        lines.push("<strong>📚 Articles:</strong>");
        for (var aid in signal.articles) {
          var art = signal.articles[aid];
          lines.push("🔗 <a href='" + art.url + "'>" + art.title + "</a>");
        }
        lines.push("");
      }

      if (signal.stories) {
        lines.push("<strong>📖 Stories:</strong>");
        for (var sid in signal.stories) {
          var story = signal.stories[sid];
          // ✅ Only change: removed “slug: ”
          lines.push("📝 <strong>" + story.title + "</strong> " + story.slug);
        }
        lines.push("");
      }
    }
  }
}

export default async function (ctx) {
  const input = (ctx && ctx.input) || {};
  const params = { data: { input: input } };

  // 1) templateType dispatch (v1 entry switch "switchHuman_Readableraw", exact matches)
  switch (input.templateType) {
    case "Human-readable": return handlerHumanReadable(params);
    case "raw":            return handlerRaw(params);
    case "csv":            return handlerCsv(params);
    case "html":           return handlerHtml(params);
    case "xml":            return handlerXml(params);
    case "basic":          return handlerBasic(params);
  }

  // 2) connectorId dispatch (v1 "Switch1"); accepts BOTH the v1 connector id and the v2 slug.
  switch (input.connectorId) {
    case "9f9fb638-e095-43fd-9709-2ec59ae655a8":       // v1 google docs
    case "googleDocs":                                  // v2 slug
    case "google docs":                                 // v2 slug (spaced variant)
      return handlerGoogleDocs(params);
    case "_knexa_8f2b6ed4-c417-4423-b14f-1b53fa6903a1": // v1 hubspot (served as HTTP 400/isError in v1)
    case "hubspot":
      return handlerHubspot(params);                    // v2: normal return, no throw
    case "_knexa_03adc8ba-4265-46ae-bf48-e466917203fa": // v1 notion
    case "notion":
      return handlerNotion(params);
    case "_knexa_c9085d88-85d0-4436-82c6-4e42d6aba4c6": // v1 slack
    case "slack":
      return handlerSlack(params);
    case "_knexa_66da971c-5c57-4de8-9b85-371d24c5fb45": // v1 teams
    case "microsoftTeams":
      return handlerTeams(params);
    case "_knexa_f1759157-e673-4a98-898e-71a0346ccab9": // v1 zoho
    case "zohoCrm":
    case "zoho":                                        // v2 slug (short variant)
      return handlerZoho(params);
  }

  // Unknown templateType + connectorId: v1 dead-ended with no response.
  return {};
}