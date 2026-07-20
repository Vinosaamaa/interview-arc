import HomeClient from "./home-client";
import { loadContentIndex } from "../db/content";
import { dateInTimeZone } from "./current-day";

// Content now lives in D1 (mirrored from Git by scripts/import-content.mjs), so
// render dynamically per request instead of baking content in at build time.
export const dynamic = "force-dynamic";

export default async function Page() {
  const content = await loadContentIndex();
  return <HomeClient content={content} today={dateInTimeZone(new Date())} />;
}
