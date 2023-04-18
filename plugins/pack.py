from PIL import Image
import sys

cover = Image.open(sys.argv[1])
cover = cover.convert(mode="P", colors=512)
cover = cover.convert(mode="RGB")

output = Image.new(mode="RGB", size=(1024, 1024))

data = open(sys.argv[2], mode="rb").read()
i = 0
for x in range(0,1024):
    for y in range(0,1024):
        r, g, b = cover.getpixel((x,y))

        r = r & 0b11100000
        g = g & 0b11100000
        b = b & 0b11000000

        if i >= len(data) - 2:
            i = 0

        r = r | (data[i] & 0b00011111)
        g = g | (data[i] >> 5) | ((data[i + 1] << 3) & 0b00011000)
        b = b | (data[i + 1] >> 2)

        output.putpixel((x,y), (r,g,b))

        i += 2

print(f"Packed {i/1024} KiB of data into output.png")
output.save("output.png")
