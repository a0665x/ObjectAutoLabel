"""Real-engine seek, pause/resume, ByteTrack, and bounded-stop acceptance."""
import argparse
import asyncio
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.app.stream_demo import StreamConfig, StreamSession


async def check(args):
    session = StreamSession(StreamConfig(model_id='smoke', source='upload', source_id='smoke',
        device='cpu', start_seconds=args.start, fps=6), args.model, Path(args.video))
    frames = []
    if args.external:
        session.external_coordinates = 'auto'
    messages = asyncio.Queue()
    ready = asyncio.Event()
    received = 0

    class Socket:
        async def send_bytes(self, data):
            nonlocal received
            received += len(data)

        async def send_json(self, data):
            if data['type'] == 'tracks':
                frames.append(data)
                if len(frames) == 4:
                    if args.diagnostics:
                        assert data['objects'], 'No object to select'
                        await messages.put({'type':'select_track','id':data['objects'][0]['id'],'time':data['time']})
                    ready.set()
                if len(frames) == 12:
                    await messages.put({'type': 'stop'})

        async def receive_json(self):
            return await messages.get()

    async def pause():
        await ready.wait()
        await messages.put({'type': 'playback', 'paused': True})
        await asyncio.sleep(.4)
        count = len(frames)
        await asyncio.sleep(.4)
        assert len(frames) == count, 'Inference advanced while paused'
        await messages.put({'type': 'playback', 'paused': False})

    task = asyncio.create_task(pause())
    try:
        await asyncio.wait_for(session.run(Socket()), 35)
        await task
    finally:
        task.cancel()
        await session.close()
    assert frames[0]['time'] == 0
    assert any(frame['objects'] for frame in frames), 'No tracked detections'
    assert received > 0, 'No encoded video'
    if args.diagnostics:
        assert any(frame.get('identity',{}).get('state')=='direct' for frame in frames), 'No server-side selected identity'
        assert any(obj.get('trail') and obj.get('uncertainty') for frame in frames for obj in frame['objects']), 'No Kalman visualization data'
    assert all(process.returncode is not None for process in session.processes)
    print(json.dumps({'passed': True, 'start_seconds': args.start, 'frames': len(frames), 'bytes': received,
                      'track_ids': sorted({obj['id'] for frame in frames for obj in frame['objects']})}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True)
    parser.add_argument('--video', required=True)
    parser.add_argument('--start', type=float, default=3)
    parser.add_argument('--external', action='store_true')
    parser.add_argument('--diagnostics', action='store_true')
    asyncio.run(check(parser.parse_args()))
