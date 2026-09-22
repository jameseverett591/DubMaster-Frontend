// Toolbar button: import whatever YouTube video is on the active tab.
// Works from any YouTube page — watch pages, Shorts, playlists — because
// it reads the tab URL rather than relying on the content-script button.

const DUBMASTER_URL = "http://localhost:3000";

chrome.action.onClicked.addListener((tab) => {
  if (!tab.url || !/youtube\.com/.test(tab.url)) {
    return;
  }
  const target =
    `${DUBMASTER_URL}/dashboard?tab=youtube&yt_url=` +
    encodeURIComponent(tab.url);
  chrome.tabs.create({ url: target });
});
