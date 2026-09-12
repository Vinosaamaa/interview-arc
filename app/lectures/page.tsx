import LectureLibrary from "./player";

export const dynamic = "force-dynamic";
export default async function LecturesPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  return <LectureLibrary initialId={(await searchParams).id ?? null} />;
}
