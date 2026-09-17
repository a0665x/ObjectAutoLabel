"""Run in the CLI workspace: python examples/detect_image.py MODEL IMAGE"""
import sys
import cv2
from utils import load_detector, show

detector = load_detector(sys.argv[1])
prepared = detector.preprocess(cv2.imread(sys.argv[2]))
prediction = detector.predict(prepared)
result = detector.postprocess(prediction)
show(result)
print(result.boxes.data)
