import HomeBootstrap from "./home-bootstrap";
import { dateInTimeZone } from "./current-day";

// Keep login entry cheap: private D1 content is fetched after the shell loads,
// and the interactive dashboard / Git journal are browser chunks, not SSR props.
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Page({ searchParams }: PageProps) {
  const route = await searchParams;
  return <HomeBootstrap
    today={dateInTimeZone(new Date())}
    initialLocation={{
      workspace: firstParam(route?.workspace),
      view: firstParam(route?.view),
      learn: firstParam(route?.learn),
      engineering: firstParam(route?.engineering),
    }}
  />;
}
