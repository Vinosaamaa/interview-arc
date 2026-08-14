import HomeClient from "./home-client";
import { loadContentIndex } from "../db/content";
import { dateInTimeZone } from "./current-day";
import engineeringJournal from "../engineering-journal/generated/index.json";
import type { EngineeringJournalIndex } from "../engineering-journal/index";

// Content now lives in D1 (mirrored from Git by scripts/import-content.mjs), so
// render dynamically per request instead of baking content in at build time.
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Page({ searchParams }: PageProps) {
  const route = await searchParams;
  const content = await loadContentIndex();
  return <HomeClient
    content={content}
    today={dateInTimeZone(new Date())}
    engineering={engineeringJournal as EngineeringJournalIndex}
    initialLocation={{
      workspace: firstParam(route?.workspace),
      view: firstParam(route?.view),
      learn: firstParam(route?.learn),
      engineering: firstParam(route?.engineering),
    }}
  />;
}
