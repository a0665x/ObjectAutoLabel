import type {Language} from '../types';
type Text=readonly[string,string,string,string];
const words={
  title:['Selected pixels','選取目標像素','選択対象の画素','선택 대상 픽셀'],
  hint:['Enable tracking overlays and click a box to inspect its pixels.','開啟追蹤資訊疊加，點選一個框後觀察其框內像素。','追跡情報をオンにして枠をクリックすると、枠内の画素を確認できます。','추적 표시를 켜고 상자를 클릭하여 내부 픽셀을 확인하세요.'],
  waiting:['Waiting for an observed selected box.','等待選中目標的實際偵測框。','選択対象の実際の検出枠を待機中。','선택 대상의 실제 검출 상자를 기다립니다.'],
  cacheExpired:['YOLO crop unavailable or expired. Resume and select a current box; the locked reference is retained.','YOLO 框內快取尚未取得或已過期。請繼續播放後重新選框；已鎖定樣本仍保留。','YOLO切り出しが未取得または期限切れです。再生して現在の枠を選択してください。固定参照は保持します。','YOLO 잘라내기가 없거나 만료되었습니다. 재생 후 현재 상자를 선택하세요. 고정 기준은 유지됩니다.'],
  locked:['Locked · YOLO before tracking','已鎖定 · YOLO 原始偵測（追蹤前）','固定済み · 追跡前のYOLO検出','고정됨 · 추적 전 YOLO 검출'],
  sync:['Waiting for synchronized frame metadata; the reference is retained.','等待與播放影格同步的框資料；固定樣本仍保留。','フレームと同期した枠情報を待機中。参照は保持しています。','프레임과 동기화된 상자 정보를 기다립니다. 기준은 유지됩니다.'],
  lost:['Target not observed. No predicted pixels sampled; comparisons still use the fixed reference.','目標目前未被觀測；不採樣預測框，其他候選仍與固定樣本比對。','対象は未観測です。予測枠は採取せず、固定参照と候補を比較します。','대상이 관측되지 않았습니다. 예측 상자는 채취하지 않고 고정 기준으로 후보를 비교합니다.'],
  crop:['Frame-matched crop','同幀框內影像','同一フレームの切り出し','동일 프레임 잘라내기'],
  estimatedCrop:['Search ROI · not YOLO sample','搜尋區域 · 非 YOLO 採樣','探索領域 · YOLO採取ではない','탐색 영역 · YOLO 샘플 아님'],
  contour:['Laplacian · original colors','Laplacian · 原色內輪廓','Laplacian · 元の色の輪郭','Laplacian · 원색 윤곽'],
  colors:['Color distribution','色域分佈','色の分布','색 분포'],
  edges:['Contour colors','內輪廓顏色分佈','輪郭の色分布','윤곽 색 분포'],
  selected:['Selected','選中目標','選択対象','선택 대상'],
  average:['Same-class mean','同類別框平均','同クラス枠の平均','동일 클래스 평균'],
  rank:['Appearance rank','外觀相似度排名','外観の類似順位','외관 유사도 순위'],
  comparisons:['Same-class comparison','同類別框比對','同クラス枠の比較','동일 클래스 비교'],
  score:['Similarity','相似度','類似度','유사도'],
  choose:['Select candidate','選取候選','候補を選択','후보 선택'],
  colorScore:['Color / contour','色彩／輪廓','色／輪郭','색 / 윤곽'],
  index:['Pixel sample index','像素採樣指標','画素サンプル指標','픽셀 샘플 지표'],
  resample:['Resample','重新採樣','再採取','다시 채취'],
  export:['Export sample JSON','匯出採樣 JSON','サンプルJSON出力','샘플 JSON 내보내기'],
  pixels:['Sampled / contour pixels','採樣／輪廓像素','採取／輪郭画素','샘플 / 윤곽 픽셀'],
  variance:['Laplacian variance','Laplacian 變異數','Laplacian 分散','Laplacian 분산'],
  analyzed:['Analyzed / same-class boxes','已分析／同類別框數','解析済み／同クラス枠数','분석 / 동일 클래스 상자'],
  limits:['All valid same-class YOLO crops (up to 80px); tiny crops excluded. Session RAM ring: 32 MiB / 180 frames, plus one locked sample. Preview up to 4/s. No disk writes. Image-only search never replaces the reference.','比對全部有效同類別 YOLO 框（最長邊 80px），略過過小框。工作階段記憶體快取上限 32 MiB／180 幀，另保留一份鎖定樣本；預覽每秒最多 4 次，不寫入磁碟。影像搜尋不會更新固定樣本。','有効な同クラスYOLO枠をすべて比較（最大辺80px）。極小枠は除外。RAM上限32 MiB／180フレームと固定参照1件。プレビュー毎秒最大4回。ディスク保存なし。画像探索で参照は更新しません。','유효한 동일 클래스 YOLO 상자를 모두 비교합니다(최대 변 80px). 작은 상자는 제외합니다. RAM 상한 32 MiB/180프레임과 고정 샘플 1개. 미리보기 초당 최대 4회, 디스크 저장 없음. 영상 탐색은 기준을 바꾸지 않습니다.'],
  help:['Clicking fixes an appearance reference. HSV histograms describe crop colors; a four-neighbor luminance Laplacian (|L| ≥ 20) selects interior contour pixels in their original RGB. Table similarity uses 80% color + 20% contour overlap, or color only without contour evidence. Optional Color-sample tracking uses color/spatial features to follow detections without IDs or search the image. Dashed red is an unconfirmed held box, not a detection. Lighting, background and similar clothing can cause wrong matches. The sample index is a non-unique descriptor checksum, not a person ID; JSON exports the fixed vectors.','點選後固定外觀樣本。HSV 直方圖描述框內顏色；四鄰域亮度 Laplacian（|L| ≥ 20）取出內部輪廓位置的原始 RGB。表格相似度使用 80% 色彩＋20% 輪廓重疊，缺乏輪廓時只比色彩。開啟「色彩採樣追蹤」後，使用色彩／空間特徵跟隨無 ID 偵測框，或直接搜尋影像。紅色虛線是未確認暫留框，不是偵測。光線、背景與相似衣色仍可能誤配；採樣指標不是人物 ID，JSON 可匯出固定特徵向量。','クリックで外観参照を固定します。HSVの色分布と輝度4近傍Laplacian（|L|≥20）の元のRGBを比較。表の類似度は色80%＋輪郭20%、輪郭がなければ色のみです。色サンプル追跡は色・空間特徴でIDなし検出や画像探索を追従します。赤い破線は未確認の保持位置です。照明・背景・似た服で誤対応する場合があります。指標は人物IDではなく、固定特徴はJSONに出力できます。','클릭하면 외관 기준을 고정합니다. HSV 색 분포와 휘도 4방향 Laplacian(|L|≥20)의 원래 RGB를 비교합니다. 표는 색 80%+윤곽 20%이며 윤곽이 없으면 색만 비교합니다. 색상 샘플 추적은 색·공간 특징으로 ID 없는 검출 또는 영상 탐색을 따릅니다. 빨간 점선은 미확인 유지 위치입니다. 조명·배경·유사 복장은 오매칭을 일으킬 수 있습니다. 지표는 인물 ID가 아니며 고정 벡터를 JSON으로 내보냅니다.'],
  error:['Pixel analysis unavailable. Resample to retry; detector playback is unaffected.','像素分析暫時無法使用，可重新採樣；偵測播放不受影響。','画素解析を利用できません。再採取してください。検出再生には影響しません。','픽셀 분석을 사용할 수 없습니다. 다시 채취하세요. 검출 재생에는 영향이 없습니다.'],
} satisfies Record<string,Text>;
const languages:Record<Language,number>={en:0,zh:1,ja:2,ko:3};
export const pixelText=(language:Language,key:keyof typeof words)=>words[key][languages[language]];
const colors=[
  ['Red','紅','赤','빨강'],['Orange','橘','橙','주황'],['Yellow','黃','黄','노랑'],['Lime','黃綠','黄緑','연두'],['Green','綠','緑','초록'],['Mint','青綠','青緑','민트'],['Cyan','青','シアン','청록'],['Azure','天藍','空色','하늘'],['Blue','藍','青','파랑'],['Violet','紫','紫','보라'],['Magenta','洋紅','赤紫','자홍'],['Rose','粉紅','桃色','분홍'],['Black','黑','黒','검정'],['Gray','灰','灰','회색'],['White','白','白','흰색'],
] satisfies Text[];
export const pixelColorName=(language:Language,index:number)=>colors[index]?.[languages[language]]??'';
export const pixelColor=(index:number)=>index<12?`hsl(${index*30} 75% 50%)`:['#171717','#888888','#f5f5f5'][index-12];
const tracking={
  title:['Color-sample tracking','色彩採樣追蹤','色サンプル追跡','색상 샘플 추적'],
  hint:['Click any observed box, even without a tracking ID. Matches same-class detections or searches the image. Dashed red means uncertain/held, not confirmed.','可點選實測框，不必有追蹤 ID。比對同類別偵測，或直接搜尋影像；紅色虛線代表搜尋／位置暫留，不是確認找到。','追跡IDのない観測枠も選択可能です。同クラスの検出または画像を探索します。赤い破線は未確認の保持位置です。','추적 ID가 없는 관측 상자도 선택할 수 있습니다. 동일 클래스 검출 또는 영상을 탐색합니다. 빨간 점선은 미확인 유지 위치입니다.'],
  detection:['Color match · detected','色彩配對 · 偵測框','色一致 · 検出','색상 일치 · 검출'],
  search:['Appearance search · not detector','外觀搜尋 · 非模型偵測','外観探索 · 検出ではない','외관 탐색 · 검출 아님'],
  hold:['Searching · unconfirmed','搜尋中 · 未確認','探索中 · 未確認','탐색 중 · 미확인'],
  pick:['Sample box','採樣此框','この枠を採取','상자 채취'],
} satisfies Record<string,Text>;
export const pixelTrackingText=(language:Language,key:keyof typeof tracking)=>tracking[key][languages[language]];
