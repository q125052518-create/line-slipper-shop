import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../public/admin-tools.js", import.meta.url), "utf8");
const loginUrl = "https://myship.7-11.com.tw/myship/list1";

async function boot({ confirmed = true, popupBlocked = false, navigationFails = false } = {}) {
  const elements = new Map();
  const requests = [];
  const opens = [];
  const navigations = [];
  const child = {
    opener: "parent",
    location: {
      replace(url) {
        assert.equal(child.opener, null);
        if (navigationFails) throw new Error("navigation denied");
        navigations.push(url);
      }
    }
  };
  const context = vm.createContext({
    document: {
      querySelector(selector) {
        if (!elements.has(selector)) {
          elements.set(selector, {
            textContent: "",
            disabled: false,
            listeners: {},
            addEventListener(type, listener) { this.listeners[type] = listener; }
          });
        }
        return elements.get(selector);
      }
    },
    confirm: () => confirmed,
    fetch: async (url, options = {}) => {
      requests.push({ url, method: options.method || "GET" });
      return { ok: true, json: async () => ({}) };
    },
    setInterval: () => 0,
    window: {
      open(url, target) {
        opens.push({ url, target });
        return popupBlocked ? null : child;
      }
    }
  });
  vm.runInContext(source, context, { filename: "admin-tools.js" });
  await new Promise(setImmediate);
  const baselineRequests = requests.length;
  return {
    opens,
    navigations,
    requests,
    baselineRequests,
    click: () => elements.get("#myshipLoginWindowButton").listeners.click(),
    message: () => elements.get("#myshipOrderSyncMessage").textContent,
    orderClick: () => elements.get("#myshipOrderSyncButton").listeners.click()
  };
}

test("login opens the current browser without a worker or order API request", async () => {
  const ui = await boot();
  ui.click();
  assert.deepEqual(ui.opens, [{ url: "about:blank", target: "_blank" }]);
  assert.deepEqual(ui.navigations, [loginUrl]);
  assert.equal(ui.requests.length, ui.baselineRequests);
  assert.match(ui.message(), /連接尚未驗證/);
});

test("cancelled login does not open or send anything", async () => {
  const ui = await boot({ confirmed: false });
  ui.click();
  assert.equal(ui.opens.length, 0);
  assert.equal(ui.requests.length, ui.baselineRequests);
});

test("blocked popup does not report success or fall back to a server launcher", async () => {
  const ui = await boot({ popupBlocked: true });
  ui.click();
  assert.equal(ui.navigations.length, 0);
  assert.match(ui.message(), /未開啟/);
  assert.equal(ui.requests.length, ui.baselineRequests);
});

test("navigation failure does not start a worker as a fallback", async () => {
  const ui = await boot({ navigationFails: true });
  ui.click();
  assert.match(ui.message(), /開啟失敗/);
  assert.equal(ui.requests.length, ui.baselineRequests);
});

test("the explicit create-orders command retains its original endpoint", async () => {
  const ui = await boot();
  await ui.orderClick();
  assert.ok(ui.requests.some(request => request.url === "/api/admin/myship/create-orders" && request.method === "POST"));
});
