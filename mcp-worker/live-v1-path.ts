export function isLiveV1Path(pathname: string) {
  return pathname === "/live/v1" || pathname.startsWith("/live/v1/");
}
