// LeetCode's community MCP uses LEETCODE_SESSION + csrftoken, not OAuth.
// These fixed GraphQL reads mirror the community leetcode-query client.
export class LeetcodeAccountError extends Error {}
export type LeetcodeCredential = { session: string; csrf: string; username: string; connectedAt: string };
type Bucket = Pick<R2Bucket, "get" | "put" | "delete">;
const key = (owner: string) => {
  if (!/^u_[a-f0-9]{32}$/.test(owner)) throw new LeetcodeAccountError("Sign in to Arc with your account before connecting LeetCode.");
  return `private-integrations/leetcode/${owner}.json`;
};
export function validateLeetcodeSession(session: unknown, csrf: unknown) {
  if (typeof session !== "string" || !/^[A-Za-z0-9._-]{32,6000}$/.test(session) || typeof csrf !== "string" || !/^[A-Za-z0-9]{16,128}$/.test(csrf)) throw new LeetcodeAccountError("Enter only the LEETCODE_SESSION and csrftoken cookie values from your signed-in LeetCode browser.");
  return {session, csrf};
}
export async function leetcodeQuery(query: string, variables: object, credential?: Pick<LeetcodeCredential,"session"|"csrf">, fetcher: typeof fetch = fetch) {
  let response: Response;
  try {
    response = await fetcher("https://leetcode.com/graphql/", {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(15000),
      headers: {"Content-Type":"application/json", Origin:"https://leetcode.com", Referer:"https://leetcode.com/", ...(credential ? {Cookie:`LEETCODE_SESSION=${credential.session}; csrftoken=${credential.csrf}`, "x-csrftoken":credential.csrf} : {})},
      body: JSON.stringify({query,variables}),
    });
  } catch { throw new LeetcodeAccountError("LeetCode could not be reached. Try again later."); }
  if ([401,403].includes(response.status)) throw new LeetcodeAccountError("LeetCode rejected access. Reconnect LeetCode in Arc; if it persists, LeetCode may be blocking hosted requests.");
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json") || !response.body) throw new LeetcodeAccountError("LeetCode returned an unavailable response. No content was retrieved.");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length=0;
  try {
    for (;;) { const part=await reader.read(); if(part.done) break; length+=part.value.length; if(length>2*1024*1024) { await reader.cancel(); throw new LeetcodeAccountError("LeetCode response exceeded the 2 MiB limit."); } chunks.push(part.value); }
  } catch(error) { if(error instanceof LeetcodeAccountError) throw error; throw new LeetcodeAccountError("LeetCode response was interrupted."); }
  finally {reader.releaseLock();}
  try {
    const bytes = new Uint8Array(length); let offset=0; for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const body=JSON.parse(new TextDecoder().decode(bytes));
    if(body.errors?.length || !body.data) throw new Error();
    return body.data;
  } catch {throw new LeetcodeAccountError("LeetCode did not return the requested data. Reconnect if your session has expired.");}
}
export async function verifyLeetcodeSession(credential: Pick<LeetcodeCredential,"session"|"csrf">, fetcher: typeof fetch=fetch) {
  const data=await leetcodeQuery("query { userStatus { username isSignedIn isPremium } }",{},credential,fetcher);
  if(data.userStatus?.isSignedIn!==true || typeof data.userStatus.username!=="string") throw new LeetcodeAccountError("The LeetCode session is expired or invalid. Sign in to LeetCode and reconnect.");
  return {username:data.userStatus.username as string,isPremium:data.userStatus.isPremium===true};
}
export async function connectLeetcode(bucket: Bucket, owner: string, session: unknown, csrf: unknown, fetcher: typeof fetch=fetch) {
  const objectKey=key(owner); const credential=validateLeetcodeSession(session,csrf);
  const status=await verifyLeetcodeSession(credential,fetcher);
  const record={...credential,username:status.username,connectedAt:new Date().toISOString()};
  // Private R2 storage is encrypted at rest. No API or tool returns these credentials.
  await bucket.put(objectKey,JSON.stringify(record),{httpMetadata:{contentType:"application/json",cacheControl:"no-store"}});
  return {connected:true,...status,connectedAt:record.connectedAt};
}
export async function loadLeetcodeCredential(bucket: Bucket, owner: string): Promise<LeetcodeCredential | null> {
  const object=await bucket.get(key(owner)); if(!object) return null;
  if(object.size>8192) throw new LeetcodeAccountError("Reconnect LeetCode to repair the saved connection.");
  const value=await object.json<LeetcodeCredential>(); validateLeetcodeSession(value.session,value.csrf);
  return value;
}
export async function disconnectLeetcode(bucket: Bucket, owner: string) {await bucket.delete(key(owner)); return {connected:false};}
export async function leetcodeConnectionStatus(bucket: Bucket, owner: string, fetcher: typeof fetch=fetch) {
  const credential=await loadLeetcodeCredential(bucket,owner);
  if(!credential) return {connected:false,reconnectRequired:true};
  try {return {connected:true,...await verifyLeetcodeSession(credential,fetcher),connectedAt:credential.connectedAt};}
  catch(error) {return {connected:false,reconnectRequired:true,message:error instanceof LeetcodeAccountError?error.message:"Reconnect LeetCode."};}
}
export async function requireLeetcodeCredential(bucket: Bucket, owner: string) {
  const credential=await loadLeetcodeCredential(bucket,owner);
  if(!credential) throw new LeetcodeAccountError("Connect LeetCode at Arc /connect/leetcode before reading personal submissions or premium editorials.");
  return credential;
}
