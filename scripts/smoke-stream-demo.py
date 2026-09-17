"""Exercise real capture, inference engines, encoded video, and process cleanup offline."""
import argparse
import asyncio
import json
from pathlib import Path
import subprocess
import sys
import tempfile

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.app.stream_demo import StreamConfig, StreamSession, capabilities


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", action="append", required=True)
    parser.add_argument("--image")
    parser.add_argument("--require-detections", action="store_true")
    args = parser.parse_args()
    caps = capabilities()
    assert caps["available"], caps
    assert all(engine["available"] for engine in caps["engines"].values()), caps
    with tempfile.TemporaryDirectory(prefix="stream-demo-smoke-") as directory:
        root = Path(directory)
        source = root / "source.mp4"
        frame = cv2.imread(args.image) if args.image else np.full((360, 640, 3), 100, np.uint8)
        assert frame is not None
        frame = cv2.resize(frame, (640, 360))
        writer = cv2.VideoWriter(str(source), cv2.VideoWriter_fourcc(*"mp4v"), 6, (640, 360))
        assert writer.isOpened()
        for _ in range(12):
            writer.write(frame)
        writer.release()
        for model in args.model:
            output = root / (Path(model).suffix[1:] + ".mp4")
            messages = []
            with output.open("wb") as handle:
                class Socket:
                    async def send_bytes(self, chunk):
                        handle.write(chunk)

                    async def send_json(self, message):
                        messages.append(message.copy())

                    async def receive_json(self):
                        await asyncio.Future()

                config = StreamConfig(model_id="smoke", source="upload", source_id="smoke", fps=6,
                                      conf=0.1, device="0" if Path(model).suffix == ".pt" else "cpu")
                session = StreamSession(config, model, source)
                try:
                    await asyncio.wait_for(session.run(Socket()), 90)
                finally:
                    await session.close()
                assert all(process.returncode is not None for process in session.processes)
            assert messages[-1]["type"] == "ended", messages[-1]
            assert messages[-1]["frames"] == 12, messages[-1]
            if args.require_detections:
                assert any(m.get("detections", 0) > 0 for m in messages)
            result = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0",
                                     "-show_entries", "stream=codec_name,width,height,nb_read_frames", "-of", "json", str(output)],
                                    check=True, capture_output=True, text=True)
            info = json.loads(result.stdout)["streams"][0]
            assert info["codec_name"] == "h264" and int(info["nb_read_frames"]) == 12, info
            print(json.dumps({"model": Path(model).name, "video": info, "stats": messages[-1]}), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
