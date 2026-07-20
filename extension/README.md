# Interview Arc Chrome Companion

The companion keeps Interview Arc beside the real LeetCode editor. It does not scrape problem statements, inspect submissions, execute code, or submit on the user's behalf.

## Install locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this `extension/` folder.
4. Pin **Interview Arc Companion** from Chrome's Extensions menu, open a LeetCode problem, and click its toolbar icon. Chrome opens the companion in the browser side panel.
5. In the Interview Arc website, choose **Connect**, create a personal token, and paste it into the side panel.

The token is kept in Chrome extension storage. The server stores only its SHA-256 digest. Disconnect the companion or create a replacement token if the credential is ever shared.

The panel can add the current public LeetCode URL to Today, run and finish its D1-backed stopwatch, cycle the user-owned result, and save personal notes. Finishing the stopwatch or choosing a result makes the attempt **Ready for journal** automatically.
