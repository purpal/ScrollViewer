# ScrollViewer

長條圖片／漫畫瀏覽器，使用 Electron 開發。

## 功能

- 瀏覽本地資料夾中的圖片（bmp/jpg/png/gif/webp/tif/tiff）
- 開啟 zip/cbz、rar/cbr 壓縮檔，將內容串成長條圖捲動閱讀
- 含圖片的子資料夾會自動當成一話串接瀏覽，同層散落的圖片也會自動合併成一話
- 依名稱或修改時間排序
- 縮放（放大/縮小/原始大小），縮放間隔可自訂
- 格狀縮圖瀏覽模式
- 深色模式與可自訂主題色
- 最近開啟資料夾清單
- 拖曳資料夾或壓縮檔開啟
- 全螢幕沉浸式閱讀模式
- 偏好設定頁：外觀、瀏覽行為、快速鍵皆可自訂

## 開發

```bash
npm install
npm start
```

## 打包

```bash
npm run dist
```

使用 [electron-builder](https://www.electron.build/) 打包成 Windows/macOS/Linux 安裝檔，輸出於 `dist/`。

## 快速鍵（預設值，可在偏好設定頁自訂）

| 按鍵 | 功能 |
| --- | --- |
| Ctrl/Cmd + O | 開啟資料夾 |
| ← / → | 上一話 / 下一話 |
| Home | 回到頂端 |
| + / - | 放大 / 縮小 |
| = 或 Enter | 原始大小 |
| Ctrl/Cmd + D | 深色模式切換 |
| Ctrl/Cmd + G | 格狀瀏覽模式切換 |
| F1 | 使用說明 |
| F11 | 全螢幕沉浸式閱讀 |
| Ctrl/Cmd + , | 偏好設定 |
| Esc | 關閉使用說明 / 偏好設定 |
