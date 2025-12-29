console.log("Popup script loaded");

document.addEventListener("DOMContentLoaded", async function () {
  // [variable] <- Stores the first element that returns
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  // This is the clean name without the unnecessary parts
  const hostname = new URL(tab.url).hostname;
  document.getElementById("cSite").textContent = hostname.toUpperCase();

  const syncStorage = await chrome.storage.sync.get([
    "ignoredSites",
    "ignoreInIncognito",
  ]);

  if (
    syncStorage.ignoredSites.includes(hostname) === true ||
    (tab.incognito && syncStorage.ignoreInIncognito === true)
  ) {
    document.getElementById("status").textContent =
      "Tracking blocked on this site.";
    document.getElementById("status").style.display = "block";
  }
});
