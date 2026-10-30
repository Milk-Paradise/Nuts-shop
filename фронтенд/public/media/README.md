# MacBook editorial motion

User reference: https://motionsites.ai/?prompt=tech-noir-about

The supplied Cloudinary MP4 returns HTTP 401 with `cloud_name daklr2whx is disabled`.
The reference page's publicly displayed animated preview is available at:
https://pub-86dc5b5484314368ac5436a674b0d919.r2.dev/animated%20(48).webp

The stable final scene (frames 34–68) was transcoded to a silent VP9/WebM clip.
The top 140px containing the source website's paragraphs are excluded; no source
logo, signature or scrolling is included. A matching static first-frame poster
is used before loading, for reduced motion, and if decoding fails.

Authoring script: scripts/prepare-noir-media.py. Source retained under
scripts/media-source. Pillow and FFmpeg are authoring tools, not runtime dependencies.
Local output: 640×330 WebM, approximately 175 KB, plus a 40 KB JPEG poster.

Use of this supplied reference asset follows the user's design brief. Rights for
public commercial distribution have not been independently established.
