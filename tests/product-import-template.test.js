import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import XLSX from "xlsx";

const templateUrl = new URL("../public/product-import-template.xlsx", import.meta.url);
const expectedHeaders = [
  "分類", "子分類", "商品名稱", "商品說明", "商品圖片網址", "款式",
  "品項條碼", "售價", "數量", "品項圖片網址", "是否上架"
];

test("download template preserves Chinese headers and typed example data", async () => {
  const workbook = XLSX.read(await fs.readFile(templateUrl), { type: "buffer" });
  assert.deepEqual(workbook.SheetNames, ["Import"]);
  const sheet = workbook.Sheets.Import;
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  assert.deepEqual(rows[0], expectedHeaders);
  assert.equal(rows.length, 3);
  assert.doesNotMatch(JSON.stringify(rows), /\?{2,}|\uFFFD/);
  assert.equal(sheet.C2.v, "範例拖鞋一");
  assert.equal(sheet.F2.v, "白色 / 24cm");
  assert.equal(sheet.C3.v, "範例拖鞋二");
  assert.equal(sheet.F3.v, "藍色 / M");
  for (const address of ["H2", "I2", "H3", "I3"]) {
    assert.equal(sheet[address].t, "n", `${address} must remain numeric`);
  }

  // Run only the production pure parser, without booting the server or workers.
  const source = await fs.readFile(new URL("../server.js", import.meta.url), "utf8");
  const parser = source.match(/function parseProductImportRows\(rows\) \{[\s\S]*?\nfunction parseActiveValue\(value\) \{[\s\S]*?\n\}/);
  assert.ok(parser, "Product import parser must exist");
  const context = { rows };
  vm.runInNewContext(`${parser[0]}\nresult = parseProductImportRows(rows);`, context, { timeout: 1000 });
  assert.equal(context.result.error, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(context.result.items.map((item) => ({
    productName: item.productName, barcode: item.barcode,
    price: item.price, stock: item.stock, isActive: item.isActive
  })))), [
    { productName: "範例拖鞋一", barcode: "SLP-CW-24", price: 390, stock: 20, isActive: true },
    { productName: "範例拖鞋二", barcode: "SLP-BL-M", price: 250, stock: 14, isActive: true }
  ]);
});
