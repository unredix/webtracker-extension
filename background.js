const ignoredSites = null;

async function initializeExtension() {
  try {
    ignoredSites = await chrome.storage.sync.get("ignoredSites");
  } catch (error) {}
}

chrome.runtime.onStartup.addListener(() => {
  console.log("Extension has started up");

  initializeExtension();
});
