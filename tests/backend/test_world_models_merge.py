from backend.app.world_models import _merge_same_class_annotations


def test_merge_same_class_annotations_collapses_overlapping_prompt_boxes() -> None:
    annotations = [
        {
            "class_id": 0,
            "class_name": "person",
            "x_center": 0.50,
            "y_center": 0.50,
            "width": 0.20,
            "height": 0.20,
            "confidence": 0.40,
            "source_descriptor": "standing person",
            "source_type": "pseudo",
            "edited": False,
        },
        {
            "class_id": 0,
            "class_name": "person",
            "x_center": 0.51,
            "y_center": 0.50,
            "width": 0.20,
            "height": 0.20,
            "confidence": 0.80,
            "source_descriptor": "pedestrian",
            "source_type": "pseudo",
            "edited": False,
        },
        {
            "class_id": 1,
            "class_name": "car",
            "x_center": 0.51,
            "y_center": 0.50,
            "width": 0.20,
            "height": 0.20,
            "confidence": 0.90,
            "source_descriptor": "car",
            "source_type": "pseudo",
            "edited": False,
        },
    ]

    merged = _merge_same_class_annotations(annotations, iou_threshold=0.5)

    assert len(merged) == 2
    person = next(item for item in merged if item["class_id"] == 0)
    assert person["confidence"] == 0.80
    assert person["source_descriptor"] == "standing person | pedestrian"
    assert person["source_type"] == "pseudo_merged"


def test_merge_same_class_annotations_keeps_distant_same_class_boxes() -> None:
    annotations = [
        {"class_id": 0, "class_name": "person", "x_center": 0.2, "y_center": 0.2, "width": 0.1, "height": 0.1, "confidence": 0.5, "source_descriptor": "person", "source_type": "pseudo", "edited": False},
        {"class_id": 0, "class_name": "person", "x_center": 0.8, "y_center": 0.8, "width": 0.1, "height": 0.1, "confidence": 0.6, "source_descriptor": "pedestrian", "source_type": "pseudo", "edited": False},
    ]

    assert len(_merge_same_class_annotations(annotations, iou_threshold=0.5)) == 2
