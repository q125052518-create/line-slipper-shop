# LINE LIFF 拖鞋下單系統範例

這是一個最小可行版本，包含：

- LIFF 下單頁
- 多個拖鞋賣場
- 商品圖片、商品名稱、商品說明
- 多品項管理，每個品項可設定條碼與價格
- 購物車與訂單建立
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
- 購物車資料會暫存在瀏覽器，進入 `/cart.html` 後再結帳
- 下單成功後會自動扣庫存
- 庫存不足時不能超量加入購物車

資料會存在 `data/catalog.json`，訂單會存在 `data/orders.json`。正式上線時建議改成 PostgreSQL、MySQL 或 Supabase。

## LINE 設定

複製 `.env.example` 成 `.env`，填入：

```bash
LINE_CHANNEL_SECRET=你的 Messaging API Channel Secret
LINE_CHANNEL_ACCESS_TOKEN=你的 Channel Access Token
LIFF_ID=你的 LIFF ID
```

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
