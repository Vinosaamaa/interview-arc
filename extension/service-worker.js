const LEETCODE_ORIGIN = "https://leetcode.com";
const INTERVIEW_ARC_ORIGIN = "https://limitless.vinosama.workers.dev";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

async function updatePanel(tabId, rawUrl) {
  if (!rawUrl) return;
  try {
    const url = new URL(rawUrl);
    const supported = (
      url.origin === LEETCODE_ORIGIN && url.pathname.startsWith("/problems/")
    ) || url.origin === INTERVIEW_ARC_ORIGIN;
    await chrome.sidePanel.setOptions({
      tabId,
      path: "sidepanel.html",
      enabled: supported,
    });
  } catch {
    await chrome.sidePanel.setOptions({ tabId, enabled: false });
  }
}

chrome.tabs.onUpdated.addListener((tabId, _changeInfo, tab) => updatePanel(tabId, tab.url));
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId);
  await updatePanel(tabId, tab.url);
});
