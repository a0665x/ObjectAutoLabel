# ObjectAutoLabel

繁體中文 · [English](README.en.md)

本機優先的物件偵測資料與模型工作台：從圖片／影片、偽標註、人工校正到資料增強、切分、YOLO 訓練及模型匯出，在同一個 WebUI 完成。

![操作介面預覽](demo_imgs/interface_preview.gif)

## 快速開始

需要 Linux、Docker Compose 與 NVIDIA GPU 執行環境（驅動及 NVIDIA Container Toolkit）。支援 x86_64 桌機與 Jetson ARM64；Jetson 映像須符合主機的 JetPack／L4T 版本。

```bash
git clone https://github.com/a0665x/ObjectAutoLabel.git
cd ObjectAutoLabel

# 安裝偽標註模型與提示詞編碼器；首次下載需要網路
scripts/install-world-model.sh

# 安裝 YOLO11n 訓練起始權重
scripts/install-input-model.sh

# 首次安裝：選擇平台、建立映像並啟動
./run.sh
```

開啟 [http://127.0.0.1:8501/](http://127.0.0.1:8501/)。Jetson 的區網位址以啟動輸出為準。

`./run.sh` 只在映像不存在時建立並啟動；已有映像時，使用下列指令：

| 操作 | 指令 |
| --- | --- |
| 啟動／重開機後啟動，不重建 | `./run.sh --up` |
| 更新程式後重建並啟動 | `./run.sh --rebuild` |
| 查看狀態／日誌 | `./run.sh --status` ／ `./run.sh --logs` |
| 停止服務 | `./run.sh --down` |
| 指定平台 | `./run.sh --mode desktop` ／ `./run.sh --mode jetson` |

重建會中斷執行中的工作；請先確認訓練等任務已結束。重建不會清除資料與模型。

## 準備資料與模型

將圖片資料夾或影片放入 `data/input/`，再到 Sources 選擇。容器內對應路徑為 `/app/data/input/`。

```text
data/input/        原始圖片與影片
data/projects/     各專案的圖片、標註、切分與模型成果
data/opendata/     共用的公開資料快取
world_model/       偽標註模型及提示詞編碼器
input_model/       訓練起始權重
output_model/      專案模型索引
```

可選模型：

```bash
# 改用 YOLO-World v2 Small 偽標註
scripts/install-world-model.sh yolov8s-worldv2.pt

# 加入 YOLO26n 訓練權重
scripts/install-input-model.sh yolo26n.pt
```

安裝腳本會驗證下載檔案的 SHA-256。模型目錄已掛載到容器，新增模型後重新整理頁面即可，不必重建。資料、權重、密鑰與執行日誌不會提交到 Git。

## 操作流程

1. **Projects**：建立或選擇專案。
2. **Sources**：選擇圖片資料夾或影片，執行 Process & analysis，再於 Source history 指定要使用的版本。影片可設定抽幀；重複處理同一路徑會先要求確認。
3. **Pseudo Label**：提交類別與提示詞設定，確認已指定的 Source，選擇模型並產生偽標註。可合併同類提示詞的框，並用面積分佈直方圖的可拖曳區間排除過大的框；Auto 會依新一輪偵測結果計算範圍。
4. **Review**：依指定的 Pseudo／Augment 版本檢查與修改框。沿用（Reuse）會複製同來源／版本最近保存的整組標註，空白或已有框的圖片都能使用。同類別框 IoU > 0.8 時保留當前圖片原有框；門檻跟隨最近設定的 Review Merge 值。檢查後仍需保存。
5. **Augment**：選擇對應的 Pseudo 版本，設定增強效果及倍率；不需要增強時使用 Skip augment。
6. **Open Data（選用）**：匯入 VisDrone 或 Ultralytics Platform 的 Detect 資料集，完成類別映射與取樣。Platform 需 API key；Open Data 不經 Pseudo／Augment。
7. **Split**：在 Dataset sources 加入一組或多組平行的 Pseudo → Augment，另可加入一個 Open Data 版本。確認數量與比例，保存並指定組合，再建立 Split 版本。Open Data 的既有訓練／驗證分組會保留。
8. **Train**：選擇有效的 Split、起始模型與訓練參數；在 Task Center 查看進度或取消。
9. **Validate → Convert / Export**：抽樣驗證模型，轉換及下載模型包。x86_64 支援 ONNX／LiteRT FP32；Jetson 請將 PT 權重移到 x86_64 主機轉換。
10. **Stream Demo**：以 PT、ONNX 或 LiteRT 模型對攝影機／上傳影片推論。

各頁的 **Assign & history** 保留版本選擇；Review 的 Pseudo 與 Augment 各自使用其指定版本。修改上游標註後，受影響的 Split 可能過期，需要重建才能用於新訓練。

## Review 快捷鍵

| 操作 | 快捷鍵 |
| --- | --- |
| 選取／畫框／平移 | `D` ／ `B` ／ `H` |
| 保存並下一張 | `N` 或 `Shift+S` |
| 保存 | `Ctrl/Cmd+S` |
| 復原／重做 | `Ctrl/Cmd+Z` ／ `Ctrl/Cmd+Shift+Z` |
| 複製／貼上／複製所選框 | `Ctrl/Cmd+C` ／ `Ctrl/Cmd+V` ／ `Ctrl/Cmd+D` |
| 刪除所選框 | `Delete` ／ `Backspace` |
| 多選／縮放 | `Shift+拖曳` ／ `Ctrl+滾輪` |
| 移除專案內圖片（需確認） | `Shift+X` |

沿用後可復原；重複按沿用不會再加入相同框。右鍵可開啟框的編輯選單。

## 使用注意

- 刪除專案或 Source history 不會刪除 `data/input/` 原始檔案；刪除上游歷史會連帶刪除依賴它的下游成果，請確認提示內容。
- 服務以可信任的本機／私人網路操作為主。CLI 是具掛載資料存取權的真實 shell，需保護其 token；不要直接對公開網路開放。
- 私人遠端存取可使用 `./run.sh --tailscale-up`。選用登入設定見 [.env.example](.env.example)；登入目前不提供使用者間的專案隔離。

## 開發與文件

FastAPI + SQLite + React／TypeScript + Vite。開發細節見 [專案結構](spec/PROJECT_MAP.md)、[部署與排錯](spec/OPERATIONS.md)及 [CLI 操作](cli_workspace/README.md)。

```bash
# 需先安裝相應測試依賴；後端建議使用專案的 Docker 環境
pytest -q
npm --prefix frontend test -- --run --maxWorkers=1
npm --prefix frontend run build
```

## 授權

[AGPL-3.0](LICENSE)。透過網路提供修改版服務時，須依授權提供相應原始碼。第三方授權見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
