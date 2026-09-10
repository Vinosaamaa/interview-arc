"use client";
import { useState } from "react";
import Link from "next/link";
import "../../chatgpt-practice.css";
export default function LeetcodeConnectionPage() {
  const [message,setMessage]=useState(""); const [busy,setBusy]=useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form=event.currentTarget; const data=new FormData(form);setBusy(true);setMessage("");
    try {
      const response=await fetch("/api/integrations/leetcode",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({session:data.get("session"),csrf:data.get("csrf")})});
      form.reset(); const result=await response.json();
      setMessage(response.ok?`Connected as ${result.username}. ${result.isPremium?"Premium access confirmed.":"Standard account access confirmed."} You can return to ChatGPT.`:result.error);
    } catch {form.reset();setMessage("Connection could not be confirmed. Check status before trying again.");}
    finally {setBusy(false);}
  }
  async function status(disconnect=false) {
    setBusy(true);
    try {const response=await fetch("/api/integrations/leetcode",disconnect?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"disconnect"})}:{cache:"no-store"});const result=await response.json();setMessage(result.connected?`Connected as ${result.username}. ${result.isPremium?"Premium access confirmed.":""}`:result.message??result.error??"LeetCode is disconnected.");}
    catch {setMessage("Could not check the connection.");}finally{setBusy(false);}
  }
  return <main className="chatgpt-practice" style={{maxWidth:680,margin:"48px auto",padding:20}}><section className="chatgpt-import-editor">
    <h1>Connect LeetCode</h1><p>Connect your own submissions and editorial access to Interview Arc and ChatGPT. Your Mac can be asleep after this connection is saved.</p>
    <ol><li>Sign in at <a href="https://leetcode.com/accounts/login/" target="_blank" rel="noreferrer">LeetCode</a> in a desktop browser.</li><li>Open that browser’s developer tools → Application or Storage → Cookies → leetcode.com.</li><li>Copy the values named <strong>LEETCODE_SESSION</strong> and <strong>csrftoken</strong> into the fields below. Do not paste them into a chat.</li></ol>
    <form onSubmit={submit} autoComplete="off"><label>LEETCODE_SESSION<input name="session" type="password" required maxLength={6000} autoComplete="off" spellCheck={false}/></label><label>csrftoken<input name="csrf" type="password" required maxLength={128} autoComplete="off" spellCheck={false}/></label><button type="submit" disabled={busy}>Connect and verify</button></form>
    <p className="chatgpt-import-note">These values grant access to your LeetCode account. Arc stores them privately on Cloudflare and exposes only read operations to ChatGPT. They are never returned in chat. If LeetCode expires the session, sign in again and replace both values here.</p>
    <div className="chatgpt-import-actions"><button disabled={busy} onClick={()=>void status()}>Check connection</button><button disabled={busy} onClick={()=>void status(true)}>Disconnect LeetCode</button><Link href="/">Back to Arc</Link></div><p role="status">{message}</p>
  </section></main>;
}
