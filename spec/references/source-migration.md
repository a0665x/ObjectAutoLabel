# Source Migration Notes

The source project was documented in `../Auto label 技術文件.pdf` and implemented primarily under `../yoloworld/streamlit`.

## Original Streamlit Pages

- `Home.py`: navigation shell only.
- `pages/1_video_to_frames.py`: OpenCV video extraction.
- `pages/2_generate_yaml.py`: autolabel YAML generation with descriptor mapping.
- `pages/3_auto_label.py`: YOLO-World inference and YOLO label writing.
- `pages/4_upload_roboflow.py`: Roboflow upload.
- `pages/5_download_dataset.py`: Roboflow dataset download.
- `pages/6_train_model.py`: Ultralytics YOLO training and dataset YAML generation.
- `pages/7_convert_model.py`: Ultralytics export and Netron embedding.

## Removed Patterns

- Streamlit session state.
- Tkinter file selection.
- UI-local progress bars.
- API key persistence to `api_key.txt`.

## Preserved Behavior

- YOLO-World class descriptors.
- Default classes for `person` and `car`.
- YOLO label format.
- Optional bbox preview image generation.
- Roboflow upload/download.
- Ultralytics training parameters.
- Model export formats.
