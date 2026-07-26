const INTERVIEW_ARC_ORIGIN = "https://limitless.vinosama.workers.dev";
const OUTCOMES = [null, "solved", "solved_after_reviewing_approach", "failed"];

const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.id, element]));
let token = "";
let problemUrl = "";
let state = null;
let activity = null;
let renderInterval = null;
let refreshInterval = null;
let refreshPromise = null;
let refreshQueued = false;
let mutationQueue = Promise.resolve();
let pendingMutations = 0;
let mutationSequence = 0;
let contextRevision = 0;
let renderedActivityId = "";
let notesDirty = false;

class CompanionAPIError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "CompanionAPIError";
    this.status = status;
  }

  get unauthorized() {
    return this.status === 401;
  }
}

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

async function activeTabContext() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const match = tab?.url?.match(/^https:\/\/(?:www\.)?leetcode\.com\/problems\/([a-z0-9-]+)/i);
  if (match) {
    return {
      kind: "leetcode",
      problemUrl: `https://leetcode.com/problems/${match[1].toLowerCase()}/`,
    };
  }
  try {
    const url = new URL(tab?.url ?? "");
    if (url.origin === INTERVIEW_ARC_ORIGIN) {
      return { kind: "dashboard", problemUrl: "" };
    }
  } catch {
    // Chrome internal and extension pages do not have a usable activity URL.
  }
  return { kind: "other", problemUrl: "" };
}

async function api(path, init = {}, credential = token) {
  let envelope;
  try {
    envelope = await chrome.runtime.sendMessage(
      InterviewArcCompanionNetwork.requestMessage(path, init, credential),
    );
  } catch {
    envelope = {
      kind: "transport-error",
      code: "worker",
      message: "The Companion network worker could not start.",
    };
  }
  if (!envelope || envelope.kind === "transport-error") {
    throw new CompanionAPIError(
      `${envelope?.message ?? "Chrome could not reach Interview Arc"} Recheck the connection.`,
    );
  }
  if (!envelope.ok) {
    throw new CompanionAPIError(
      envelope.status === 401
        ? "This connection token is no longer accepted."
        : `Interview Arc is temporarily unavailable (${envelope.status}).`,
      envelope.status,
    );
  }
  return envelope.body;
}

function showConnect() {
  elements["connect-view"].hidden = false;
  elements["offline-view"].hidden = true;
  elements["practice-view"].hidden = true;
  elements.disconnect.hidden = true;
  elements["sync-light"].classList.remove("live");
  elements["sync-light"].classList.remove("syncing");
  elements["sync-light"].classList.remove("error");
}

function showOffline(error) {
  elements["connect-view"].hidden = true;
  elements["offline-view"].hidden = false;
  elements["practice-view"].hidden = true;
  elements.disconnect.hidden = false;
  elements["offline-message"].textContent = error?.message
    ?? "Interview Arc is temporarily unavailable. Your saved connection is still intact.";
  setSyncStatus("error");
}

async function handleConnectionFailure(error) {
  if (error instanceof CompanionAPIError && error.unauthorized) {
    await chrome.storage.local.remove("interviewArcToken");
    token = "";
    showConnect();
    return;
  }
  showOffline(error);
}

function setSyncStatus(status) {
  elements["sync-light"].classList.toggle("live", status === "live");
  elements["sync-light"].classList.toggle("syncing", status === "syncing");
  elements["sync-light"].classList.toggle("error", status === "error");
  elements["sync-light"].title = status === "syncing"
    ? "Synchronizing with Interview Arc"
    : status === "error"
      ? "Interview Arc could not synchronize"
      : "Connected to Interview Arc";
}

function outcomeCopy(outcome) {
  if (outcome === "solved") return ["⚑", "Solved"];
  if (outcome === "solved_after_reviewing_approach") return ["⚑", "After reviewing approach"];
  if (outcome === "failed") return ["⚑", "Failed"];
  return ["⚐", "Not set"];
}

function currentActivityStarred() {
  if (!activity?.questionId) return false;
  return Boolean(state?.problemPreferences?.some(
    (preference) => preference.specialty === activity.type
      && preference.questionId === activity.questionId
      && preference.starred,
  ));
}

function renderClock() {
  if (!activity) return;
  const timer = activity.timer;
  elements.clock.textContent = clock(elapsed(timer));
  elements["clock-label"].textContent = timer?.completed ? "FINAL TIME" : timer?.runningSince ? "RUNNING" : "STOPWATCH";
  elements["toggle-timer"].textContent = timer?.runningSince ? "Ⅱ" : "▶";
  elements["toggle-timer"].disabled = Boolean(timer?.completed);
  elements["finish-timer"].textContent = timer?.completed ? "✓" : "■";
  elements["finish-timer"].disabled = Boolean(timer?.completed || !timer?.startedAt || !activity.outcome);
}

function render() {
  const activityChanged = renderedActivityId !== (activity?.id ?? "");
  elements["connect-view"].hidden = true;
  elements["offline-view"].hidden = true;
  elements["practice-view"].hidden = false;
  elements.disconnect.hidden = false;
  if (!elements["sync-light"].classList.contains("syncing") && !elements["sync-light"].classList.contains("error")) {
    setSyncStatus("live");
  }
  const activityUrl = activity?.url?.match(/^https:\/\/(?:www\.)?leetcode\.com\/problems\/[a-z0-9-]+\/?/i)?.[0] ?? "";
  const openUrl = activityUrl || problemUrl;
  elements["problem-link"].href = openUrl || "#";
  elements["problem-link"].hidden = !openUrl;
  elements["problem-title"].textContent = activity?.title ?? problemUrl.match(/\/problems\/([^/]+)/)?.[1]?.replaceAll("-", " ") ?? "Open a LeetCode problem";
  elements["not-planned"].hidden = Boolean(activity);
  elements["activity-workspace"].hidden = !activity;
  if (!activity) {
    renderedActivityId = "";
    return;
  }

  const [flag, result] = outcomeCopy(activity.outcome);
  elements["outcome-button"].className = `status-button outcome ${activity.outcome ?? "unset"}`;
  elements["outcome-button"].querySelector("span").textContent = flag;
  elements["outcome-button"].querySelector("strong").textContent = result;
  const publication = activity.publicationStatus ?? "draft";
  elements["outcome-button"].disabled = Boolean(!activity.timer?.startedAt || publication === "published");
  elements["outcome-button"].title = !activity.timer?.startedAt
    ? "Start the stopwatch before choosing a result"
    : publication === "published"
      ? "Published results are read-only"
      : "Cycle result";
  elements["publication-button"].className = `status-button publication ${publication}`;
  elements["publication-button"].querySelector("span").textContent = publication === "published" ? "✓" : publication === "ready" ? "↑" : "◇";
  elements["publication-button"].querySelector("strong").textContent = publication === "published" ? "In journal" : publication === "ready" ? "Ready for journal" : "Finish to journal";
  elements["publication-button"].disabled = true;
  const starred = currentActivityStarred();
  elements["favorite-button"].classList.toggle("starred", starred);
  elements["favorite-button"].textContent = starred ? "★" : "☆";
  elements["favorite-button"].disabled = !activity.questionId;
  elements["favorite-button"].setAttribute("aria-pressed", String(starred));
  elements["favorite-button"].setAttribute("aria-label", `${starred ? "Unstar" : "Star"} ${activity.title}`);
  elements["favorite-button"].title = activity.questionId
    ? starred ? "Remove from starred problems" : "Keep this problem in your starred review set"
    : "A stable bank question is required to star this activity";
  if (activityChanged || !notesDirty) {
    elements.notes.value = activity.personalNote ?? "";
  }
  renderedActivityId = activity.id;
  renderClock();
}

function applyCompanionState(nextState, context) {
  problemUrl = context.problemUrl;
  state = nextState;
  activity = state.currentActivity;
  render();
  setSyncStatus("live");
}

async function performRefresh() {
  const expectedContextRevision = contextRevision;
  const expectedMutationSequence = mutationSequence;
  const context = await activeTabContext();
  if (context.kind === "other") {
    problemUrl = "";
    activity = null;
    render();
    return;
  }
  const query = new URLSearchParams({ date: practiceDate() });
  if (context.problemUrl) query.set("url", context.problemUrl);
  const nextState = await api(`/companion/state?${query.toString()}`);
  if (expectedContextRevision !== contextRevision || expectedMutationSequence !== mutationSequence || pendingMutations > 0) {
    refreshQueued = true;
    return;
  }
  applyCompanionState(nextState, context);
}

async function validateConnection(candidate) {
  const context = await activeTabContext();
  const query = new URLSearchParams({ date: practiceDate() });
  if (context.problemUrl) query.set("url", context.problemUrl);
  const nextState = await api(`/companion/state?${query.toString()}`, {}, candidate);
  return { context, nextState };
}

function refresh() {
  if (!token) return Promise.resolve();
  if (pendingMutations > 0) {
    refreshQueued = true;
    return mutationQueue;
  }
  if (refreshPromise) {
    refreshQueued = true;
    return refreshPromise;
  }
  if (!state) setSyncStatus("syncing");
  refreshPromise = performRefresh()
    .catch(async (error) => {
      await handleConnectionFailure(error);
      throw error;
    })
    .finally(() => {
      refreshPromise = null;
      if (refreshQueued && token && !document.hidden) {
        refreshQueued = false;
        queueMicrotask(() => refresh().catch(() => {}));
      }
    });
  return refreshPromise;
}

function optimisticTimer(action) {
  if (!activity?.timer && action !== "start") return;
  const now = Date.now();
  const current = activity.timer ?? {
    accumulatedSeconds: 0,
    startedAt: null,
    runningSince: null,
    completed: false,
  };
  const foldedSeconds = elapsed(current);
  const timer = action === "start"
    ? { ...current, startedAt: current.startedAt ?? now, runningSince: now, completed: false }
    : action === "pause"
      ? { ...current, accumulatedSeconds: foldedSeconds, runningSince: null }
      : { ...current, accumulatedSeconds: foldedSeconds, runningSince: null, completed: true, completedAt: now };
  activity = {
    ...activity,
    timer,
    ...(action === "finish" ? { publicationStatus: "ready" } : {}),
  };
  render();
}

function mutate(mutation, optimisticUpdate) {
  const sequence = ++mutationSequence;
  const contextPromise = activeTabContext();
  pendingMutations += 1;
  refreshQueued = false;
  if (optimisticUpdate) optimisticUpdate();
  setSyncStatus("syncing");

  mutationQueue = mutationQueue
    .catch(() => {})
    .then(async () => {
      const context = await contextPromise;
      const nextState = await api("/companion/mutations", {
        method: "POST",
        body: JSON.stringify({
          date: practiceDate(),
          url: context.problemUrl,
          mutation,
        }),
      });
      if (sequence === mutationSequence) applyCompanionState(nextState, context);
      return nextState;
    })
    .catch((error) => {
      setSyncStatus("error");
      refreshQueued = true;
      throw error;
    })
    .finally(() => {
      pendingMutations -= 1;
      if (pendingMutations === 0 && refreshQueued && token && !document.hidden) {
        refreshQueued = false;
        queueMicrotask(() => refresh().catch(() => {}));
      }
    });
  return mutationQueue;
}

elements["connect-button"].addEventListener("click", async () => {
  const value = elements["token-input"].value.trim();
  if (!value.startsWith("ia_")) return;
  elements["connect-error"].hidden = true;
  elements["connect-button"].disabled = true;
  try {
    const { context, nextState } = await validateConnection(value);
    token = value;
    await chrome.storage.local.set({ interviewArcToken: token });
    applyCompanionState(nextState, context);
  } catch (error) {
    elements["connect-error"].textContent = error instanceof CompanionAPIError
      ? error.message
      : "Interview Arc could not be reached. Your previous token was not replaced.";
    elements["connect-error"].hidden = false;
  } finally {
    elements["connect-button"].disabled = false;
  }
});
elements["add-button"].addEventListener("click", () => mutate({ type: "add-leetcode", url: problemUrl }));
elements["problem-link"].addEventListener("click", (event) => {
  event.preventDefault();
  const url = elements["problem-link"].href;
  if (/^https:\/\/(?:www\.)?leetcode\.com\/problems\/[a-z0-9-]+\/?/i.test(url)) {
    chrome.tabs.create({ url });
  }
});
elements["toggle-timer"].addEventListener("click", () => {
  if (!activity) return;
  const action = activity.timer?.runningSince ? "pause" : "start";
  const activityId = activity.id;
  mutate({ type: "timer", activityId, action }, () => optimisticTimer(action)).catch(() => {});
});
elements["finish-timer"].addEventListener("click", () => {
  if (!activity) return;
  const activityId = activity.id;
  mutate({ type: "timer", activityId, action: "finish" }, () => optimisticTimer("finish")).catch(() => {});
});
elements["outcome-button"].addEventListener("click", () => {
  if (!activity) return;
  const current = OUTCOMES.indexOf(activity.outcome ?? null);
  const nextOutcome = OUTCOMES[(current + 1) % OUTCOMES.length];
  const activityId = activity.id;
  mutate(
    { type: "outcome", activityId, outcome: nextOutcome },
    () => {
      activity = { ...activity, outcome: nextOutcome };
      render();
    },
  ).catch(() => {});
});
elements["favorite-button"].addEventListener("click", () => {
  if (!activity?.questionId) return;
  const specialty = activity.type;
  const questionId = activity.questionId;
  const starred = !currentActivityStarred();
  mutate(
    { type: "problem-star", specialty, questionId, starred },
    () => {
      state = {
        ...state,
        problemPreferences: [
          ...(state?.problemPreferences ?? []).filter(
            (preference) => !(preference.specialty === specialty && preference.questionId === questionId),
          ),
          { specialty, questionId, starred, updatedAt: Date.now() },
        ],
      };
      render();
    },
  ).catch(() => {});
});
elements["save-note"].addEventListener("click", async () => {
  elements["note-state"].textContent = "Saving…";
  const activityId = activity.id;
  const note = elements.notes.value;
  try {
    await mutate(
      { type: "activity-note", activityId, note },
      () => {
        activity = { ...activity, personalNote: note };
        render();
      },
    );
    notesDirty = false;
    elements["note-state"].textContent = "Saved to Interview Arc";
  } catch {
    elements["note-state"].textContent = "Could not save";
  }
});
elements.notes.addEventListener("input", () => {
  notesDirty = true;
  elements["note-state"].textContent = "Unsaved";
});
elements["open-dashboard"].addEventListener("click", () => chrome.tabs.create({ url: "https://limitless.vinosama.workers.dev/" }));
elements["retry-connection"].addEventListener("click", () => refresh().catch(() => {}));
elements.disconnect.addEventListener("click", async () => {
  await chrome.storage.local.remove("interviewArcToken");
  token = "";
  activity = null;
  showConnect();
});

chrome.tabs.onActivated.addListener(() => {
  contextRevision += 1;
  if (token) refresh().catch(() => {});
});
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (!changeInfo.url) return;
  contextRevision += 1;
  if (token) refresh().catch(() => {});
});

(async () => {
  token = (await chrome.storage.local.get("interviewArcToken")).interviewArcToken ?? "";
  if (!token) showConnect();
  else {
    try { await refresh(); } catch {}
  }
  renderInterval = window.setInterval(renderClock, 1000);
  refreshInterval = window.setInterval(() => {
    if (token && !document.hidden) refresh().catch(() => {});
  }, 1000);
})();

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && token) refresh().catch(() => {});
});

window.addEventListener("unload", () => {
  window.clearInterval(renderInterval);
  window.clearInterval(refreshInterval);
});
