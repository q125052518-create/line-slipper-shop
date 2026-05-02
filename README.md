# LINE LIFF 拖鞋下單系統範例

這是一個最小可行版本，包含：

- LIFF 下單頁
- 多個拖鞋賣場
- 商品圖片、商品名稱、商品說明
- 多品項管理，每個品項可設定條碼與價格
- 購物車與訂單建立
- 買家聊聊系統，買家可傳訊息給賣家，後台可回覆
- 聊聊未讀數只在後台顯示，買家端不顯示已讀或未讀狀態
- 聊聊會自動更新新訊息與賣家端已讀/未讀狀態，不需要手動重新整理
- 賣場、商品、品項編輯後台
- 訂單後台
- LINE Messaging API webhook 骨架

## 執行

```bash
npm install
npm run dev
```

Windows PowerShell 如果擋住 `npm.ps1`，可以改用：

```bash
npm.cmd install
npm.cmd run dev
```

開啟：

- 下單頁：http://localhost:3000/
- 後台：http://localhost:3000/admin.html

## 後台可編輯內容

後台可以直接維護：

- 賣場名稱、賣場說明、是否在前台顯示
- 商品名稱、圖片網址、商品說明
- 商品底下的多個品項
- 每個品項的名稱、條碼、價格、圖片網址
- 每個品項的庫存
- 可用 Excel 批量更新庫存，依 `品項條碼` 比對，將 `數量` 直接覆蓋成新庫存
- 每小時自動登入墨筆克，匯出商品資料 Excel，依 `品項條碼` 同步庫存，也可在後台手動立即同步
- 墨筆克匯出檔若有 `可用庫存` 和 `需求`，系統會用 `可用庫存 - 需求` 當成同步數量
- 可用 Excel 大量上架商品，後台可下載 `product-import-template.xlsx` 範本

大量上架 Excel 欄位：

```text
賣場名稱
商品名稱
商品說明
商品圖片網址
款式
品項條碼
售價
數量
品項圖片網址
是否上架
```

前台規則：

- 取貨方式只能選「宅配」或「自行取貨」
- 選「宅配」時會顯示宅配地址欄位，且必填
- 前台會顯示每個品項目前庫存
- 前台品項以圖片卡片呈現，不使用下拉式選單
- 商品頁只負責加入購物車
- 買家登入後才可以加入購物車與結帳
- 買家登入後可進入 `/chat.html` 與賣家聊聊
- 購物車資料會暫存在瀏覽器，進入 `/cart.html` 後再結帳
- 下單成功後會自動扣庫存
- 庫存不足時不能超量加入購物車

資料會存在 `data/catalog.json`，訂單會存在 `data/orders.json`，聊聊紀錄會存在 `data/chats.json`。正式上線時建議改成 PostgreSQL、MySQL 或 Supabase。

## LINE 設定

複製 `.env.example` 成 `.env`，填入：

```bash
ADMIN_ACCOUNT=後台管理員帳號
ADMIN_PASSWORD=後台管理員密碼
LINE_CHANNEL_SECRET=你的 Messaging API Channel Secret
LINE_CHANNEL_ACCESS_TOKEN=你的 Channel Access Token
LIFF_ID=你的 LIFF ID
MALLBIC_ACCOUNT=墨筆克帳號
MALLBIC_PASSWORD=墨筆克密碼
MALLBIC_COMPANY_NAME=祥瑞華有限公司
MALLBIC_AUTO_SYNC_ENABLED=true
MALLBIC_AUTO_SYNC_INTERVAL_MS=3600000
```

買家登入頁可直接輸入管理員帳號與後台密碼；系統會自動判斷身分，管理員會直接進入 `/admin.html`，一般買家則回到商品頁。

在 LINE Developers Console：

1. 建立 Messaging API channel。
2. 建立 LINE Login channel，並新增 LIFF app。
3. 將 LIFF Endpoint URL 設成你的正式網址。
4. 在 Messaging API 設定 webhook URL，例如 `https://你的網域/webhook`。
5. 開啟 Use webhook。

本機測試 webhook 可以用 ngrok 或 Cloudflare Tunnel 把 `http://localhost:3000` 暫時公開。

## 正式部署

正式部署流程請看 `DEPLOYMENT.md`。目前已支援後台登入與 Render 部署設定。

## 之後可以加的功能

- 訂單狀態推播給客人
- 付款串接
- 管理員登入
- PostgreSQL / MySQL 資料庫
- 庫存、尺寸、顏色與售完狀態
- 超商取貨或宅配串接

## Mallbic 訂單同步

後台可把新訂單轉成 `data/mallbic-order-template.xls` 的格式並上傳到墨筆克；訂單改成「已取消」後，也可同步到墨筆克做「買家取消」。

訂單 Excel 會填入：
- 姓名
- 手機號碼
- 品項條碼
- 數量：一律拆成 1
- 小計：單價
- 出貨方式：自行取貨 = 面交[代收]，宅配 = 快遞[代收]
- 地址：只有宅配填入
- 平台編號：使用本系統訂單號，供日後取消搜尋

環境變數：
```text
MALLBIC_ORDER_AUTO_SYNC_ENABLED=false
MALLBIC_ORDER_AUTO_SYNC_INTERVAL_MS=300000
```
