"use client";

import { useId, useState } from "react";

export default function LearnCoursePrompt() {
  const id = useId();
  const [subject, setSubject] = useState("");
  const [notice, setNotice] = useState("");
  const prompt = `Use Interview Arc's Learning Specialist to help me learn ${subject.trim() || "a new subject"} systematically. Read the learning guide and check my existing courses first. Ask about missing goals, background and available time, then save a course outline with ordered topics, lessons, exercises and checkpoints. Show me the outline for approval before enrollment. After I approve, publish the lesson guides to Learn and teach me from them, keeping homework and progress there.`;
  return <details className="learn-course-prompt">
    <summary><span>＋</span> Plan a new course</summary>
    <div>
      <label htmlFor={id}>What would you like to learn?</label>
      <input id={id} value={subject} onChange={e => { setSubject(e.target.value); setNotice(""); }} placeholder="e.g. Network Essentials" maxLength={200} />
      <p>Build an outline with ChatGPT, review it, then learn one lesson at a time.</p>
      <button type="button" onClick={async () => {
        try { await navigator.clipboard.writeText(prompt); setNotice("Copied. Paste into ChatGPT with Interview Arc connected."); }
        catch { setNotice("Copy the prompt below into your connected ChatGPT chat."); }
      }}>Copy course prompt ↗</button>
      {notice && <p role="status">{notice}</p>}
      <details className="learn-course-prompt-text"><summary>View prompt</summary><p>{prompt}</p></details>
    </div>
  </details>;
}
