// Toolbar button: import whatever YouTube video is on the active tab.
// On watch/Shorts pages it deep-links the video into DubMaster's import;
// on feed/channel pages it just opens the YouTube tab (no video to grab).

const DUBMASTER_URL = "http://localhost:3001";

chrome.action.onClicked.addListener((tab) => {
  if (!tab.url || !/youtube\.com/.test(tab.url)) {
    return;
  }
  const isVideo = /[?&]v=|\/shorts\//.test(tab.url);
  const target = isVideo
    ? `${DUBMASTER_URL}/dashboard?tab=youtube&yt_url=` +
      encodeURIComponent(tab.url)
    : `${DUBMASTER_URL}/dashboard?tab=youtube`;
  chrome.tabs.create({ url: target });
});
