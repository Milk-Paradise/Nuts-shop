"""Reproducible video import from the public MotionSites preview.

The Cloudinary MP4 supplied in the brief returns 401 (cloud disabled).
Only the stable scene at the end of the preview is retained; the source
website's logo, signature, scrolling and paragraphs are excluded.
Requires Pillow + FFmpeg; these are authoring tools, not app dependencies.
"""
from pathlib import Path
import subprocess
import sys
from PIL import Image

source = Path('scripts/media-source/macbook-noir.webp')
target = Path('public/media/macbook-noir.webm')
ffmpeg = sys.argv[1]
with Image.open(source) as image:
    image.seek(34)
    image.load()
    duration = image.info.get('duration', 100)
    fps = 1000 / duration
    process = subprocess.Popen([
        ffmpeg, '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '640x470',
        '-r', str(fps), '-i', 'pipe:0',
        '-vf', 'crop=640:330:0:140', '-an',
        '-c:v', 'libvpx-vp9', '-crf', '28', '-b:v', '0',
        '-pix_fmt', 'yuv420p', str(target),
    ], stdin=subprocess.PIPE)
    assert process.stdin is not None
    for number in range(34, image.n_frames):
        image.seek(number)
        process.stdin.write(image.convert('RGB').tobytes())
    process.stdin.close()
    if process.wait() != 0:
        raise RuntimeError('Video encoding failed')
subprocess.run([
    ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(target),
    '-frames:v', '1', '-q:v', '2', 'public/media/macbook-noir-poster.jpg',
], check=True)
print(f'Prepared {target}: {target.stat().st_size:,} bytes')
