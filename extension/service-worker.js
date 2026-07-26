const LEETCODE_ORIGIN = "https://leetcode.com";
const LEETCODE_WWW_ORIGIN = "https://www.leetcode.com";
const INTERVIEW_ARC_ORIGIN = "https://limitless.vinosama.workers.dev";

function isSupportedUrl(rawUrl) {
  if (!rawUrl) return false;
  try {
    const url = new URL(rawUrl);
    const isLeetCodeProblem = (
      url.origin === LEETCODE_ORIGIN || url.origin === LEETCODE_WWW_ORIGIN
    ) && url.pathname.startsWith("/problems/");
    return isLeetCodeProblem || url.origin === INTERVIEW_ARC_ORIGIN;
  } catch {
    return false;
  }
}

function actionIcon(active, size) {
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext("2d");
  const scale = size / 32;
  context.scale(scale, scale);

  context.fillStyle = active ? "#0f3b38" : "#aab2b1";
  context.beginPath();
  context.roundRect(1, 1, 30, 30, 7);
  context.fill();

  context.strokeStyle = active ? "#65d5c9" : "#edf0ef";
  context.lineWidth = 3.2;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(7, 22);
  context.bezierCurveTo(11, 21, 13, 18, 15, 14);
  context.bezierCurveTo(17, 10, 20, 7, 26, 6);
  context.stroke();

  context.strokeStyle = active ? "#f07a50" : "#d2d7d6";
  context.lineWidth = 2.7;
  context.beginPath();
  context.moveTo(8, 25);
  context.bezierCurveTo(15, 25, 21, 22, 25, 18);
  context.stroke();
  return context.getImageData(0, 0, size, size);
}

async function initializeTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((tab) => updatePanel(tab.id, tab.url)));
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  initializeTabs().catch(() => {});
});
chrome.runtime.onStartup.addListener(() => initializeTabs().catch(() => {}));

async function updatePanel(tabId, rawUrl) {
  if (!tabId) return;
  const supported = isSupportedUrl(rawUrl);
  await Promise.all([
    chrome.sidePanel.setOptions({
      tabId,
      path: "sidepanel.html",
      enabled: supported,
    }),
    chrome.action.setIcon({
      tabId,
      imageData: {
        16: actionIcon(supported, 16),
        32: actionIcon(supported, 32),
      },
    }),
    chrome.action.setTitle({
      tabId,
      title: supported
        ? "Open Interview Arc Companion"
        : "Interview Arc Companion is unavailable on this page",
    }),
  ]);
}

chrome.tabs.onUpdated.addListener((tabId, _changeInfo, tab) => updatePanel(tabId, tab.url));
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId);
  await updatePanel(tabId, tab.url);
});

initializeTabs().catch(() => {});
