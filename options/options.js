document.addEventListener("DOMContentLoaded", function () {
  const ignoreListInput = document.getElementById("ignore-url");
  const ignoreList = document.getElementById("ignored-sites-list");
  const saveButton = document.getElementById("save-changes");
  const cancelButton = document.getElementById("cancel-changes");
  const ignoreIncognitoCheckbox = document.getElementById("ignore-incog");
  const languageSelect = document.getElementById("lang");

  function getStoredOptions() {
    chrome.storage.sync.get(
      ["ignoredSites", "ignoreInIncognito", "language"],
      function (data) {
        const ignoredSites = data.ignoredSites || [];
        ignoredSites.forEach(function (site) {
          const listItem = document.createElement("li");
          const itemDeleteButton = document.createElement("button");

          itemDeleteButton.textContent = "✖";
          itemDeleteButton.style.cursor = "pointer";
          itemDeleteButton.style.border = "none";
          itemDeleteButton.style.borderRadius = "3px";
          itemDeleteButton.style.backgroundColor = "rgb(133, 133, 255)";
          itemDeleteButton.style.marginRight = "10px";
          itemDeleteButton.addEventListener("click", function () {
            ignoreList.removeChild(listItem);
            showButtons();
          });

          listItem.appendChild(itemDeleteButton);
          const siteText = document.createTextNode(site);
          listItem.appendChild(siteText);

          ignoreList.appendChild(listItem);
        });

        ignoreIncognitoCheckbox.checked = data.ignoreInIncognito || false;

        if (data.language) {
          languageSelect.value = data.language;
        }
      }
    );
  }

  function showButtons() {
    saveButton.style.display = "block";
    cancelButton.style.display = "block";
  }

  function hideButtons() {
    saveButton.style.display = "none";
    cancelButton.style.display = "none";
  }

  getStoredOptions();

  document.getElementById("lang").addEventListener("change", function () {
    showButtons();
  });

  document
    .getElementById("ignore-incog")
    .addEventListener("change", function () {
      showButtons();
    });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      const site = ignoreListInput.value.trim().toLowerCase();
      if (site) {
        const listItem = document.createElement("li");
        listItem.textContent = site;
        ignoreList.appendChild(listItem);
        ignoreListInput.value = "";
        showButtons();
      }
    }
  });

  cancelButton.addEventListener("click", function () {
    ignoreList.innerHTML = "";

    getStoredOptions();
    hideButtons();
  });

  saveButton.addEventListener("click", function () {
    const ignoredSites = [];
    Array.from(ignoreList.children).forEach(function (item) {
      if (item.textContent && !ignoredSites.includes(item.textContent)) {
        ignoredSites.push(
          item.textContent[0] === "✖"
            ? item.textContent.slice(1).trim()
            : item.textContent.trim()
        );
      }
    });

    const ignoreInIncognito = ignoreIncognitoCheckbox.checked;
    const language = languageSelect.value;

    chrome.storage.sync.set({
      ignoredSites: ignoredSites,
      ignoreInIncognito: ignoreInIncognito,
      language: language,
    });

    ignoreList.innerHTML = "";
    getStoredOptions();

    hideButtons();
  });
});
