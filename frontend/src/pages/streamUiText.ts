import type { Language } from '../types';

const words = {
  "modelSource": [
    "Model source",
    "模型來源",
    "モデルソース",
    "모델 소스"
  ],
  "conversion": [
    "Conversion version",
    "轉換版本",
    "変換バージョン",
    "변환 버전"
  ],
  "path": [
    "Local model path",
    "指定模型路徑",
    "モデルのパス",
    "모델 경로"
  ],
  "format": [
    "Model format",
    "模型格式",
    "モデル形式",
    "모델 형식"
  ],
  "modelDetails": [
    "Model details",
    "模型詳細資訊",
    "モデル詳細",
    "모델 세부 정보"
  ],
  "loading": [
    "Loading...",
    "載入中…",
    "読み込み中…",
    "불러오는 중…"
  ],
  "selectConversion": [
    "Select conversion",
    "選擇轉換版本",
    "変換を選択",
    "변환 선택"
  ],
  "selectFormat": [
    "Select model format",
    "選擇模型格式",
    "モデル形式を選択",
    "모델 형식 선택"
  ],
  "localModel": [
    "Local model",
    "本機模型",
    "ローカルモデル",
    "로컬 모델"
  ],
  "modelPath": [
    "Model path",
    "模型路徑",
    "モデルパス",
    "모델 경로"
  ],
  "coordinates": [
    "Box coordinates",
    "框座標格式",
    "枠の座標形式",
    "상자 좌표 형식"
  ],
  "auto": [
    "Auto (metadata)",
    "自動（模型資訊）",
    "自動（メタデータ）",
    "자동 (메타데이터)"
  ],
  "pixels": [
    "Pixels",
    "像素",
    "ピクセル",
    "픽셀"
  ],
  "normalized": [
    "Normalized (0–1)",
    "正規化（0–1）",
    "正規化（0–1）",
    "정규화 (0–1)"
  ],
  "inspect": [
    "Inspect & use model",
    "檢查並使用模型",
    "検査して使用",
    "검사 후 사용"
  ],
  "inspecting": [
    "Inspecting…",
    "檢查中…",
    "検査中…",
    "검사 중…"
  ],
  "pathHint": [
    "Trusted YOLO Detect models: .pt / .onnx / .tflite. Use a path mounted in Docker.",
    "使用可信任的 YOLO Detect 模型：.pt／.onnx／.tflite。路徑必須已掛載至 Docker。",
    "信頼できる YOLO Detect モデル：.pt / .onnx / .tflite。Docker 内にマウントされたパスを指定してください。",
    "신뢰할 수 있는 YOLO Detect 모델: .pt / .onnx / .tflite. Docker에 마운트된 경로를 사용하세요."
  ],
  "noModels": [
    "No completed conversion models in this project.",
    "本專案尚無完成轉換的模型。",
    "完了した変換モデルはありません。",
    "완료된 변환 모델이 없습니다."
  ],
  "unavailable": [
    "Unavailable",
    "無法使用",
    "利用不可",
    "사용 불가"
  ],
  "source": [
    "Source",
    "影像來源",
    "映像ソース",
    "영상 소스"
  ],
  "videoFile": [
    "Video file",
    "影片檔案",
    "動画ファイル",
    "동영상 파일"
  ],
  "hostCamera": [
    "Host camera",
    "主機攝影機",
    "ホストカメラ",
    "호스트 카메라"
  ],
  "video": [
    "Video",
    "影片",
    "動画",
    "동영상"
  ],
  "selectVideo": [
    "Select video",
    "選擇影片",
    "動画を選択",
    "동영상 선택"
  ],
  "upload": [
    "Upload video",
    "上傳影片",
    "動画をアップロード",
    "동영상 업로드"
  ],
  "deleteVideo": [
    "Delete uploaded video",
    "刪除已上傳影片",
    "アップロード動画を削除",
    "업로드 동영상 삭제"
  ],
  "deleteConfirm": [
    "Delete this video?",
    "確定刪除此影片？",
    "この動画を削除しますか？",
    "이 동영상을 삭제할까요?"
  ],
  "uploadHint": [
    "No fixed upload size limit · 2K / 4K supported",
    "無固定上傳大小限制 · 支援 2K／4K",
    "アップロード容量制限なし · 2K / 4K 対応",
    "고정 업로드 용량 제한 없음 · 2K / 4K 지원"
  ],
  "unknownDuration": [
    "Duration unknown — play from start",
    "時長未知，從頭播放",
    "長さ不明 · 最初から再生",
    "길이 알 수 없음 · 처음부터 재생"
  ],
  "recovered": [
    "recovered from video timestamps",
    "已從影片時間戳恢復",
    "タイムスタンプから復元",
    "타임스탬프에서 복구"
  ],
  "camera": [
    "Camera",
    "攝影機",
    "カメラ",
    "카메라"
  ],
  "selectCamera": [
    "Select camera",
    "選擇攝影機",
    "カメラを選択",
    "카메라 선택"
  ],
  "noCameras": [
    "No host cameras detected.",
    "未偵測到主機攝影機。",
    "ホストカメラが見つかりません。",
    "호스트 카메라가 없습니다."
  ],
  "captureMode": [
    "Capture mode",
    "擷取模式",
    "キャプチャモード",
    "캡처 모드"
  ],
  "selectCapture": [
    "Select capture mode",
    "選擇擷取模式",
    "キャプチャモードを選択",
    "캡처 모드 선택"
  ],
  "uploadProgress": [
    "Video upload progress",
    "影片上傳進度",
    "動画アップロード進捗",
    "동영상 업로드 진행률"
  ],
  "checking": [
    "Checking video...",
    "檢查影片中…",
    "動画を確認中…",
    "동영상 확인 중…"
  ],
  "uploading": [
    "Uploading",
    "上傳中",
    "アップロード中",
    "업로드 중"
  ],
  "cancelUpload": [
    "Cancel upload",
    "取消上傳",
    "アップロードを中止",
    "업로드 취소"
  ],
  "output": [
    "Video output",
    "輸出設定",
    "映像出力",
    "영상 출력"
  ],
  "resolution": [
    "Resolution",
    "解析度",
    "解像度",
    "해상도"
  ],
  "bitrate": [
    "Bitrate (kbps)",
    "位元率（kbps）",
    "ビットレート（kbps）",
    "비트레이트 (kbps)"
  ],
  "inference": [
    "Inference",
    "推論",
    "推論",
    "추론"
  ],
  "device": [
    "Device",
    "運算裝置",
    "デバイス",
    "장치"
  ],
  "imageSize": [
    "Image size",
    "推論尺寸",
    "推論サイズ",
    "추론 크기"
  ],
  "metadata": [
    "Export metadata",
    "依模型設定",
    "モデル設定",
    "모델 설정"
  ],
  "confidence": [
    "Confidence",
    "信心門檻",
    "信頼度",
    "신뢰도"
  ],
  "start": [
    "Start",
    "開始",
    "開始",
    "시작"
  ],
  "stop": [
    "Stop",
    "停止",
    "停止",
    "중지"
  ],
  "pause": [
    "Pause",
    "暫停",
    "一時停止",
    "일시 정지"
  ],
  "resume": [
    "Resume",
    "繼續",
    "再開",
    "계속"
  ],
  "replay": [
    "Replay",
    "重播",
    "再生し直す",
    "다시 재생"
  ],
  "go": [
    "Go",
    "跳轉",
    "移動",
    "이동"
  ],
  "playback": [
    "Playback",
    "播放進度",
    "再生位置",
    "재생 위치"
  ],
  "timeline": [
    "Playback timeline",
    "播放時間軸",
    "再生タイムライン",
    "재생 타임라인"
  ],
  "time": [
    "Time (seconds)",
    "時間（秒）",
    "時間（秒）",
    "시간 (초)"
  ],
  "playbackTime": [
    "Playback time (seconds)",
    "指定播放時間（秒）",
    "再生時刻（秒）",
    "재생 시간 (초)"
  ],
  "liveHint": [
    "Live camera · replay is available for uploaded videos.",
    "攝影機即時串流 · 回放僅適用於已上傳影片。",
    "カメラのライブ映像 · リプレイは動画のみです。",
    "카메라 라이브 · 다시 재생은 업로드 영상에서만 가능합니다."
  ],
  "refresh": [
    "Refresh models and cameras",
    "重新整理模型與攝影機",
    "モデルとカメラを更新",
    "모델 및 카메라 새로고침"
  ],
  "fullscreen": [
    "Fullscreen",
    "全螢幕",
    "全画面",
    "전체 화면"
  ],
  "detectionStream": [
    "Detection stream",
    "偵測串流",
    "検出ストリーム",
    "검출 스트림"
  ],
  "terminalStream": [
    "Terminal detection stream",
    "終端偵測串流",
    "ターミナル検出ストリーム",
    "터미널 검출 스트림"
  ],
  "measuredFPS": [
    "Measured FPS",
    "實際 FPS",
    "実測 FPS",
    "실측 FPS"
  ],
  "detections": [
    "Detections",
    "偵測物件",
    "検出数",
    "검출 수"
  ],
  "frames": [
    "Frames",
    "影格數",
    "フレーム数",
    "프레임 수"
  ],
  "cli": [
    "CLI verification",
    "CLI 驗證",
    "CLI 検証",
    "CLI 검증"
  ],
  "copy": [
    "Copy Python command",
    "複製 Python 指令",
    "Python コマンドをコピー",
    "Python 명령 복사"
  ],
  "copied": [
    "Copied",
    "已複製",
    "コピー済み",
    "복사됨"
  ],
  "command": [
    "Python verification command",
    "Python 驗證指令",
    "Python 検証コマンド",
    "Python 검증 명령"
  ],
  "terminalLoading": [
    "Loading terminal...",
    "載入終端中…",
    "ターミナルを読み込み中…",
    "터미널 불러오는 중…"
  ],
  "Idle": [
    "Idle",
    "待命",
    "待機",
    "대기"
  ],
  "Ready": [
    "Ready",
    "就緒",
    "準備完了",
    "준비됨"
  ],
  "Stopped": [
    "Stopped",
    "已停止",
    "停止中",
    "중지됨"
  ],
  "Connecting": [
    "Connecting",
    "連線中",
    "接続中",
    "연결 중"
  ],
  "Failed": [
    "Failed",
    "失敗",
    "失敗",
    "실패"
  ],
  "Live": [
    "Live",
    "播放中",
    "再生中",
    "재생 중"
  ],
  "Completed": [
    "Completed",
    "播放完畢",
    "再生完了",
    "재생 완료"
  ],
  "Terminal": [
    "Terminal",
    "終端",
    "ターミナル",
    "터미널"
  ]
} as const;
export type StreamUiKey = keyof typeof words;
const index: Record<Language, number> = {en:0,zh:1,ja:2,ko:3};
export function streamUiText(language: Language, key: StreamUiKey): string { return words[key][index[language]]; }
