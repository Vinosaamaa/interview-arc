# Interview Arc Chrome Companion

The companion keeps Interview Arc beside the real LeetCode editor. It does not scrape problem statements, inspect submissions, execute code, or submit on the user's behalf.

## Install locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this `extension/` folder.
4. Pin **Interview Arc Companion** from Chrome's Extensions menu, then click its toolbar icon from Interview Arc or a public LeetCode problem. Chrome opens the companion in the browser side panel.
5. In the Interview Arc website, choose **Connect**, create a personal token, and paste it into the side panel.

The token is kept in Chrome extension storage. The server stores only its
SHA-256 digest. A temporary network or server failure keeps the last known-good
token and offers Retry; the reconnect form appears only when no token exists or
the server rejects it. A replacement token is validated before it overwrites
the stored credential. Companion API requests are brokered by the extension
service worker so the side panel does not depend on a fragile page-level
cross-origin request. Transport failures are classified separately from HTTP
and credential failures. Disconnect the companion or revoke a token if the
credential is ever shared.

On a LeetCode page, the panel follows that page's canonical problem. On the
Interview Arc dashboard, it follows the currently running or paused coding
activity and refreshes automatically when focus changes. Refreshes are
single-flight so a slow response cannot create a polling backlog or overwrite a
newer problem. Timer and result actions update immediately in the panel, then
reconcile against the authenticated server response without issuing a second
state request. The panel can add the current public LeetCode URL to Today, run
and finish its D1-backed stopwatch, cycle the user-owned result, and save
personal notes. Finishing the stopwatch makes the attempt **Ready for journal**
automatically; the result remains separate attempt metadata.

The toolbar icon is colored on supported Interview Arc and public LeetCode
problem pages. It becomes gray on other pages, where the side panel is
intentionally unavailable.
