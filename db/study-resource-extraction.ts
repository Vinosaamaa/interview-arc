import { Parser } from "htmlparser2";
import { MAX_RESOURCE_TEXT, type ResourceExtraction } from "./study-resource-policy.ts";

export async function extractStudyResource(bytes: Uint8Array, filename: string): Promise<ResourceExtraction> {
  const only = (warning: string): ResourceExtraction => ({ method: "original-only", sections: [], warnings: [warning] });
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  if (new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-") {
    let pdf;
    try {
      const { getDocumentProxy } = await import("unpdf");
      pdf = await getDocumentProxy(Uint8Array.from(bytes), { useSystemFonts: false });
      if (pdf.numPages > 2000) return only("Original PDF saved. More than 2000 pages exceeds this reading limit; split into smaller reading copies.");
      const sections: ResourceExtraction["sections"] = []; let characters = 0, emptyPages = 0;
      for (let page = 1; page <= pdf.numPages; page++) {
        const content = await (await pdf.getPage(page)).getTextContent();
        const text = content.items.map(item => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("");
        characters += text.length;
        if (characters > MAX_RESOURCE_TEXT) return only("Original PDF saved. Text exceeds the 2 million character reading limit; split into smaller reading copies.");
        if (!text.trim()) emptyPages++;
        sections.push({ location: `Page ${page}`, text });
      }
      return { method: "pdfjs-v1", sections, warnings: [
        `PDF has ${pdf.numPages} pages. Text order is parser-derived; diagrams, layout and scans need page-image inspection.`,
        ...(emptyPages ? [`${emptyPages} pages have no extractable text. Inspect their page images; do not treat them as empty pages.`] : []),
      ] };
    } catch { return only("Original PDF saved. Its reading copy could not be parsed. A password, unsupported PDF structure or resource limit may require a separate reading copy."); }
    finally { await pdf?.loadingTask.destroy(); }
  }
  if (!/^(txt|md|markdown|csv|tsv|json|jsonl|xml|yaml|yml|log|html|htm|css|js|ts|tsx|jsx|java|py|go|rs|c|cpp|h|sql|sh|rb)$/.test(extension)) {
    return only("Original saved. This format is not text-readable here yet. Download and attach it directly to a compatible ChatGPT chat, or upload a text/PDF reading copy.");
  }
  let source: string;
  try { source = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return only("Original saved. Text encoding is not UTF-8; upload a UTF-8 reading copy to make the text searchable."); }
  if (source.includes("\0")) return only("Original saved. Binary content was detected instead of readable text.");
  if (source.length > MAX_RESOURCE_TEXT) return only("Original saved. Text exceeds the 2 million character reading limit. Split it into smaller reading copies.");
  if (extension !== "html" && extension !== "htm") return { method: "text-v1", sections: [{ location: "Document", text: source }], warnings: [] };
  let text = ""; let skip = 0; let assets = 0;
  const excluded = new Set(["script", "style", "noscript", "template"]);
  const blocks = new Set(["p", "div", "section", "article", "main", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "tr", "table", "blockquote", "details", "summary"]);
  const stack: boolean[] = [];
  const parser = new Parser({
    onopentag(name, attrs) {
      const excludedHere = excluded.has(name); stack.push(excludedHere); if (excludedHere) skip++;
      if (skip) return;
      if (name === "br" || blocks.has(name)) text += "\n";
      if (name === "td" || name === "th") text += "\t";
      if (["img", "svg", "canvas", "iframe", "video", "audio", "object"].includes(name)) {
        assets++; text += `\n[${name}: ${attrs.alt || attrs.title || "inspect original"}]\n`;
      }
    },
    ontext(value) { if (!skip) text += value; },
    onclosetag(name) { if (stack.pop()) skip--; if (!skip && blocks.has(name)) text += "\n"; },
  }, { decodeEntities: true });
  parser.write(source); parser.end();
  if (text.length > MAX_RESOURCE_TEXT) return only("Original saved. HTML reading copy exceeds the text limit; split into smaller files.");
  return { method: "html-v1", sections: [{ location: "HTML document", text }], warnings: [
    "HTML text includes collapsed sections present in the saved file. Scripts and styles are omitted from the reading copy. Scripts are never run and external content is never fetched.",
    ...(assets ? [`${assets} visual or embedded elements need inspection in the original. Images referenced outside a saved HTML file are not included in its bytes.`] : []),
  ] };
}
