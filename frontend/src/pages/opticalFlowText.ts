import type {Language} from '../types';
type Text=readonly[string,string,string,string];
const words={
  show:['Show optical flow','顯示光流變化','オプティカルフローを表示','광학 흐름 표시'],
  title:['Optical flow · image motion','光流 · 影像運動','オプティカルフロー · 画像の動き','광학 흐름 · 영상 움직임'],
  hint:['Local image motion, independent of detections and tracking IDs. Computed in a background worker on displayed video frames.','獨立於偵測框及追蹤 ID，從播放影格計算局部影像運動，於背景 Worker 運算。','検出枠や追跡IDと独立した画像の局所運動です。表示フレームをバックグラウンドで解析します。','검출 상자 및 추적 ID와 독립적으로 표시 프레임의 국소 움직임을 백그라운드에서 계산합니다.'],
  settings:['Optical-flow settings','光流設定','フロー設定','광학 흐름 설정'],
  cols:['Grid columns','橫向取樣點數','グリッド列数','격자 열'],
  rows:['Grid rows','縱向取樣點數','グリッド行数','격자 행'],
  gain:['Arrow gain','箭頭放大倍率','矢印の倍率','화살표 배율'],
  trail:['Trail length (samples)','軌跡長度（取樣次數）','軌跡の長さ（サンプル数）','궤적 길이 (샘플)'],
  trails:['Show motion trails','顯示歷史運動軌跡','運動軌跡を表示','움직임 궤적 표시'],
  grid:['Show reference grid','顯示初始參考網格','基準グリッドを表示','기준 격자 표시'],
  points:['Show sample points','顯示取樣點','サンプル点を表示','샘플 점 표시'],
  vector:['Arrow direction','箭頭方向','矢印の方向','화살표 방향'],
  flow:['Optical motion · Δx, Δy','光流運動方向 · Δx、Δy','フロー方向 · Δx, Δy','광학 움직임 · Δx, Δy'],
  gradientVector:['Brightness gradient · ∇I','亮度梯度方向 · ∇I','輝度勾配 · ∇I','밝기 기울기 · ∇I'],
  color:['Color by','顏色依據','色の基準','색상 기준'],
  magnitude:['Displacement · px / sample','位移大小 · px／取樣','変位 · px／サンプル','변위 · px / 샘플'],
  speed:['Speed · px / s','影像速度 · px／秒','画像速度 · px／秒','영상 속도 · px / s'],
  direction:['Motion direction · degrees','運動方向 · 角度','動く方向 · 度','움직임 방향 · 각도'],
  gradient:['Gradient strength','亮度梯度強度','勾配の強さ','기울기 강도'],
  confidence:['Texture quality · not accuracy','紋理品質 · 非正確率','テクスチャ品質 · 精度ではありません','텍스처 품질 · 정확도 아님'],
  quality:['Analysis maximum size','分析影像最大邊','解析画像の最大辺','분석 이미지 최대 크기'],
  radius:['Tracking window radius','追蹤視窗半徑','追跡窓の半径','추적 창 반경'],
  threshold:['Minimum texture','最低紋理門檻','テクスチャの下限','최소 텍스처'],
  reset:['Reset flow points','重設光流取樣點','フロー点をリセット','광학 흐름 점 초기화'],
  waiting:['Waiting for video frames.','等待播放影格。','映像フレームを待機中。','영상 프레임 대기 중입니다.'],
  reference:['Reference grid ready; the next distinct frame starts motion estimation.','參考網格已建立；下一個影格開始估計運動。','基準グリッドを作成しました。次のフレームから動きを推定します。','기준 격자가 준비되었습니다. 다음 프레임부터 움직임을 추정합니다.'],
  valid:['Valid sample points','有效取樣點','有効サンプル点','유효 샘플 점'],
  meanMotion:['Mean displacement','平均位移','平均変位','평균 변위'],
  meanSpeed:['Mean image speed','平均影像速度','平均画像速度','평균 영상 속도'],
  meanDirection:['Mean direction','平均運動方向','平均方向','평균 방향'],
  legend:['Blue → red: lower → higher. Direction uses hue. Orange ×: lost / low texture.','藍→紅：由低到高；方向以色相表示。橘色 ×：遺失或紋理不足。','青→赤：低→高。方向は色相。オレンジ×：消失／テクスチャ不足。','파랑→빨강: 낮음→높음. 방향은 색상으로 표시합니다. 주황 ×: 손실 또는 텍스처 부족.'],
  limits:['Units use decoded stream pixels, not real-world speed. Gradient is not motion. Busy analysis skips frames; jumps or changed sampling settings reset trails. No extra image cache is written.','單位為串流影像像素，不是實際世界速度；梯度不等於運動。運算忙碌時會跳過影格，跳轉或改取樣設定會重設軌跡，不另存影像快取。','単位はストリーム画像の画素です。実世界速度ではなく、勾配と運動も異なります。解析が忙しいとフレームを間引きます。シークや設定変更で軌跡をリセットし、画像キャッシュは保存しません。','단위는 스트림 영상 픽셀이며 실제 세계 속도가 아닙니다. 기울기는 움직임과 다릅니다. 분석 중에는 프레임을 건너뛰며 이동·설정 변경 시 궤적을 초기화합니다. 이미지 캐시를 저장하지 않습니다.'],
  error:['Optical-flow analysis is unavailable or timed out. Reduce the grid/analysis size and reset, or reopen this checkbox. Detection playback is unaffected.','光流無法執行或運算逾時，請降低網格／分析尺寸後重設，或重新勾選。偵測影片不受影響。','フロー解析が利用できないかタイムアウトしました。グリッド／解析サイズを下げてリセット、または再度オンにしてください。検出再生には影響しません。','광학 흐름 분석을 사용할 수 없거나 시간이 초과되었습니다. 격자·분석 크기를 줄여 초기화하거나 다시 켜세요. 검출 재생에는 영향이 없습니다.'],
  cli:['Optical flow uses Web UI video playback, not command-rendered Terminal images.','光流適用 Web UI 影片播放，不適用 Terminal 指令輸出的影像。','フローはWeb UI映像再生用です。Terminalの画像出力には適用されません。','광학 흐름은 Web UI 영상 재생용이며 Terminal 이미지에는 적용되지 않습니다.'],
} satisfies Record<string,Text>;
const indices:Record<Language,number>={en:0,zh:1,ja:2,ko:3};
export type FlowTextKey=keyof typeof words;
export const opticalFlowText=(language:Language,key:FlowTextKey)=>words[key][indices[language]];

const help={
  show:[
    'Estimates local image motion between displayed frames, without needing detection boxes or tracking IDs. On: uses a background CPU worker. Off: stops flow analysis; detector playback is unchanged.',
    '比較相鄰播放影格，估計影像各處如何移動，不需要偵測框或追蹤 ID。開啟：使用背景 CPU Worker 計算；關閉：停止光流運算，偵測播放不受影響。',
    '表示フレーム間の局所的な動きを推定します。検出や追跡IDは不要です。オン：CPUのバックグラウンド処理を使用。オフ：フロー計算を停止し、検出再生は変えません。',
    '표시 프레임 사이의 국소 움직임을 추정하며 검출이나 추적 ID가 필요하지 않습니다. 켜짐: 백그라운드 CPU 연산을 사용합니다. 꺼짐: 흐름 계산만 중지하며 검출 재생은 유지합니다.',
  ],
  cols:[
    'Number of sample points across the image; total points = columns × rows. Higher: denser coverage and more CPU work. Lower: fewer points and lighter computation. Does not increase video resolution or detector accuracy.',
    '影像橫向要放幾個取樣點；總點數＝橫向×縱向。越大：觀察更密，但 CPU 計算較重；越小：取樣較疏、較省運算。不會提高影片解析度或偵測模型準確率。',
    '画像の横方向の点数。合計は列数×行数です。大きい：密に観測できますがCPU負荷が増えます。小さい：疎になりますが軽くなります。映像解像度や検出精度は変わりません。',
    '영상 가로 방향의 샘플 수이며 전체 점 수는 열×행입니다. 높을수록 촘촘하지만 CPU 부하가 증가합니다. 낮을수록 성기지만 가볍습니다. 영상 해상도나 검출 정확도는 바뀌지 않습니다.',
  ],
  rows:[
    'Number of sample points down the image; total points = columns × rows. Higher: denser vertical coverage and more CPU work. Lower: sparser coverage and less work. Sampling changes reset flow trails.',
    '影像縱向要放幾個取樣點；總點數＝橫向×縱向。越大：縱向觀察更密、運算較重；越小：取樣較疏、運算較少。修改取樣設定會重設光流軌跡。',
    '縦方向の点数。合計は列数×行数です。大きい：縦に密になりますが負荷が増えます。小さい：疎で軽くなります。変更すると軌跡をリセットします。',
    '세로 방향의 샘플 수이며 전체 점 수는 열×행입니다. 높을수록 세로 관측이 촘촘하고 부하가 늘어납니다. 낮을수록 성기고 가볍습니다. 변경 시 궤적을 초기화합니다.',
  ],
  gain:[
    'Visual arrow-length multiplier only. Higher: small movements are easier to see, but arrows overlap more. Lower: shorter, less cluttered arrows. Measured displacement/speed and model predictions are unchanged.',
    '只放大畫面上的箭頭長度。越大：微小變化更容易看見，但箭頭較容易互相遮擋；越小：箭頭較短、畫面較清楚。不會改變實測位移、速度或模型預測。',
    '表示する矢印の長さだけを拡大します。大きい：小さな変化が見やすくなりますが重なります。小さい：短くすっきりします。計測値やモデル予測は変わりません。',
    '표시 화살표 길이만 확대합니다. 높을수록 작은 움직임이 잘 보이지만 겹치기 쉽습니다. 낮을수록 짧고 깔끔합니다. 측정 변위·속도와 모델 예측은 변하지 않습니다.',
  ],
  trail:[
    'Maximum retained samples per flow point, not seconds. Higher: longer motion history, more clutter and memory. Lower: shorter, cleaner trails. Duration depends on completed analysis samples; this does not change inference.',
    '每個取樣點最多保留幾次歷史，不是秒數。越大：可看較長的運動歷史，但較雜、記憶體較多；越小：軌跡較短、畫面較乾淨。實際長度取決於完成的取樣次數，不改變模型推論。',
    '点ごとに保持する履歴数で、秒数ではありません。大きい：長い履歴を表示しますが重なりとメモリが増えます。小さい：短く明瞭になります。推論は変わりません。',
    '점마다 보관하는 샘플 수이며 초가 아닙니다. 높을수록 긴 이력을 보지만 복잡해지고 메모리를 더 사용합니다. 낮을수록 짧고 깔끔합니다. 추론에는 영향이 없습니다.',
  ],
  trails:[
    'On: draws each point’s recent motion path. Off: hides paths for a cleaner image. Display only; flow calculation and detections are unchanged.',
    '開啟：畫出各取樣點最近的運動路徑；關閉：隱藏歷史線條，降低遮擋。只影響顯示，不改變光流計算或偵測。',
    'オン：各点の最近の移動経路を表示。オフ：経路を隠して見やすくします。表示だけで計算や検出は変わりません。',
    '켜짐: 각 점의 최근 이동 경로를 표시합니다. 꺼짐: 경로를 숨겨 화면을 정리합니다. 흐름 계산과 검출에는 영향이 없습니다.',
  ],
  grid:[
    'On: shows the original sampling grid as a spatial reference. Off: hides it. Display only; it does not increase sample count or detection boxes.',
    '開啟：顯示初始取樣網格，方便對照影像位置；關閉：隱藏網格。只是參考線，不會增加取樣點或偵測框。',
    'オン：初期サンプル位置の基準線を表示。オフ：非表示。参照用の表示だけで点数や検出は増えません。',
    '켜짐: 초기 샘플 격자를 위치 기준으로 표시합니다. 꺼짐: 숨깁니다. 표시용 기준선이며 샘플이나 검출 수는 늘지 않습니다.',
  ],
  points:[
    'On: marks current flow sample positions. Off: hides these markers while arrows remain. Orange crosses mean lost or insufficient texture, not failed object detection.',
    '開啟：標出光流取樣點目前的位置；關閉：隱藏點標記，箭頭仍可顯示。橘色叉號表示點遺失或紋理不足，不代表物件偵測失敗。',
    'オン：現在のサンプル位置を表示。オフ：点を隠しますが矢印は残ります。オレンジの×は点の消失・特徴不足であり、物体検出の失敗ではありません。',
    '켜짐: 현재 흐름 샘플 위치를 표시합니다. 꺼짐: 점만 숨기고 화살표는 유지합니다. 주황 ×는 손실·텍스처 부족이며 객체 검출 실패가 아닙니다.',
  ],
  vector:[
    'Optical motion: arrows follow measured frame-to-frame displacement. Brightness gradient: arrows point toward increasing image brightness, not movement. This changes drawing only, not flow measurements or detection.',
    '光流運動：箭頭表示前後影格的位移方向。亮度梯度：箭頭朝影像較亮的方向，不是物體移動方向。只切換畫法，不改變光流量測或偵測。',
    'フロー方向はフレーム間の変位を表示。輝度勾配は明るくなる方向で、動きではありません。描画のみを切り替え、計測や検出は変わりません。',
    '광학 움직임은 프레임 간 변위 방향입니다. 밝기 기울기는 밝아지는 방향이며 이동 방향이 아닙니다. 표시만 바뀌고 측정이나 검출은 유지됩니다.',
  ],
  color:[
    'Choose what arrow colors describe: displacement per sample, speed per second, motion direction, brightness gradient, or texture quality. Blue→red means lower→higher, except direction uses hue. Texture quality is not an accuracy probability. Color changes do not affect calculation.',
    '選擇箭頭顏色代表什麼：每次取樣位移、每秒影像速度、運動方向、亮度梯度或紋理品質。除方向使用色相外，藍→紅表示由低到高。紋理品質不是正確率；切換顏色不影響計算。',
    '色の意味を変位・速度・方向・輝度勾配・テクスチャ品質から選びます。方向以外は青→赤で低→高。品質は正答確率ではありません。計算は変わりません。',
    '변위·속도·방향·밝기 기울기·텍스처 품질 중 색의 의미를 선택합니다. 방향 외에는 파랑→빨강이 낮음→높음입니다. 품질은 정확도 확률이 아니며 계산은 변하지 않습니다.',
  ],
  quality:[
    'Maximum long edge of the grayscale image used for flow analysis, limited by the decoded video size. Higher: more spatial detail but greater CPU/memory cost. Lower: faster, but fine motion may be lost. This is not model input size; changing it resets flow trails.',
    '光流分析用灰階影像的最長邊上限，不超過解碼影片尺寸。越大：保留更多細節，但 CPU 與記憶體負擔較高；越小：較快，但可能看不到細微變化。不是模型輸入尺寸；修改會重設光流軌跡。',
    'フロー解析用の灰色画像の最大辺。復号映像サイズが上限です。大きい：細部と負荷が増えます。小さい：速い一方、細かい動きを失う場合があります。モデル入力サイズではなく、変更時に軌跡をリセットします。',
    '흐름 분석용 회색조 영상의 최대 변 길이이며 디코딩 크기로 제한됩니다. 높을수록 세밀하지만 CPU·메모리 부하가 커집니다. 낮을수록 빠르지만 작은 움직임을 놓칠 수 있습니다. 모델 입력 크기가 아니며 변경 시 궤적이 초기화됩니다.',
  ],
  radius:[
    'Pixels around each point used to compare local image patches; window width = 2 × radius + 1 in the analysis image. Higher: more context and computation, but nearby motions may mix. Lower: finer local detail, less work, but more sensitivity to noise or weak texture. Resets flow trails.',
    '在分析影像中，每個點周圍拿多少像素來比對；視窗寬＝2×半徑＋1。越大：參考區域較多、運算較重，也可能混入鄰近物體的運動；越小：較局部、較快，但較怕雜訊或紋理不足。修改會重設光流軌跡。',
    '点の周囲を比較する半径。窓幅は解析画素で2×半径+1です。大きい：文脈と負荷が増え、隣接する動きが混ざる場合があります。小さい：局所的で軽い反面、ノイズや特徴不足に弱くなります。軌跡をリセットします。',
    '각 점 주변을 비교하는 반경으로 분석 영상의 창 너비는 2×반경+1입니다. 높을수록 주변 정보와 연산이 늘지만 다른 움직임이 섞일 수 있습니다. 낮을수록 국소적이고 가볍지만 잡음·약한 텍스처에 민감합니다. 궤적이 초기화됩니다.',
  ],
  threshold:[
    'Minimum local texture needed to accept a flow point. Higher: stricter, fewer weak/ambiguous points but less coverage. Lower: more points in smooth areas, with more unreliable-motion risk. Not detector confidence or IoU. Resets flow trails.',
    '一個點要有足夠的明暗紋理，才接受其運動估計。越大：越嚴格、較少模糊點，但有效取樣可能變少；越小：平滑區域也較容易通過，但錯誤運動風險增加。不是偵測信心或 IoU；修改會重設光流軌跡。',
    '点を採用する最低テクスチャ量。大きい：厳格で曖昧な点が減りますが観測範囲も減ります。小さい：平坦部の点も増えますが誤推定の危険が増えます。検出信頼度やIoUではありません。軌跡をリセットします。',
    '흐름 점을 채택하는 최소 텍스처입니다. 높을수록 엄격해 약한 점과 관측 범위가 줄어듭니다. 낮을수록 평탄한 영역의 점도 늘지만 오추정 위험이 커집니다. 검출 신뢰도나 IoU가 아니며 궤적이 초기화됩니다.',
  ],
} satisfies Record<string,Text>;
export type FlowHelpKey=keyof typeof help;
export const opticalFlowHelp=(language:Language,key:FlowHelpKey)=>help[key][indices[language]];
