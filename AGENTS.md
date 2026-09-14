<!-- CODEX-PROGRAM-HANDOFF:BEGIN version=1 program_id=line-slipper-first-station -->
# 第一站 LINE 拖鞋下單系統交接規則

## 唯一範圍

- 本程式只包含「第一站 LINE 拖鞋下單系統 + HAXX 後台入口 + 本機賣貨便同步器」。
- 正式程式 ID：`line-slipper-first-station`；HAXX tool ID：`rt_line_myship_sync`。
- 禁止讀取、修改、啟動、同步或封裝第二站 `line-slipper-shop-2` 及其資料、登入狀態、排程或工具。
- 路徑是裝置專屬設定。不得把來源電腦路徑當成目標電腦固定路徑；以 `program-manifest.json`、`LINE_MYSHIP_REPO_ROOT` 與現場設定解析。

## 正式入口

- 安裝：`powershell -ExecutionPolicy Bypass -File scripts/setup.ps1`
- 執行：`powershell -ExecutionPolicy Bypass -File scripts/run.ps1 -Mode Server`
- 驗證：`powershell -ExecutionPolicy Bypass -File scripts/verify.ps1`
- 清理：`powershell -ExecutionPolicy Bypass -File scripts/cleanup.ps1`
- 交接包：`powershell -ExecutionPolicy Bypass -File scripts/build-handoff.ps1 -HaxxRoot <HAXX根目錄> -HaxxToolRoot <第一站工具目錄>`

## 安全與副作用

- 不得封裝或同步 `.env`、密碼、Token、Cookie、Session、MFA、私鑰、瀏覽器 Profile、Credential Manager／DPAPI 資料。
- 不得封裝 `orders.json`、`buyers.json`、`chats.json`、同步狀態、截圖、日誌、執行根目錄或客戶資料。
- 賣貨便 `MyShipOnce` 與 `MyShipWorker` 會建立外部訂單，只有使用者明確要求時，才可加 `-AllowOrderCreation` 執行。
- `MyShipCheck` 只登入第一站後台並讀取待處理數量；不得把讀取成功誤稱為賣貨便實際下單成功。
- 已完成的下單、LINE 傳訊、MallBic 上傳或其他外部副作用，不得因失敗或逾時而盲目重做；先讀取正式訂單、claim/result 與同步狀態。
- 登入與 MFA 由使用者在每台電腦自行完成；不得跨機複製登入 Profile 或憑證。

## 來源與驗證

- 主程式以本目錄工作樹為來源；交接包必須保存基準 Git commit、dirty paths、逐檔 SHA-256 與排除清單。
- HAXX 只封裝第一站必要模組、模板、測試、tool 定義與 `main.py` 整合片段；不得封裝整個 HAXX 執行資料或其他工具。
- 修正功能後，至少執行 Node 語法檢查、JSON 解析、HAXX Python AST 解析、正式 `verify.ps1`，並讀回輸出。
- 只有程式、必要檔案、雜湊與驗證全數相符，才可稱為可交接；雲端上傳成功仍不等於目標電腦已完成登入與端到端驗收。
<!-- CODEX-PROGRAM-HANDOFF:END -->
