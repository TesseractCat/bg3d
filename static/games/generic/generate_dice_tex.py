from PIL import Image, ImageDraw, ImageFont

# Settings
image_size = 1024  # Size of the square image (e.g., 1024x1024)
grid_size = (5, 4) # We need a 5x4 grid to fit 20 numbers
font_size = 100  # Font size for the numbers
output_file = "dice_texture.png"
background_color = "white"
text_color = "black"
font = "SignikaNegative-Medium.ttf" #"arial.ttf"

# Create a blank white image
image = Image.new('RGBA', (image_size, image_size), background_color)
draw = ImageDraw.Draw(image)

# Load a default font
try:
    font = ImageFont.truetype(font, font_size)
except IOError:
    font = ImageFont.load_default()

# Calculate cell size
cell_width = image_size // grid_size[0]
cell_height = image_size // grid_size[1]

# Draw numbers from 1 to 20 in a grid
i = 0
for num in range(1, 21):
    # Calculate grid position
    row = i // grid_size[0]
    col = i % grid_size[0]
    i += 1
    
    # Calculate the center position of each cell
    center_x = col * cell_width + cell_width // 2
    center_y = row * cell_height + cell_height // 2

    # Get the size of the text to center it
    text = str(num)
    text_width, text_height = draw.textsize(text, font=font)

    # Calculate text position
    text_x = center_x - text_width // 2
    text_y = center_y - text_height // 2

    if num == 6 or num == 9:
        draw.line(
            (text_x, text_y + text_height + 10, text_x + text_width, text_y + text_height + 10),
            fill=text_color,
            width=5
        )

    # Draw the text
    draw.text((text_x, text_y), text, font=font, fill=text_color)

# Save the image
image.save(output_file, quality=85)

print(f"Done!")
