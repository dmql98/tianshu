from pathlib import Path
from PIL import Image

src = Path(r"C:\Users\dmql\Documents\tianshu\dev\融资材料\character assets")
out = Path(r"C:\Users\dmql\Documents\tianshu\dev\融资材料\.ppt_build_tianshu\frames")
out.mkdir(parents=True, exist_ok=True)

for path in src.glob("*.gif"):
    image = Image.open(path)
    frame_count = getattr(image, "n_frames", 1)
    image.seek(max(0, frame_count // 2))
    image.convert("RGBA").save(out / f"{path.stem}.png")
    print(path.name, image.size, frame_count)
