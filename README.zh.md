# ObjectAutoLabel

[English](README.md) · 繁體中文

本機優先的物件偵測資料與模型工作台：從圖片／影片、偽標註、人工校正到資料增強、切分、YOLO 訓練及模型匯出，在同一個 WebUI 完成。

![概念圖對照重複手動標註與專案 Web UI 流程：影像來源與提示詞經 World Model 產生偽標註並供人工校正，再將多組資料混合、取樣及切分，用於訓練與模型版本驗證。](docs/diagrams/project-concept-unified.png)

## 解決的問題

1. **減少人工標註負擔**：提示詞驅動的 World Model 先為影像產生候選物件框，讓人員從檢查與修正開始，減少逐框繪製的重複工作。
2. **讓 AI Agent 透過 API 協助操作**：Codex、Claude Code 等能存取本地環境的工具，可讀取[訓練工作流程 skill](skill/object-autolabel-training/SKILL.md)，透過 REST API 準備資料、提交任務及檢查成果；使用 REST 不需要內建 MCP server。
3. **新增目標物件並快速迭代**：定義目標類別後，產生偽標註、組合與切分資料、訓練新模型版本，再透過專案工作流程驗證。偽標註和模型表現仍需檢查，不能保證正確。

## 專案目的

- **快速偽標註與 YOLO 訓練**：使用提示詞驅動的視覺世界模型（YOLO-World／YOLOE）快速產生物件框與偽標籤，再訓練 YOLO11、YOLO26 等相容的 YOLO 架構。
- **本地化、可由 API 驅動的迭代平台**：標註與訓練留在自己的主機，本地 AI Agent 可透過 REST API 產生標註、建立 Split、提交訓練與讀取結果。目前尚未內建 MCP server。
- **生成式資料快速建立專用模型**：將 ComfyUI 產出的圖片，或 [MiniMax H3 影片](https://comfy.org/minimax-h3/)抽幀後匯入，直接進行偽標註與指定物件的 YOLO 訓練，不必先搭建模擬器或額外的 sim2real 轉換流程；真實場景表現仍須驗證。

## 專案流程概覽

以專案為中心的 Web UI 管理來源影像、標註、資料集版本及模型訓練紀錄。提示詞驅動的 World Model 先產生候選標註供人員檢查；多組偽標註資料與選用的類別映射 Open Data 可以再混合、取樣及切分，用於模型訓練。驗證模型版本後，可依結果調整下一輪資料。此圖為概念示意；目前實作請參考[詳細操作流程](#操作流程)。

## 偽標註解決什麼問題？

![手動標註需要反覆畫框；World Model 利用影像與提示詞產生候選框，供人員檢查及修正。](docs/diagrams/pseudo-labeling-paper.png)

逐張繪製物件框需要重複操作。輸入類別與提示詞後，視覺模型會對來源影像提出候選框，讓標註人員有可供修改的起點。模型仍可能漏掉物件或產生錯誤框，建立訓練資料集前需要檢查與修正。

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

![ObjectAutoLabel 流程：原始或生成式影像經多組平行的偽標註、校正與增強，與選用的 Open Data 合併後切分、訓練、驗證及匯出，再回饋下一輪迭代。](docs/diagrams/workflow.zh.svg)

[以 draw.io 編輯流程圖](docs/diagrams/workflow.drawio) · 內含 English／繁體中文頁面

- **Sources → Pseudo**：處理圖片或抽取影片影格，指定 Source 版本並提交類別與提示詞。同一路徑再次處理時會先要求確認。
- **Pseudo → Review**：可合併同類提示詞的框，並用直方圖區間排除過大的框。沿用（Reuse）會複製最近保存的同來源／版本標註，空白圖片也能使用；同類別 IoU 超過門檻時保留當前框（預設 0.8），檢查後仍需保存。
- **平行組合 → Split**：可加入多組 Pseudo → Augment；Skip augment 建立不增強的版本。Open Data 完成類別映射與取樣後直接加入，不經 Pseudo／Augment；Platform 需 API key。
- **Split → Train**：保存並指定組合，再建立 Split。Assign & history 保留版本選擇；上游修改可能使下游 Split 過期。在 Task Center 查看訓練進度或取消。
- **Validate → Export／Stream Demo**：抽樣驗證後下載模型包，或以攝影機／影片推論。x86_64 支援 ONNX／LiteRT FP32；Jetson 的 PT 權重需移到 x86_64 主機轉換。

## API 與本地 AI Agent

[互動式 API 文件](http://127.0.0.1:8501/docs) · [OpenAPI 規格](http://127.0.0.1:8501/openapi.json) · [端點說明](spec/API.md)

長時間任務會回傳 job ID，可用 `GET /api/jobs/{job_id}` 查詢狀態與結果。本地 Agent 可據此串接「產生標註 → 訓練 → 評估」迭代；MCP 需另行實作轉接層。目前 ComfyUI 的串接方式是匯入生成檔案，並非內建生成節點。

專案提供[訓練工作流程 skill](skill/object-autolabel-training/SKILL.md)，包含啟動、API 操作、類別確認與成果回報。使用具備終端機及本地 API 存取能力的 agent 開啟此專案後，可以直接輸入：

> 請閱讀 `skill/object-autolabel-training/SKILL.md` 與專案文件，使用 ObjectAutoLabel 訓練 `data/input/my-images` 資料夾中的物件偵測模型；若目標物件或標籤 schema 不明確，先與我確認類別，再產生並檢查偽標註、建立資料切分、訓練模型，最後回報實際模型路徑與驗證結果。

請將資料夾換成自己的路徑。Agent 可以直接讀取該檔案；是否自動發現 skill 取決於工具及其設定。目前訓練支援相容的 YOLO 權重，尚非任意模型架構。

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
