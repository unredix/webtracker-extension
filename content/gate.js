(async () => {
  const style = document.createElement("style");
  style.textContent = "html { visibility: hidden !important; }";
  const styleTarget = document.head || document.documentElement;
  styleTarget.appendChild(style);

  const reveal = () => style.remove();

  try {
    const hostname = location.hostname;
    const response = await chrome.runtime.sendMessage({ type: "checkBlocked", hostname });
    if (response && response.blocked) {
      const url =
        chrome.runtime.getURL("blocked/blocked.html") +
        `?site=${encodeURIComponent(hostname)}` +
        `&reason=${encodeURIComponent(response.reason)}` +
        `&from=${encodeURIComponent(location.href)}`;
      location.replace(url);
      return;
    }
  } catch {
    // Service worker unreachable; fail open rather than trap the user.
  }

  reveal();
})();
