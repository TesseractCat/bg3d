from PIL import Image
import glob, os, sys
from zipfile import ZipFile
import io

def has_ending(file, endings):
    for ending in endings:
        if file.endswith(ending):
            return True
    return False

def main():
    if len(sys.argv) < 2:
        print("Please specify a folder to pack")
        return

    folder = sys.argv[1]
    result = ZipFile(f'./{folder}.zip', 'w')

    print(f"Packing {folder}...")

    for root, dirs, files in os.walk(f"./{folder}/"):
        for file in files:
            path = os.path.join(root, file)

            if has_ending(file, [".png", ".jpg", ".jpeg"]):
                with io.BytesIO() as output:
                    image = Image.open(path)
                    image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
                    image.save(output, format="webp", quality=50)

                    original_kb = os.path.getsize(path)/1024
                    compressed_kb = len(output.getvalue())/1024

                    result.writestr(os.path.splitext(os.path.relpath(path, f"./{folder}"))[0] + ".webp", output.getvalue())
                    print(f" - {file} => webp, {original_kb:.1f} KiB -> {compressed_kb:.1f} KiB | {(compressed_kb/original_kb)*100:.1f}%")
            elif has_ending(file, [".gltf", ".glb", ".js", ".json", ".svg"]):
                result.write(path, os.path.relpath(path, f"./{folder}"))

if __name__ == "__main__":
    main()