# 第一站 LINE 拖鞋下單系統

## 訪客結帳（2026-09-16）

- 前台商品與購物車不再要求買家帳號或 LINE 登入；顧客選品後，只需在結帳頁填姓名、手機及取貨資料即可建立訂單。
- 結帳 API 仍會驗證收件資料、取貨方式、7-11 門市／宅配地址、商品、數量與即時庫存；既有登入 Session 只保留相容關聯，不會覆蓋本次表單資料。
- 訂單查詢與取消申請改用「完整訂單編號＋結帳手機」精確核對，不會只憑手機列出全部訂單。
- 第一站回歸：`node --test tests/guest-checkout.test.js tests/myship-login-window.test.js tests/myship-phone.test.js`。訪客測試使用隔離臨時資料與 headless Chromium，不寫正式訂單、不啟動賣貨便 worker。

## 賣貨便端到端修正（2026-09-15）

- 本機 worker 會把台灣手機的 `+886` 格式正規化為 `09` 開頭，再填入賣貨便收件欄位。
- 7-ELEVEN 電子地圖只接受店號完全相符且可用的官方 `GoMap` 結果；停用門市不會被誤點。若訂單使用官方推薦的鄰近門市，worker 會用本機 `data/local-myship-store-alias.json` 重新查詢來源門市、驗證推薦仍有效，再走官方推薦流程。該檔不進 Git 或交接包。
- 第一站回歸：`node --test tests/guest-checkout.test.js tests/myship-login-window.test.js tests/myship-phone.test.js`。2026-09-15 已用一筆受控訂單完成正式 MyShip 建單與雲端 result 讀回；實際建單仍必須由使用者明確授權 `-AllowOrderCreation`。

## 登入入口修正（2026-09-12）

- 後台登入按鈕只在使用者目前的 Chrome 開啟官方 `myship/list1` 頁面，保留彈出視窗被阻擋與導航失敗的明確狀態；不呼叫建單 API、不啟動本機 worker，也不複製登入資料。
- HAXX 正式 `app/line_shop_admin.py` 的 `POST admin/myship/open-login-window` 只回傳官方登入網址與 `localWorkerStarted=false`；不得把登入請求轉成 `start_line_myship_worker`，也不得轉送到 Render 的伺服器端瀏覽器啟動器。
- 第一站回歸：`node --test tests/guest-checkout.test.js tests/myship-login-window.test.js tests/myship-phone.test.js`；HAXX 回歸：`.venv/Scripts/python.exe -B -m unittest discover -s tests -p test_line_myship_login_safety.py`。前者已整合到正式 `scripts/verify.ps1`。
- 目前 Chrome 分頁已登入不等於背景 worker 可使用。原 worker 仍只支援經授權的專用 CDP 或 Profile；瀏覽器擴充工具分頁沒有已驗證的背景 worker 連接器。沒有正式連接與有效 GM 賣場網址時不得標記自動建單就緒。
- 上述修改必須另行部署並讀回 Render 靜態檔及 HAXX 已載入版本，才能稱為正式網站入口修復；本機來源／離線回歸通過不代表已部署或完成真實下單驗收。

## 1. 程式身分

| 項目 | 正式值 |
|---|---|
| 程式 ID | `line-slipper-first-station` |
| 範圍 | 第一站 LINE 拖鞋下單系統 + HAXX 後台入口 + 本機賣貨便同步器 |
| HAXX tool ID | `rt_line_myship_sync` |
| 正式網站 | `https://line-slipper-shop.onrender.com/` |
| 正式後台 | `https://line-slipper-shop.onrender.com/admin.html` |
| HAXX 後台代理 | `https://haxx.tail779f0b.ts.net/apps/line-slipper-admin/admin-orders.html` |
| HAXX 工具入口 | `https://haxx.tail779f0b.ts.net/tools/rt_line_myship_sync/open` |
| 維修入口 | `/tools/rt_line_myship_sync/current-thread-maintenance` |
| 明確排除 | 第二站 `line-slipper-shop-2` 的全部程式、資料與登入狀態 |

本交接包保存可重建功能的程式碼、設定範本、HAXX 整合參考、固定操作入口、逐檔雜湊及驗證方式。它不保存任何密碼、客戶資料或登入 Session。另一台電腦可重建相同功能，但仍必須由使用者完成該機的官方登入、MFA、Tailscale／HAXX 環境與雲端環境變數設定。

## 2. 功能總表

| 元件 | 功能 |
|---|---|
| 前台賣場 | 商品分類、子分類、商品、款式、圖片、售價、庫存、賣場版面區塊、購物車與庫存上限檢查。 |
| 訪客購買 | 不需註冊、買家 Session 或 LINE 登入；選品後直接填結帳與取貨資料。 |
| 買家帳號 | 舊帳號與 API 保留相容，但不再是加入購物車或結帳的前置條件。 |
| 結帳 | 宅配、自行取貨、7-11 賣貨便門市資訊、運費、地址與收件資料驗證、建立訂單並扣庫存。 |
| 訂單查詢 | 以完整訂單編號與結帳手機精確核對，顯示該筆訂單並可提出取消申請。 |
| 聊聊 | 既有登入買家可發訊息、賣家回覆、後台未讀狀態與 Server-Sent Events 即時更新。 |
| 後台訂單 | 訂單列表、狀態更新、取消申請核准／拒絕、統計資料。 |
| 後台商品 | 賣場、分類、子分類、商品、款式、條碼、售價、庫存、上架狀態與排序。 |
| Excel | 商品大量上架範本、批量庫存匯入、MallBic 訂單匯出格式。 |
| MallBic | 庫存同步、訂單同步、取消狀態同步、各同步狀態讀回；預設訂單自動同步關閉。 |
| 賣貨便 API | 建立待處理工作、讀待處理訂單、claim、回寫成功／失敗結果、錯誤截圖讀取。 |
| 本機賣貨便 worker | 登入第一站後台、取得 pending 訂單、使用獨立 Profile 或指定 CDP Chrome 建立賣貨便訂單，再回寫結果。 |
| LINE | LIFF 設定輸出、Messaging API webhook 驗證骨架與訊息處理。 |
| HAXX | 使用 HAXX 使用者登入及 tool 權限代理第一站後台，不把第一站後台密碼送到瀏覽器；提供同步狀態、啟動 worker、單次執行入口。 |
| 維修綁定 | HAXX 維修頁可綁定 Codex task；此為每個 task 的平台／HAXX 狀態，不可用複製 Session 的方式跨機移植。 |

## 3. 系統結構

```text
買家 / 管理員
      |
      v
Render Node/Express 第一站
  |- public/*                 前台與後台頁面
  |- server.js               API、驗證、訂單、聊聊、MallBic、MyShip
  |- data/catalog.json       可交接商品種子資料
  |- data/store-layout.json  可交接版面資料
  `- Render DATA_DIR         正式訂單、買家、聊天與同步狀態（不進交接包）

HAXX FastAPI
  |- line_shop_admin.py      HAXX 登入後代理 Render 後台與 API
  |- line_myship_sync.py     讀取／啟動本機 worker 狀態
  |- line_myship_sync.html   HAXX 同步管理頁
  `- tool rt_line_myship_sync

本機 MyShip worker
  |- scripts/myship-sync.js
  |- scripts/myship-phone.js
  |- 第一站 pending/claim/result API
  `- 使用該機專屬 Chrome Profile 或明確配置的 CDP Chrome
```

## 4. 主要檔案

| 路徑 | 用途 | 是否進交接包 |
|---|---|---|
| `server.js` | 第一站 Node/Express 主程式 | 是，保存目前工作樹版本 |
| `scripts/myship-sync.js` | 本機賣貨便 worker | 是，保存目前工作樹版本 |
| `scripts/myship-phone.js` | 台灣手機格式正規化 | 是 |
| `public/` | 前台、購物車、訪客查單、聊聊及後台頁面 | 是 |
| `data/catalog.json` | 商品、分類、款式與庫存種子資料 | 是 |
| `data/store-layout.json` | 首頁版面設定 | 是 |
| `data/mallbic-order-template.xls` | MallBic 訂單格式範本 | 是 |
| `.env.example` | 無秘密的環境變數範本 | 是 |
| `.env` | 本機與服務秘密 | 否，永久禁止 |
| `data/orders.json`、`buyers.json`、`chats.json` | 客戶與交易資料 | 否 |
| `data/*sync*.json` | 執行狀態與防重資料 | 否 |
| `data/local-myship-store-alias.json` | 本機官方推薦門市對照；每次使用時仍需向官方地圖重驗 | 否 |
| `data/*chrome-profile*/` | 登入 Profile、Cookie、Session | 否 |
| `logs/`、`node_modules/`、`.git/` | 執行產物、依賴、版本庫內部資料 | 否 |

## 5. 環境需求

| 類別 | 需求 |
|---|---|
| 作業系統 | Windows 10/11；本交接版本在 Windows、PowerShell 7.6.4 驗證。 |
| Node.js | 最低 20；來源機驗證版本 `v24.15.0`。 |
| npm | 使用 `npm.cmd`，避免 PowerShell execution policy 阻擋 `npm.ps1`。 |
| Python | HAXX 元件需要 HAXX 現有 Python／FastAPI 環境；主網站本身不需要 Python。 |
| 瀏覽器 | Playwright Chromium；若用本機 Chrome Profile，必須由該機使用者登入；若用 CDP，必須是本程式明確獲准的專屬埠與瀏覽器。 |
| 網路 | Render、LINE、MallBic、7-11 賣貨便、HAXX／Tailscale 對應服務可達。 |

## 6. 設定分類

### 必填秘密，僅放在目標環境

`ADMIN_PASSWORD`、`SESSION_SECRET`、`LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`、`MALLBIC_ACCOUNT`、`MALLBIC_PASSWORD`、`ECPAY_MERCHANT_ID`、`ECPAY_HASH_KEY`、`ECPAY_HASH_IV`、`MYSHIP_FACEBOOK_EMAIL`、`MYSHIP_FACEBOOK_PASSWORD`。

### 主要非秘密設定

`PORT`、`DATA_DIR`、`ADMIN_ACCOUNT`、`LIFF_ID`、`SHOP_BASE_URL`、`PUBLIC_BASE_URL`、`MALLBIC_COMPANY_NAME`、`MALLBIC_LOGIN_URL`、`MYSHIP_PRODUCT_URL`、`MYSHIP_AMOUNT_SOURCE`、各 timeout／interval 與各 auto-sync enabled flag。

### 本機 MyShip 瀏覽器二選一

| 模式 | 設定 | 規則 |
|---|---|---|
| 獨立 Profile | `MYSHIP_CHROME_PROFILE_DIR` | 每台電腦自己建立與登入，不可進交接包。 |
| CDP | `MYSHIP_CDP_URL` 或 `REMOTE_BROWSER_CDP_MYSHIP`、`MYSHIP_CDP_TIMEOUT_MS` | 只能連本程式獲准的瀏覽器；worker 結束時只斷開 Playwright，不關閉共享 Chrome。 |

## 7. 目標電腦安裝

1. 從正式 Drive 索引取得唯一 `verified` 交接 ZIP，核對 Drive file ID、版本、大小與 SHA-256。
2. 解壓到目標電腦自己的正式程式目錄；不得覆蓋另一個程式或第二站。
3. 執行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
```

4. 由使用者把 `.env.example` 複製為 `.env` 並填入該機／該環境的正式值。不得從來源電腦複製 `.env`。
5. 先執行無副作用驗證：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1 -PackageMode
```

6. 啟動本機網站測試：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run.ps1 -Mode Server
```

7. 使用者自行完成 LINE、MallBic、賣貨便／Facebook、Render 與 HAXX 所需官方登入或 MFA。
8. 只讀檢查 MyShip worker 與第一站 API：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run.ps1 -Mode MyShipCheck
```

9. 將 `haxx_reference_only/` 中的第一站模組、模板及整合片段套用到目標 HAXX 正式根目錄，設定 `LINE_MYSHIP_REPO_ROOT`，再執行 HAXX 既有測試與服務驗證。
10. 只有在使用者明確要求建立外部賣貨便訂單後，才可執行 `MyShipOnce` 或 `MyShipWorker`，且必須加 `-AllowOrderCreation`。

## 8. 固定操作入口

| 動作 | 命令 | 外部副作用 |
|---|---|---|
| 安裝依賴 | `scripts/setup.ps1` | 下載 npm／Playwright 免費依賴；不登入、不下單。 |
| 啟動網站 | `scripts/run.ps1 -Mode Server` | 啟動本機服務；不主動建立外部訂單。 |
| MyShip 唯讀檢查 | `scripts/run.ps1 -Mode MyShipCheck` | 登入第一站管理 API並讀 pending；不開賣貨便下單。 |
| 單次賣貨便處理 | `scripts/run.ps1 -Mode MyShipOnce -AllowOrderCreation` | 可能建立外部賣貨便訂單。 |
| 持續賣貨便 worker | `scripts/run.ps1 -Mode MyShipWorker -AllowOrderCreation` | 持續輪詢並可能建立外部訂單。 |
| 驗證 | `scripts/verify.ps1` | 預設離線、無副作用；線上與 worker 檢查須顯式開關。 |
| 清理 | `scripts/cleanup.ps1` | 只停止由 `run.ps1 -Background` 登記的本程式 PID 樹；不刪登入 Profile 或業務資料。 |

## 9. HAXX 接法

交接包的 `haxx_reference_only/` 包含：

- `app/line_shop_admin.py`
- `app/line_myship_sync.py`
- `app/templates/line_myship_sync.html`
- 對應測試
- `tool/open_line_myship_sync.py` 與 `tool/tool.json`
- 從現行 `app/main.py` 擷取的 imports、常數、warm-up 與 routes 整合片段

HAXX 是共用系統，不可用此包覆蓋整份目標 `main.py`。目標端必須依整合片段套用到該機現行 HAXX，保留其他工具與認證邏輯，再跑測試。HAXX 代理會使用 HAXX 登入與 `rt_line_myship_sync` 權限檢查，再由伺服器端登入 Render 第一站；瀏覽器不取得第一站管理密碼。

## 10. 成功標準

| 層級 | 必須證據 |
|---|---|
| 套件完整 | ZIP SHA-256、Drive metadata、逐檔 `FILES.sha256`、解壓後 `verify.ps1 -PackageMode` 全部 PASS。 |
| 程式可啟動 | Node 語法、JSON、npm 依賴、首頁與管理 API 的本機測試通過。 |
| HAXX 可用 | 目標 HAXX 測試通過；登入後代理頁可開；tool permission 正確；未登入會導回登入。 |
| MyShip 唯讀可用 | `MyShipCheck` 可登入第一站並讀出 pending 數量。這不是下單驗收。 |
| MyShip 端到端可用 | 經使用者明確授權，以一筆受控真實訂單完成 claim、賣貨便建立與 result 正式讀回，且沒有重複訂單。 |
| 跨機完成 | 目標電腦自行讀到 Drive／共用記憶、核對雜湊、完成登入與上述現場測試；來源機發布成功不能代替此證據。 |

## 11. 失敗與續跑

- HTTP 200、程序存在、HAXX 頁面開啟或 worker `RUNNING` 都不是業務完成。
- MyShip 發生逾時、UNKNOWN 或回寫缺失時，先查 pending、claim/result 與賣貨便實際結果；不得直接再跑一次。
- MallBic／LINE／訂單狀態等外部寫入同樣要先讀正式狀態，避免重複副作用。
- 需要登入、MFA、額外權限或破壞性變更時停止，由使用者處理。
- 清理只處理本次建立且可驗證歸屬的程序、PID ledger 與暫存；無法確認歸屬時不強制終止。

## 12. 本版來源證據

- 主程式基準 Git commit：`781fa3923c8db270907c56a5c0aea9bff4b3ac5d`。
- 交接版本採用工作樹快照，包含當時尚未提交的 `server.js` 與 `scripts/myship-sync.js` CDP 共用瀏覽器相容修正。
- 來源 HAXX 開發目錄與目前執行中的 `D:\HAXX\remote-tools-web` 六個第一站相關檔案 SHA-256 已逐一比對一致。
- 每次正式建包仍會重新產生 `SOURCE-STATE.json`、`RELEASE-MANIFEST.json` 與 `FILES.sha256`，以上文字不得取代當次讀回證據。
