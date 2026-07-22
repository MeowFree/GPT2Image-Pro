const statusText = document.getElementById("statusText");
const contextText = document.getElementById("contextText");
const scopeSelect = document.getElementById("scopeSelect");
const exportJsonBtn = document.getElementById("exportJsonBtn");

function setStatus(message) {
  statusText.textContent = message;
}

function toTimestampParts(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function mapSameSite(value) {
  if (value === "no_restriction") return "None";
  if (value === "lax") return "Lax";
  if (value === "strict") return "Strict";
  return "Lax";
}

function getCurrentTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tabs?.[0] ? tabs[0] : null);
    });
  });
}

function getAllCookieStores() {
  return new Promise((resolve, reject) => {
    chrome.cookies.getAllCookieStores((stores) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(Array.isArray(stores) ? stores : []);
    });
  });
}

async function getCurrentContext() {
  const tab = await getCurrentTab();
  if (!tab || typeof tab.id !== "number") {
    throw new Error("Unable to find the active tab for cookie export.");
  }

  const stores = await getAllCookieStores();
  const matchedStore = stores.find(
    (store) => Array.isArray(store.tabIds) && store.tabIds.includes(tab.id)
  );
  if (!matchedStore?.id) {
    throw new Error("Unable to resolve the cookie store for the active tab.");
  }

  return {
    tab,
    storeId: matchedStore.id,
    incognito: Boolean(tab.incognito || chrome.extension.inIncognitoContext),
  };
}

function getCookies(filter, storeId) {
  return new Promise((resolve, reject) => {
    const nextFilter = { ...(filter || {}) };
    if (storeId) {
      nextFilter.storeId = storeId;
    }
    chrome.cookies.getAll(nextFilter, (cookies) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(Array.isArray(cookies) ? cookies : []);
    });
  });
}

function getFireflyArpSessionId(tabId) {
  return new Promise((resolve) => {
    if (typeof tabId !== "number" || !chrome.scripting) {
      resolve("");
      return;
    }

    chrome.scripting.executeScript(
      {
        target: { tabId },
        func: () => {
          const readCookie = (name) => {
            const prefix = `${name}=`;
            const item = document.cookie
              .split(";")
              .map((value) => value.trim())
              .find((value) => value.startsWith(prefix));
            return item ? item.slice(prefix.length) : "";
          };

          const sid = String(
            sessionStorage.getItem("ff_session_guid") || ""
          ).trim();
          const ftr = String(
            localStorage.getItem("forterToken") ||
              readCookie("forterToken") ||
              readCookie("forter") ||
              ""
          ).trim();
          return sid && ftr ? btoa(JSON.stringify({ sid, ftr })) : "";
        },
      },
      (results) => {
        if (chrome.runtime.lastError) {
          resolve("");
          return;
        }
        const value =
          Array.isArray(results) && results[0] ? results[0].result : "";
        resolve(typeof value === "string" ? value : "");
      }
    );
  });
}

async function collectCookiesByScope(scope) {
  const context = await getCurrentContext();
  const { tab, storeId, incognito } = context;

  if (scope === "current") {
    const url = tab?.url ? tab.url : "";
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      throw new Error("The current tab is not a regular web page.");
    }
    const cookies = await getCookies({ url }, storeId);
    return { cookies, sourceUrl: url, storeId, incognito };
  }

  const domains = [".adobe.com", "firefly.adobe.com", "account.adobe.com"];
  const all = [];
  for (const domain of domains) {
    const cookies = await getCookies({ domain }, storeId);
    all.push(...cookies);
  }

  const unique = [];
  const seen = new Set();
  for (const item of all) {
    const key = `${item.domain}|${item.path}|${item.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }

  return {
    cookies: unique,
    sourceUrl: "https://firefly.adobe.com/",
    storeId,
    incognito,
  };
}

function toPlaywrightLikeCookies(cookies) {
  return cookies.map((item) => ({
    name: item.name,
    value: item.value,
    domain: item.domain,
    path: item.path || "/",
    expires: typeof item.expirationDate === "number" ? item.expirationDate : -1,
    httpOnly: Boolean(item.httpOnly),
    secure: Boolean(item.secure),
    sameSite: mapSameSite(item.sameSite),
  }));
}

function buildCookieHeader(cookies) {
  const parts = [];
  for (const item of cookies) {
    const name = String(item.name || "").trim();
    if (!name) continue;
    parts.push(`${name}=${String(item.value || "")}`);
  }
  return parts.join("; ");
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({
    url,
    filename,
    saveAs: true,
  });
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

async function generatePayload() {
  const scope = scopeSelect.value;
  const { tab } = await getCurrentContext();
  const { cookies, incognito, storeId } = await collectCookiesByScope(scope);
  const normalizedCookies = toPlaywrightLikeCookies(cookies);
  const cookieHeader = buildCookieHeader(normalizedCookies);
  const arpSessionId =
    tab && String(tab.url || "").startsWith("https://firefly.adobe.com/")
      ? await getFireflyArpSessionId(tab.id)
      : "";
  const now = new Date();
  const fileTs = toTimestampParts(now);

  const payload = { cookie: cookieHeader };
  if (arpSessionId) {
    payload.headers = { "x-arp-session-id": arpSessionId };
  }
  const fileName = `cookie_${fileTs}.json`;
  return {
    payload,
    fileName,
    cookieCount: normalizedCookies.length,
    incognito,
    storeId,
  };
}

function renderContext(context) {
  const modeText = context.incognito ? "Incognito" : "Regular";
  contextText.textContent = `Browser context: ${modeText} window | store: ${context.storeId}`;
  if (context.incognito) {
    setStatus(
      "Incognito cookie store detected. Export will use the isolated incognito cookie jar."
    );
  } else {
    setStatus("Regular browser context detected.");
  }
}

async function initContext() {
  try {
    const context = await getCurrentContext();
    renderContext(context);
  } catch (error) {
    contextText.textContent = "Browser context: unavailable";
    setStatus(`Unable to detect the cookie store: ${error.message || error}`);
    exportJsonBtn.disabled = true;
  }
}

exportJsonBtn.addEventListener("click", async () => {
  try {
    setStatus("Reading cookies...");
    const { payload, fileName, cookieCount, incognito } =
      await generatePayload();
    if (!cookieCount) {
      setStatus("No cookies were found. Log in to Adobe or Firefly first.");
      return;
    }
    downloadJson(fileName, payload);
    const modeText = incognito ? "incognito" : "regular";
    setStatus(
      `Exported ${cookieCount} cookies from the ${modeText} browser store.`
    );
  } catch (error) {
    setStatus(`Export failed: ${error.message || error}`);
  }
});

initContext();
