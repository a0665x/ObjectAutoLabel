import pytest

from backend.app.world_model_catalog import describe_world_model, list_world_model_details


@pytest.mark.parametrize("size", "nslmx")
def test_describes_every_yoloe26_seg_size(size: str) -> None:
    name = f"yoloe-26{size}-seg.pt"
    assert describe_world_model(name) == {
        "name": name,
        "family": "yoloe-26",
        "task": "segment",
        "annotation_output": "bbox",
        "supported": True,
        "reason": None,
    }


def test_describes_legacy_world_model() -> None:
    assert describe_world_model("yolov8m-world.pt")["family"] == "yolo-world"


@pytest.mark.parametrize("size", "smlx")
def test_describes_official_yolo_world_v2_sizes(size: str) -> None:
    name = f"yolov8{size}-worldv2.pt"
    assert describe_world_model(name) == {
        "name": name,
        "family": "yolo-world-v2",
        "task": "detect",
        "annotation_output": "bbox",
        "supported": True,
        "reason": None,
    }


def test_marks_unknown_checkpoint_unsupported() -> None:
    info = describe_world_model("mystery.pt")
    assert info["supported"] is False
    assert info["reason"] == "Unsupported world model filename"


def test_lists_details_in_filename_order() -> None:
    details = list_world_model_details(["yolov8m-world.pt", "yoloe-26n-seg.pt"])
    assert [item["name"] for item in details] == ["yoloe-26n-seg.pt", "yolov8m-world.pt"]
