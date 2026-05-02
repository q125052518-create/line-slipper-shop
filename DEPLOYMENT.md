# 正式部署筆記

## 已補上的正式站基礎

- 後台登入保護
- 後台登出
- Render 部署設定 `render.yaml`
- `.env.example` 正式環境變數

## 本機登入

如果沒有設定 `.env`，本機後台密碼暫時是：

```text
admin123
```

正式上線一定要在雲端設定 `ADMIN_PASSWORD`，不要使用預設密碼。

## Render 部署

1. 把專案推到 GitHub。
2. 到 Render 建立 Web Service。
3. 選這個 GitHub repo。
4. Build Command 使用：

```bash
npm install && npx playwright install chromium
```

5. Start Command 使用：

```bash
npm start
```

6. 設定環境變數：

```text
ADMIN_PASSWORD=你的後台密碼
SESSION_SECRET=一串很長的隨機字
LINE_CHANNEL_SECRET=LINE 後台的 Channel Secret
LINE_CHANNEL_ACCESS_TOKEN=LINE 後台的 Channel Access Token
LIFF_ID=LINE LIFF ID
PLAYWRIGHT_BROWSERS_PATH=0
MALLBIC_ACCOUNT=墨筆克帳號
MALLBIC_PASSWORD=墨筆克密碼
MALLBIC_COMPANY_NAME=祥瑞華有限公司
MALLBIC_AUTO_SYNC_ENABLED=true
MALLBIC_AUTO_SYNC_INTERVAL_MS=3600000
MALLBIC_ORDER_AUTO_SYNC_ENABLED=false
MALLBIC_ORDER_AUTO_SYNC_INTERVAL_MS=300000
```

`MALLBIC_ACCOUNT` 和 `MALLBIC_PASSWORD` 是給後台「墨筆克線上同步庫存」與「墨筆克訂單同步」使用，不要放在前台或 GitHub 程式碼裡。

`MALLBIC_ORDER_AUTO_SYNC_ENABLED=false` 代表訂單不會自動上傳客資到墨筆克，只能在後台手動按同步。確認要正式自動送單後，再改成 `true`。

## 重要限制

目前商品、訂單、圖片仍存在本機 JSON 檔。這可以給少量人測正式網址，但不適合長期營運，因為雲端部署重建或換機器時資料可能遺失。

正式營運建議下一步改成：

- Supabase/PostgreSQL 存商品、品項、庫存、訂單
- Supabase Storage 或 S3 存圖片
- 測試站與正式站分開

## LINE 設定

部署完成後，把 Render 的 HTTPS 網址填到：

- LIFF Endpoint URL
- Messaging API Webhook URL：`https://你的網域/webhook`
