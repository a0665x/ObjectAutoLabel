# 0629 Dual World-Model Training Acceptance

Date: 2026-08-31. This report retains production evidence for the two
independent project packages. It does not delete, rename, retrain, or otherwise
mutate any acceptance artifact. Historical failed, `rect=true`, AMP, and
invalid-metric runs remain audit records; only the explicit FP32
`rect=false`, `amp=false` runs below are accepted.

## Environment

- Deployed image after the final security/offline-runtime rebuild:
  `sha256:066c73da022ed15b7a5a6cecf890405e67cb49c04fe0a17e88738e7dd328d46f`.
- Jetson service: `object-autolabel`, `running`, restart count `0`; Uvicorn
  binds `10.42.0.21:8501` with the localhost proxy retained for Tailscale.
- Fresh local and private HTTPS health both returned
  `{"ok":true,"project_root":"/app"}` at
  `http://127.0.0.1:8501/api/health` and
  `https://ubuntu.tail9e662c.ts.net:8501/api/health`.
- Container runtime: PyTorch `2.8.0a0+5228986c39.nv25.06`, CUDA `12.9`,
  `torch.cuda.is_available()=True`, device `Orin`. Host `MemAvailable` during
  the final audit was `12,937,224 kB`.
- `GET /api/models/world` reported supported `yolov8s-worldv2.pt`
  (`yolo-world-v2`, detect, bbox) and `yoloe-26n-seg.pt` (`yoloe-26`,
  segment-to-bbox). `GET /api/models/input` included the selected
  `yolov8n_pretrain_8020.pt`.
- A network-blocked container smoke loaded the retained World v2 S and
  YOLOE-26 checkpoints on Orin. It verified both
  `/root/.cache/clip/ViT-B-32.pt` and
  `/app/weights/clip/ViT-B-32.pt` resolve to the retained encoder rather
  than initiating a download.
- Dependency audit: the runtime requirements were changed earlier in the
  acceptance work from `ultralytics==8.3.78` to `ultralytics==8.4.130` for
  both desktop and Jetson. The retained image was therefore tested with
  `8.4.130`; the final documentation commit did not make another requirements
  change.

### Final-scope ledger

Task 7's named report/testing/operations deliverables were expanded only where
needed to make launch and runtime guidance coherent for a new operator:
`README.md`, `spec/RUNTIME.md`, and `spec/STATUS.md` now carry the matching
startup, bind-host, Tailscale, and final-runtime facts. During the final
deployed 375px acceptance check, a previously unobserved long active-project
title caused `scrollWidth=596`; the scoped CSS/test correction was made
test-first and is part of this acceptance evidence, not unrelated UI work.

## Responsive Browser Results

The deployed HTTPS WebUI was reloaded after the final image rebuild with
`acceptance_0629_worldv2s_20260830_v001` active. Its current assets are
`index-BaiDaYfR.js` and `index-CaZ5vu8V.css`; the active-project heading has
computed `overflow-wrap:anywhere`.

Task 3 previously exercised Projects, Sources, Pseudo Label, Split, Train,
Validate, and Review at all required widths. This final deployment rechecked
Review with a real 0629 source and the long active-project name:

| CSS viewport | document scrollWidth | toolbar primary row | Fit / Save / Save & next |
| ---: | ---: | --- | --- |
| 375 | 360 | column | 44 / 44 / 44 px |
| 768 | 753 | column | 44 / 44 / 44 px |
| 851 | 836 | column | 44 / 44 / 44 px |
| 1024 | 1009 | row | 44 / 44 / 44 px |
| 1440 | 1425 | row | 44 / 44 / 44 px |

At 1440px, Save measured `88.078125px` and Save & next `143.765625px` in a
`737px` toolbar, confirming intrinsic desktop actions. At 375px, Select,
Draw, Pan, Fit, Save, and Save & next were all present. A final browser audit
found and fixed the previously missed long-title overflow: before the fix a
375px desktop-mode header had document `scrollWidth=596`; after the deployed
fix it is `360 <= 375`. Task 3's real-image gesture evidence remains retained:
zoomed blank-canvas pan changed `scrollLeft` from `0` to `43.64px`, a box move
changed SVG coordinates, and right-click opened the pointer-adjacent menu.

## Isolated Project and Source

Raw `data/input/0629` contains exactly 190 PNG files. Each retained project
has one ready source, 190 image rows, one `person-car-aerial-v1` schema, and
15 descriptors; no source or artifact is shared between project packages.

| Lineage | Project id | Source id | Schema id | Source/image/schema/descriptor counts |
| --- | --- | --- | --- | --- |
| World v2 S | `53e8bc676e6d44549d9ebf222122b25b` | `e4282ef5bc134b9688f6baaae5779373` | `5e0557ac0ce84fdb992005494712cbb5` | 1 / 190 / 1 / 15 |
| YOLOE-26 Nano | `0494fb5f53024fc7be9cb502ebd98922` | `c2eb334445a9453ca5cd05ad9ec313c1` | `8a430750de4a4042ab60f3d564f74341` | 1 / 190 / 1 / 15 |

The project names are `acceptance_0629_worldv2s_20260830_v001` and
`acceptance_0629_yoloe26n_20260830_v001`; their slugs own separate source,
split, and `output_model/runs` directories.

## YOLO-World v2 S Pseudo and Split

- Pseudo job/run: `1c5894e70ef04b2dbd2005840b36a39b` →
  `1536ca78ac174422b4f97bbb04eb9886`, named
  `Pseudo_0629_WORLDV2S_v001`.
- Settings: `yolov8s-worldv2.pt`, confidence `0.10`, IoU `0.70`, merge off.
  The persisted result is 190 images, 190 labeled, 12,606 raw detections, and
  0 merged detections.
- Split job/run: `42af628242494c5b9cbf739755bec116` →
  `7295c50357064c71ab47dc0fe4866a57`, named
  `Split_0629_WORLDV2S_801010_v001`, with pseudo lineage set to that run.
- The project-local `dataset.yaml` exists and maps `0: person`, `1: car`.
  Fresh filesystem audit: train 152 images/152 labels, valid 19/19, test
  19/19; persisted id buckets are 152/19/19.

## YOLOE-26 Nano Pseudo and Split

- Pseudo job/run: `acf62d32703f44f9866d81f8b8805c1a` →
  `a1a34a1fce6945c3b8d2017c1668e6d7`, named
  `Pseudo_0629_YOLOE26N_v001`.
- Settings: `yoloe-26n-seg.pt`, confidence `0.10`, IoU `0.70`, merge off.
  The persisted result is 190 images, 190 labeled, 8,913 raw detections, and
  0 merged detections.
- Split job/run: `b80367c252bf4aed80904a027bc6d80e` →
  `3e96113a220b442cbfa83aeab08a32da`, named
  `Split_0629_YOLOE26N_801010_v001`, with pseudo lineage set to that run.
- The project-local `dataset.yaml` exists and maps `0: person`, `1: car`.
  Fresh filesystem audit: train 152 images/152 labels, valid 19/19, test
  19/19; persisted id buckets are 152/19/19.

## YOLO-World v2 Training and Validation

- Accepted job/run: `b9d519583e124d0eb01237bfb89c0a61` →
  `d79f54d94b534487a1792accb37d63aa`, named
  `Train_0629_WORLDV2S_yolov8npre8020_e001_v002_ampfalse`.
- `args.yaml` and the persisted run agree on
  `/app/input_model/yolov8n_pretrain_8020.pt`, epochs 1, image size 640,
  batch 8, device `'0'`, SGD, `lr0=0.01`, `lrf=0.01`, `rect=false`, and
  `amp=false`. Status is `completed` with exactly one metric object at epoch
  1/1: box/cls/DFL `1.7352953 / 1.9516488 / 0.9117070`, precision `0.4121124`,
  recall `0.2277601`, mAP50 `0.2274700`, mAP50-95 `0.1645304`.
- Retained own-best validation used
  `Qwen2509_bglock_sparseA_00015_.png` (`1392×752`), the project schema, and
  `train-6/weights/best.pt`; it returned the image overlay and 18 boxes
  (5 car, 13 person), without inference error.

## YOLOE-26 Training and Validation

- Accepted job/run: `f1036d2e821449b8af132dad80ff877f` →
  `12757c2ae7e24b5eb9b66ff3c137343b`, named
  `Train_0629_YOLOE26N_yolov8npre8020_e001_v002_ampfalse`.
- `args.yaml` and the persisted run agree on the same selected input and
  parameters: one epoch, 640, batch 8, device `'0'`, SGD, `lr0=lrf=0.01`,
  `rect=false`, and `amp=false`. Status is `completed` with exactly one epoch
  1/1 metric object: box/cls/DFL `1.6584333 / 1.8622251 / 0.8690267`,
  precision `0.3370057`, recall `0.4700288`, mAP50 `0.3840285`, mAP50-95
  `0.2866290`.
- Retained own-best validation used the same recorded 0629 image and schema
  with `train-3/weights/best.pt`; it returned the image overlay and 16 boxes
  (5 car, 11 person), without inference error.

## CUDA, Memory, and Container Health

The final accepted FP32 runs had finite gradients at both optimizer
opportunities, `found_inf=0`, `optimizer_step_called=true`, stable scale 1.0,
and two EMA updates. Their checkpoint audit differs from the input in 294/355
tensors, including 156 non-head/non-buffer trainable tensors; World and YOLOE
also differ from one another in 293/355 tensors. This is the acceptance gate
that the historical AMP attempts did not satisfy. No CUDA OOM, automatic batch
reduction, CPU fallback, or container restart was observed for the accepted
jobs. The immediate post-rebuild proxy connection-refused/Tailscale 502 was a
transient readiness race while Uvicorn was still binding, not a service
failure: the 15-second retry returned healthy local and HTTPS responses and
the container remained at restart count 0.

## Artifact SHA-256 and Sizes

All values below were freshly calculated with `stat -c '%s'` and `sha256sum`.

| Artifact | Size (bytes) | SHA-256 |
| --- | ---: | --- |
| `input_model/yolov8n_pretrain_8020.pt` | 6,224,931 | `388ebbf3829e9571c054f4fad4d8f6c85e51d2a9c3e40b57f8c87bfa42330d20` |
| `world_model/yolov8s-worldv2.pt` | 25,923,032 | `9b2c17ab6124a913e9b3a5c170617920d91b0f01111a8479da69f00e2cf27792` |
| `world_model/yoloe-26n-seg.pt` | 11,710,443 | `1741c1f8da3cea47e2c01829c334a50dc0b9bbd05e685b90a3ce84fae32c8c1b` |
| `world_model/mobileclip2_b.ts` | 253,794,476 | `35d7f213e4d75f38514e4656ad3cb91158bd33e3805d8ac349f23b186f66982f` |
| `world_model/ViT-B-32.pt` | 353,976,522 | `40d365715913c9da98579312b702a82c18be219cc2a73407c4526f58eba950af` |
| World `train-6/weights/best.pt` | 6,220,138 | `c49a3198a519fafbe3ce0d767b0d8d9b5c96b8bdd514ca602b65c5208252b4ff` |
| World `train-6/weights/last.pt` | 6,220,138 | `30a39b3e3bc87e8020b34e46ff072e14e853eae45bf9745da38d8e00720a27f9` |
| YOLOE `train-3/weights/best.pt` | 6,220,138 | `7116f3869f4e7f762034f02190788ce94bef77857ece9137799d6967259d50f7` |
| YOLOE `train-3/weights/last.pt` | 6,220,138 | `9a9ab8de5598070d3623e0d8e02058a9f229d7fd2cd3ae3e122d2a1d94cb7c7b` |

## Final Verdict

PASS. The two retained project packages satisfy the isolation, source,
pseudo-label, split, CUDA, FP32 optimizer-step, one-epoch metric, artifact,
own-best validation, responsive deployment, local health, and Tailscale HTTPS
acceptance gates. The final integrated source checks are `pytest -q`
(199 collected and passed), frontend Vitest (14 files, 113 tests), Vite
production build (1,596 modules), shell syntax, and clean whitespace check.
The final documentation-only update did not alter requirements; the earlier
acceptance change from Ultralytics `8.3.78` to `8.4.130` is recorded above
and in the runtime guide.
