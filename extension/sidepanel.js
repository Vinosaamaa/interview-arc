const API_BASE = "https://limitless-mcp.vinosama.workers.dev";
const OUTCOMES = [null, "solved", "solved_after_reviewing_approach", "failed"];

const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.id, element]));
let token = "";
let problemUrl = "";
let state = null;
let activity = null;
let renderInterval = null;

function practiceDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function clock(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  return [Math.floor(safe / 3600), Math.floor((safe % 3600) / 60), safe % 60]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function elapsed(timer) {
  if (!timer) return 0;
  return timer.accumulatedSeconds + (timer.runningSince ? Math.max(0, Math.floor((Date.now() - timer.runningSince) / 1000)) : 0);
}

async function activeLeetCodeUrl() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const match = tab?.url?.match(/^https:\/\/(?:www\.)?leetcode\.com\/problems\/([a-z0-9-]+)/i);
  return match ? `https://leetcode.com/problems/${match[1].toLowerCase()}/` : "";
}

async function api(path, init = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  if (response.status === 401) {
    await chrome.storage.local.remove("interviewArcToken");
    token = "";
    showConnect();
    throw new Error("Connection expired");
  }
  if (!response.ok) throw new Error(`Interview Arc returned ${response.status}`);
  return response.json();
}

function showConnect() {
  elements["connect-view"].hidden = false;
  elements["practice-view"].hidden = true;
  elements.disconnect.hidden = true;
  elements["sync-light"].classList.remove("live");
}

function outcomeCopy(outcome) {
  if (outcome === "solved") return ["⚑", "Solved"];
  if (outcome === "solved_after_reviewing_approach") return ["⚑", "After reviewing approach"];
  if (outcome === "failed") return ["⚑", "Failed"];
  return ["⚐", "Not set"];
}

function renderClock() {
  if (!activity) return;
  const timer = activity.timer;
  elements.clock.textContent = clock(elapsed(timer));
  elements["clock-label"].textContent = timer?.completed ? "FINAL TIME" : timer?.runningSince ? "RUNNING" : "STOPWATCH";
  elements["toggle-timer"].textContent = timer?.runningSince ? "Ⅱ" : "▶";
  elements["toggle-timer"].disabled = Boolean(timer?.completed);
  elements["finish-timer"].textContent = timer?.completed ? "✓" : "■";
  elements["finish-timer"].disabled = Boolean(timer?.completed);
}

function render() {
  elements["connect-view"].hidden = true;
  elements["practice-view"].hidden = false;
  elements.disconnect.hidden = false;
  elements["sync-light"].classList.add("live");
  elements["problem-link"].href = problemUrl;
  elements["problem-title"].textContent = activity?.title ?? problemUrl.match(/\/problems\/([^/]+)/)?.[1]?.replaceAll("-", " ") ?? "Open a LeetCode problem";
  elements["not-planned"].hidden = Boolean(activity);
  elements["activity-workspace"].hidden = !activity;
  if (!activity) return;

  const [flag, result] = outcomeCopy(activity.outcome);
  elements["outcome-button"].className = `status-button outcome ${activity.outcome ?? "unset"}`;
  elements["outcome-button"].querySelector("span").textContent = flag;
  elements["outcome-button"].querySelector("strong").textContent = result;
  const publication = activity.publicationStatus ?? "draft";
  elements["publication-button"].className = `status-button publication ${publication}`;
  elements["publication-button"].querySelector("span").textContent = publication === "published" ? "✓" : publication === "ready" ? "↑" : "◇";
  elements["publication-button"].querySelector("strong").textContent = publication === "published" ? "In journal" : publication === "ready" ? "Ready for journal" : "Finish to journal";
  elements["publication-button"].disabled = true;
  elements.notes.value = activity.personalNote ?? "";
  renderClock();
}

async function refresh() {
  problemUrl = await activeLeetCodeUrl();
  if (!problemUrl) {
    elements["problem-title"].textContent = "Open a LeetCode problem";
    return;
  }
  state = await api(`/companion/state?date=${practiceDate()}&url=${encodeURIComponent(problemUrl)}`);
  activity = state.currentActivity;
  render();
}

async function mutate(mutation) {
  await api("/companion/mutations", {
    method: "POST",
    body: JSON.stringify({ date: practiceDate(), mutation }),
  });
  await refresh();
}

elements["connect-button"].addEventListener("click", async () => {
  const value = elements["token-input"].value.trim();
  if (!value.startsWith("ia_")) return;
  token = value;
  await chrome.storage.local.set({ interviewArcToken: token });
  try { await refresh(); } catch { showConnect(); }
});
elements["add-button"].addEventListener("click", () => mutate({ type: "add-leetcode", url: problemUrl }));
elements["toggle-timer"].addEventListener("click", () => mutate({ type: "timer", activityId: activity.id, action: activity.timer?.runningSince ? "pause" : "start" }));
elements["finish-timer"].addEventListener("click", () => mutate({ type: "timer", activityId: activity.id, action: "finish" }));
elements["outcome-button"].addEventListener("click", () => {
  const current = OUTCOMES.indexOf(activity.outcome ?? null);
  mutate({ type: "outcome", activityId: activity.id, outcome: OUTCOMES[(current + 1) % OUTCOMES.length] });
});
elements["save-note"].addEventListener("click", async () => {
  elements["note-state"].textContent = "Saving…";
  await mutate({ type: "activity-note", activityId: activity.id, note: elements.notes.value });
  elements["note-state"].textContent = "Saved to Interview Arc";
});
elements["open-dashboard"].addEventListener("click", () => chrome.tabs.create({ url: "https://limitless.vinosama.workers.dev/" }));
elements.disconnect.addEventListener("click", async () => {
  await chrome.storage.local.remove("interviewArcToken");
  token = "";
  activity = null;
  showConnect();
});

chrome.tabs.onActivated.addListener(() => token && refresh().catch(() => {}));
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => changeInfo.url && token && refresh().catch(() => {}));

(async () => {
  token = (await chrome.storage.local.get("interviewArcToken")).interviewArcToken ?? "";
  if (!token) showConnect();
  else {
    try { await refresh(); } catch { showConnect(); }
  }
  renderInterval = window.setInterval(renderClock, 1000);
})();

window.addEventListener("unload", () => window.clearInterval(renderInterval));
