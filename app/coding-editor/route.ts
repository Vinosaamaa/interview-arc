import { codingBrowserHtml } from "../../mcp-worker/coding-browser";

// The normal website authentication boundary protects this page and its API.
export function GET() {
  return new Response(codingBrowserHtml, {headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}
