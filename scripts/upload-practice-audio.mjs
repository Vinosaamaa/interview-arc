#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

const [activityId, path, label = "Practice answer"] = process.argv.slice(2);
const token = process.env.INTERVIEW_ARC_MCP_TOKEN;
const endpoint = process.env.INTERVIEW_ARC_MCP_URL ?? "https://limitless-mcp.vinosama.workers.dev/audio/upload";
if (!activityId || !path) throw new Error("Usage: node scripts/upload-practice-audio.mjs <activityId> <audio-path> [label]");
if (!token) throw new Error("INTERVIEW_ARC_MCP_TOKEN is required.");
const types = { ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".webm": "audio/webm", ".ogg": "audio/ogg", ".aac": "audio/aac" };
const bytes = await readFile(path);
const type = types[extname(path).toLowerCase()] ?? "audio/mp4";
const form = new FormData();
form.set("activityId", activityId);
form.set("label", label);
form.set("file", new Blob([bytes], { type }), basename(path));
const response = await fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
const body = await response.json();
if (!response.ok) throw new Error(body.error ?? `Upload failed (${response.status}).`);
console.log(JSON.stringify(body, null, 2));
