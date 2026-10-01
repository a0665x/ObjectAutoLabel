import type { Language } from '../types';

// Keep runtime keys stable; translate presentation independently of the API.
type Text = readonly [string, string, string, string];
const words = {
  parameterDetails: ['Details & trade-offs','參數詳情與取捨','詳細とトレードオフ','세부 정보 및 장단점'],
  parameters: ['Algorithm parameters','演算法參數','アルゴリズム設定','알고리즘 매개변수'],
  title: ['Tracking · motion / topology','追蹤 · 運動／拓撲','追跡 · 動き／トポロジー','추적 · 움직임 / 토폴로지'],
  intro: ['Stop playback to change tracking parameters. Visualization can be changed while playing.','停止播放後可調整追蹤參數；視覺化可在播放中切換。','追跡パラメータの変更は再生停止後に行います。表示は再生中も切り替えられます。','추적 매개변수는 재생을 중지한 후 변경하세요. 시각화는 재생 중에도 전환할 수 있습니다.'],
  group: ['Parameter group','參數群組','パラメータグループ','매개변수 그룹'],
  motion: ['Kalman motion','Kalman 運動估計','Kalman 運動推定','Kalman 움직임 추정'],
  identity: ['Identity / topology','目標識別／拓撲','ID／トポロジー','ID / 토폴로지'],
  bridge: ['Predictive bridge','短暫缺測預測','一時的な欠測の予測','일시적 누락 예측'],
  reset: ['Reset defaults','恢復預設','既定値に戻す','기본값 복원'],
  resetDone: ['Default settings restored.','已恢復預設值。','既定値に戻しました。','기본값을 복원했습니다.'],
  export: ['Export tracking settings','匯出追蹤設定','追跡設定をエクスポート','추적 설정 내보내기'],
  loadError: ['Unable to load tracking settings.','無法載入追蹤設定。','追跡設定を読み込めません。','추적 설정을 불러올 수 없습니다.'],
  viz: ['Visualization','視覺化','可視化','시각화'],
  trails: ['Kalman trails · up to 2 seconds','Kalman 軌跡 · 最長 2 秒','Kalman 軌跡 · 最大2秒','Kalman 궤적 · 최대 2초'],
  prediction: ['Prediction · boxes / velocity / uncertainty','預測 · 框／速度／不確定性','予測 · 枠／速度／不確かさ','예측 · 상자 / 속도 / 불확실성'],
  topology: ['Topology · neighbor links','拓撲 · 鄰近物件連線','トポロジー · 近傍リンク','토폴로지 · 이웃 연결'],
  diagnostics: ['Diagnostics · IDs / timing / matching','診斷 · ID／時間／配對','診断 · ID／時間／対応付け','진단 · ID / 시간 / 매칭'],
  legend: ['Cyan: motion. Purple: neighbor links. Dashed red: predicted, not detected. Detailed overlays show up to 40 objects plus the selected target.','青色：運動估計。紫色：鄰近連線。紅色虛線：預測而非偵測。最多顯示 40 個物件及選中目標的詳細資訊。','水色：動き。紫：近傍リンク。赤の破線：検出ではなく予測。詳細表示は最大40個と選択対象です。','청록: 움직임. 보라: 이웃 연결. 빨간 점선: 검출이 아닌 예측. 상세 표시는 최대 40개 객체와 선택 대상입니다.'],
  dt: ['Frame interval','影格間隔','フレーム間隔','프레임 간격'],
  horizon: ['Prediction limit','預測上限','予測上限','예측 한도'],
  confirm: ['Confirmation','連續確認','連続確認','연속 확인'],
  frames: ['frames','幀','フレーム','프레임'],
  enable: ['Enable tracking · click a box to follow','啟用追蹤 · 點框選取目標','追跡を有効化 · 枠をクリックして選択','추적 활성화 · 상자를 클릭하여 선택'],
  selected: ['Selected','已選取','選択中','선택됨'],
  selectHint: ['Click a tracked box to select it','點擊追蹤框以選取目標','追跡枠をクリックして選択','추적 상자를 클릭하여 선택'],
  clear: ['Clear target','取消選取','選択を解除','선택 해제'],
  track: ['Track','追蹤','追跡','추적'],
  objects: ['Tracked objects','追蹤物件','追跡対象','추적 객체'],
  lost: ['Target lost — waiting','目標遺失，等待恢復','対象を見失いました · 待機中','대상을 놓쳤습니다 · 대기 중'],
  raw: ['raw','原始','元ID','원본'],
  warmup: ['warmup','初始化','初期化中','초기화 중'],
  score: ['Score','分數','スコア','점수'],
  margin: ['margin','分差','得点差','점수 차이'],
  evidence: ['evidence','證據量','証拠量','근거량'],
  innovation: ['innovation','預測殘差','予測残差','예측 잔차'],
  age: ['age','缺測時間','欠測時間','누락 시간'],
  misses: ['misses','缺測幀數','欠測フレーム','누락 프레임'],
  lowEvidence: ['low evidence','證據不足','証拠不足','근거 부족'],
  rejected: ['motion gate rejected','超出運動門檻','運動閾値を超過','움직임 임계값 초과'],
  pending: ['Waiting for confirmation','等待確認','確認待ち','확인 대기'],
  trackingActive: ['Tracking','追蹤中','追跡中','추적 중'],
  noCandidate: ['No matching candidate','沒有相符候選','対応候補なし','일치 후보 없음'],
  belowThreshold: ['Score below threshold','分數未達門檻','スコアが閾値未満','점수가 임계값 미만'],
  ambiguous: ['Candidates are too similar','候選分數過於接近','候補の得点差が不足','후보 점수 차이가 부족함'],
  referenceExpired: ['Identity reference expired','識別參考已過期','ID参照が期限切れ','ID 참조 만료'],
  stabilizerOff: ['Identity recovery disabled','未啟用識別恢復','ID復元は無効','ID 복구 비활성화'],
  seekReset: ['Seeking resets tracking and clears the selected target.','跳轉時間會重設追蹤並清除選中目標。','シークすると追跡と選択対象をリセットします。','시간을 이동하면 추적과 선택 대상을 초기화합니다.'],
  direct: ['Matched','已配對','対応済み','매칭됨'],
  reassociated: ['Reassociated','已重新關聯','再関連付け済み','재연결됨'],
  selectionExpired: ['Selection expired; select again','選取影格已過期，請重新選取','選択フレームが期限切れです。再選択してください','선택 프레임이 만료되었습니다. 다시 선택하세요'],
  ellipse: ['Ellipse: Kalman 2σ uncertainty, not an accuracy guarantee.','橢圓：Kalman 2σ 不確定性，不代表準確率保證。','楕円：Kalman 2σ の不確かさ。精度の保証ではありません。','타원: Kalman 2σ 불확실성으로, 정확도를 보장하지 않습니다.'],
  schema: ['Label schema','標籤類別設定','ラベルスキーマ','라벨 스키마'],
  auto: ['Auto · current project','自動 · 目前專案','自動 · 現在のプロジェクト','자동 · 현재 프로젝트'],
  native: ['Model native labels','模型原生類別名稱','モデル内のラベル','모델 기본 라벨'],
  schemaHint: ['Names map by class ID; they do not change model predictions. Confirm that the ID order matches the model.','名稱依 class ID 對應，不改變模型預測；請確認 ID 順序與模型一致。','名前はクラスIDで対応付けます。予測は変更しません。ID順序がモデルと一致することを確認してください。','이름은 클래스 ID로 매핑되며 예측은 변경하지 않습니다. ID 순서가 모델과 같은지 확인하세요.'],
  schemaAmbiguous: ['Multiple project schemas found. Select one explicitly; Auto currently uses model labels.','本專案有多份類別設定，請明確選擇；自動模式目前使用模型名稱。','複数のスキーマがあります。明示的に選択してください。現在の自動モードはモデル名を使用します。','프로젝트에 여러 스키마가 있습니다. 직접 선택하세요. 현재 자동 모드는 모델 라벨을 사용합니다.'],
  schemaNone: ['No project schema; using model labels.','專案尚無類別設定，使用模型名稱。','プロジェクトのスキーマがないためモデル名を使用します。','프로젝트 스키마가 없어 모델 라벨을 사용합니다.'],
  schemaError: ['Unable to load project schemas. Refresh or select model native labels.','無法載入專案類別設定，請重新整理或選擇模型原生名稱。','スキーマを読み込めません。更新するかモデル内のラベルを選択してください。','스키마를 불러올 수 없습니다. 새로고침하거나 모델 기본 라벨을 선택하세요.'],
} satisfies Record<string, Text>;

const help = {
  AI_TRACK_MINIMUM_MATCHING_THRESHOLD: ['Higher: accepts weaker matches, fewer ID breaks but more wrong matches. Lower: stricter matching, more ID breaks.','越大：容許較弱配對，ID 較連續但更易誤配。越小：配對較嚴格，但 ID 較易中斷。','大きい：弱い対応も許可しIDは続きやすいが誤対応が増えます。小さい：厳格ですがIDが途切れやすくなります。','높을수록 약한 매칭도 허용하여 ID 단절은 줄지만 오매칭이 늘어납니다. 낮을수록 엄격하지만 ID가 끊기기 쉽습니다.'],
  TRACK_MOTION_KALMAN_ENABLE: ['On: estimate motion for prediction. Off: missing targets can only use a static hold.','開：估計運動以預測位置。關：缺測時只能暫時保留原位置。','オン：動きを推定して予測。オフ：欠測時は元の位置を保持するだけです。','켜짐: 움직임을 추정하여 예측합니다. 꺼짐: 누락 시 마지막 위치만 유지합니다.'],
  TRACK_MOTION_MAX_PREDICTION_MS: ['Higher: predicts longer, with more drift risk. Lower: stops sooner. Also limited by bridge lifetime.','越大：預測維持較久，但漂移風險較高。越小：較早停止；同時受缺測預測期限限制。','大きい：長く予測しますがずれやすくなります。小さい：早く停止します。欠測保持期限でも制限されます。','높을수록 오래 예측하지만 드리프트 위험이 커집니다. 낮을수록 빨리 중지합니다. 누락 유지 시간으로도 제한됩니다.'],
  TRACKING_ID_STABILIZER_ENABLE: ['On: recover the selected identity using motion and neighbors. Off: follow only the original raw ID.','開：用運動與鄰居關係恢復選中目標。關：僅跟隨原始 ID。','オン：動きと近傍関係で選択IDを復元。オフ：元のIDのみ追跡します。','켜짐: 움직임과 이웃 관계로 선택 ID를 복구합니다. 꺼짐: 원래 ID만 추적합니다.'],
  TRACKING_ID_DIRECT_MAX_INNOVATION_NORM: ['Higher: tolerates larger position jumps, but may accept ID swaps. Lower: rejects jumps sooner, but may interrupt valid motion. Distance uses normalized image coordinates.','越大：容忍更大位置跳動，但可能接受 ID 誤換。越小：較早拒絕跳動，也較容易中斷正常移動。距離使用正規化影像座標。','大きい：大きな位置変化を許容しますがID入替を見逃す場合があります。小さい：早く拒否しますが正常な動きも中断しやすくなります。距離は正規化座標です。','높을수록 큰 위치 변화도 허용하지만 ID 바뀜을 놓칠 수 있습니다. 낮을수록 빨리 거부하지만 정상 움직임도 중단할 수 있습니다. 거리는 정규화 좌표입니다.'],
  TRACKING_ID_STABILIZER_MAX_ANCHORS: ['Higher: more neighbor evidence and computation, but more noise. Lower: fewer noisy neighbors, but less identifying evidence. Zero disables neighbor evidence.','越大：鄰居證據與計算量增加，也可能增加雜訊。越小：較少雜訊，但辨識證據較少。0 表示不用鄰居證據。','大きい：近傍の証拠と計算量が増えますがノイズも増えます。小さい：ノイズと識別情報が減ります。0は近傍証拠なしです。','높을수록 이웃 근거와 연산량이 늘지만 잡음도 증가합니다. 낮을수록 잡음과 식별 근거가 줄어듭니다. 0은 이웃 근거를 사용하지 않습니다.'],
  TRACKING_ID_STABILIZER_ANCHOR_RADIUS_NORM: ['Higher: includes farther neighbors, potentially more unrelated motion. Lower: local neighbors only, potentially too few anchors.','越大：納入更遠鄰居，也可能混入無關運動。越小：只看近鄰，但可能沒有足夠參考點。','大きい：遠い近傍も含み、無関係な動きが混ざる場合があります。小さい：近い対象のみですが参照点が不足しやすくなります。','높을수록 먼 이웃까지 포함하여 무관한 움직임이 섞일 수 있습니다. 낮을수록 가까운 이웃만 사용하지만 기준점이 부족할 수 있습니다.'],
  TRACKING_ID_STABILIZER_MATCH_THRESHOLD: ['Higher: requires stronger recovery evidence, fewer wrong locks but more missed recoveries. Lower: easier recovery, more wrong-lock risk.','越大：恢復要求更高，較少誤鎖但較難救回。越小：較易救回，也較易誤鎖。','大きい：復元条件が厳しく誤選択は減りますが復元しにくくなります。小さい：復元しやすい反面、誤選択が増えます。','높을수록 복구 조건이 엄격하여 오선택은 줄지만 복구가 어려워집니다. 낮을수록 복구는 쉽지만 오선택 위험이 증가합니다.'],
  TRACKING_ID_STABILIZER_MATCH_MARGIN: ['Higher: the best candidate must stand out more; safer but more waiting. Lower: accepts closer contests; faster but more ambiguous.','越大：第一名必須明顯領先，較保守但等待較久。越小：分數接近也可通過，較快但更易選錯。','大きい：1位に明確な差が必要で安全側ですが待ち時間が増えます。小さい：僅差でも通過し、速い反面あいまいになります。','높을수록 1위 후보가 확실히 앞서야 하므로 보수적이지만 대기가 늘어납니다. 낮을수록 근소한 차이도 허용하여 빠르지만 모호해집니다.'],
  TRACKING_ID_STABILIZER_CONFIRM_FRAMES: ['Higher: more consecutive evidence, slower recovery and less flicker. Lower: faster recovery, more accidental switches. Time depends on FPS.','越大：需更多連續證據，恢復較慢但較抗閃爍。越小：恢復較快但較易誤切換；實際等待時間取決於 FPS。','大きい：連続証拠が増え、復元は遅くなりますがちらつきに強くなります。小さい：速い反面、誤切替が増えます。時間はFPSに依存します。','높을수록 연속 근거가 더 필요하여 복구는 느리지만 깜빡임에 강합니다. 낮을수록 빠르지만 잘못 전환할 수 있습니다. 시간은 FPS에 따라 달라집니다.'],
  TRACKING_ID_STABILIZER_LOW_EVIDENCE_CONFIRM_FRAMES: ['Higher: waits longer when motion or neighbor evidence is missing. Lower: faster sparse-scene recovery, but higher wrong-lock risk.','越大：運動或鄰居證據不足時等待更久。越小：稀疏場景恢復較快，但誤鎖風險增加。','大きい：動きや近傍の証拠不足時に長く待ちます。小さい：疎な場面で速く復元しますが誤選択の危険が増えます。','높을수록 움직임이나 이웃 근거가 부족할 때 더 오래 기다립니다. 낮을수록 희소 장면에서 빠르게 복구하지만 오선택 위험이 증가합니다.'],
  TRACKING_ID_STABILIZER_REACQUIRE_BLEND_FRAMES: ['Higher: recovered box moves back more smoothly but lags longer. Lower: catches up faster but may jump.','越大：恢復框的移動較平滑，但延遲較久。越小：較快跟上，但可能跳動。','大きい：復元枠が滑らかに戻りますが遅れが増えます。小さい：早く追いつきますが跳ねる場合があります。','높을수록 복구 상자가 부드럽게 이동하지만 지연이 늘어납니다. 낮을수록 빨리 따라잡지만 튈 수 있습니다.'],
  TRACKING_ID_STABILIZER_MAX_AGE_MS: ['Higher: remembers identity longer through occlusion, but may reuse stale evidence. Lower: forgets sooner, reducing stale matches but losing recovery opportunities.','越大：遮擋後保留識別較久，但可能沿用過時證據。越小：較早放棄，減少過時配對但降低救回機會。','大きい：遮蔽後も長く記憶しますが古い証拠を再利用する危険があります。小さい：早く忘れ、古い対応と復元機会が減ります。','높을수록 가림 후 ID를 오래 기억하지만 오래된 근거를 사용할 수 있습니다. 낮을수록 빨리 잊어 잘못된 연결과 복구 기회가 줄어듭니다.'],
  TRACKING_BRIDGE_ENABLE: ['On: briefly show a predicted box during missing detections. Off: hide the target immediately when missing.','開：短暫缺測時顯示預測框。關：缺測立即隱藏目標框。','オン：一時的な欠測中に予測枠を表示。オフ：欠測時にすぐ非表示にします。','켜짐: 일시적 누락 중 예측 상자를 표시합니다. 꺼짐: 누락 시 즉시 숨깁니다.'],
  TRACKING_BRIDGE_TTL_MS: ['Higher: keeps missing-target predictions longer, with more stale-position risk. Lower: stops sooner, with more interruptions. The time or frame limit reached first wins.','越大：缺測預測維持較久，但過時位置風險較高。越小：較早停止，較容易中斷。時間與幀數限制以先到者為準。','大きい：欠測予測を長く保持しますが古い位置の危険が増えます。小さい：早く停止し中断が増えます。時間とフレーム数の先に達した制限を使います。','높을수록 누락 예측을 오래 유지하지만 오래된 위치 위험이 증가합니다. 낮을수록 빨리 멈추며 중단이 늘어납니다. 시간과 프레임 한도 중 먼저 도달한 것이 적용됩니다.'],
  TRACKING_BRIDGE_MAX_MISSES: ['Higher: tolerates more missing frames. Lower: stops after fewer misses. Also limited by elapsed time; the same count lasts less time at higher FPS.','越大：容許更多缺測幀。越小：較少缺測就停止；也受時間期限限制，相同幀數在高 FPS 下時間較短。','大きい：欠測フレームを多く許容。小さい：少ない欠測で停止。時間制限も適用され、同じフレーム数でも高FPSでは短時間です。','높을수록 더 많은 누락 프레임을 허용합니다. 낮을수록 일찍 멈춥니다. 시간 제한도 적용되며 같은 프레임 수라도 FPS가 높으면 더 짧습니다.'],
  TRACKING_BRIDGE_CONF_DECAY: ['Higher: displayed prediction confidence fades more slowly. Lower: fades faster. Does not extend prediction lifetime.','越大：預測框顯示信心下降較慢。越小：下降較快；不會延長預測期限。','大きい：予測の表示信頼度がゆっくり下がります。小さい：速く下がります。予測期限は延びません。','높을수록 표시되는 예측 신뢰도가 천천히 감소합니다. 낮을수록 빨리 감소합니다. 예측 수명은 늘어나지 않습니다.'],
} satisfies Record<string, Text>;

const index: Record<Language, number> = {en:0,zh:1,ja:2,ko:3};
const parameterNames: Record<string, Text> = {
  AI_TRACK_MINIMUM_MATCHING_THRESHOLD: ["Matching tolerance","配對容忍度","対応の許容度","매칭 허용도"],
  TRACK_MOTION_KALMAN_ENABLE: ["Kalman motion estimation","Kalman 運動估計","Kalman 動き推定","Kalman 움직임 추정"],
  TRACK_MOTION_MAX_PREDICTION_MS: ["Maximum prediction (ms)","最長預測時間（ms）","最大予測時間（ms）","최대 예측 시간 (ms)"],
  TRACKING_ID_STABILIZER_ENABLE: ["Recover selected identity","恢復選中目標 ID","選択IDの復元","선택 ID 복구"],
  TRACKING_ID_DIRECT_MAX_INNOVATION_NORM: ["Position jump tolerance","位置跳動容忍度","位置変化の許容度","위치 변화 허용도"],
  TRACKING_ID_STABILIZER_MAX_ANCHORS: ["Maximum neighbors","最多鄰近物件數","最大近傍数","최대 이웃 수"],
  TRACKING_ID_STABILIZER_ANCHOR_RADIUS_NORM: ["Neighbor search radius","鄰近物件搜尋半徑","近傍探索半径","이웃 검색 반경"],
  TRACKING_ID_STABILIZER_MATCH_THRESHOLD: ["Recovery score threshold","恢復配對分數門檻","復元スコア閾値","복구 점수 임계값"],
  TRACKING_ID_STABILIZER_MATCH_MARGIN: ["Candidate score gap","候選分數差距","候補スコア差","후보 점수 차이"],
  TRACKING_ID_STABILIZER_CONFIRM_FRAMES: ["Confirmation frames","連續確認幀數","連続確認フレーム数","연속 확인 프레임"],
  TRACKING_ID_STABILIZER_LOW_EVIDENCE_CONFIRM_FRAMES: ["Low-evidence confirmation","證據不足時的確認幀數","証拠不足時の確認フレーム","근거 부족 시 확인 프레임"],
  TRACKING_ID_STABILIZER_REACQUIRE_BLEND_FRAMES: ["Recovery smoothing frames","恢復平滑幀數","復元平滑化フレーム","복구 평활화 프레임"],
  TRACKING_ID_STABILIZER_MAX_AGE_MS: ["Identity memory (ms)","識別保留時間（ms）","ID保持時間（ms）","ID 유지 시간 (ms)"],
  TRACKING_BRIDGE_ENABLE: ["Predict during missed detections","缺測時顯示預測框","欠測時の予測枠表示","누락 시 예측 상자 표시"],
  TRACKING_BRIDGE_TTL_MS: ["Prediction lifetime (ms)","缺測預測期限（ms）","欠測予測の期限（ms）","누락 예측 수명 (ms)"],
  TRACKING_BRIDGE_MAX_MISSES: ["Maximum missed frames","最多缺測幀數","最大欠測フレーム数","최대 누락 프레임"],
  TRACKING_BRIDGE_CONF_DECAY: ["Confidence retention","信心保留比例","信頼度の保持率","신뢰도 유지 비율"],
};
export function trackingParameterName(language:Language,key:string) {return parameterNames[key]?.[index[language]]??key;}
export type TrackingTextKey = keyof typeof words;
export function trackingText(language:Language,key:TrackingTextKey) {return words[key][index[language]];}
export function trackingHelp(language:Language,key:string) {return help[key as keyof typeof help]?.[index[language]];}
export function trackingState(language:Language,state?:string) {
  const keys:Record<string,TrackingTextKey>={direct:'direct',pending:'pending',reassociated:'reassociated',lost:'lost',bridge:'bridge',selection_expired:'selectionExpired'};
  return trackingText(language,keys[state??'']??'pending');
}
export function trackingReason(language:Language,reason?:string) {
  const keys:Record<string,TrackingTextKey>={no_candidate:'noCandidate',score_below_threshold:'belowThreshold',candidate_margin_too_small:'ambiguous',reference_expired:'referenceExpired',stabilizer_disabled:'stabilizerOff'};
  return keys[reason??'']?trackingText(language,keys[reason!]):'';
}
