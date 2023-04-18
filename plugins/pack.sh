#!/bin/bash

imagetypes='jpg\|jpeg\|svg\|png'
filetypes='gltf\|json\|js\|glb\|bin'

# Create temp, copy files from ./$1/ -> ./temp/$1/
echo "Copying files to temp..."
rm -rf ./temp/
mkdir ./temp/
find ./$1/ -regextype emacs -regex ".*\.\($imagetypes\|$filetypes\)" | cpio -pdm ./temp/

# Compress all images
# - Quality
echo "Converting images to compressed JPG..."

find ./temp/$1/ -regextype emacs -regex ".*\.\($imagetypes\)" -exec\
     mogrify -format jpg -strip -quality 80 -sampling-factor 4:2:0 -interlace Plane -unsharp 0.5x0.5+0.5+0.008 {} +
# find ./temp/$1/ -regextype emacs -regex ".*\.\($imagetypes\)" -exec\
#      mogrify -format png -strip {} +
# find ./temp/$1/ -name "*.jpg" -delete
# find ./temp/$1/ -regextype emacs -regex ".*\.png" -exec\
#      pngquant -v -f --ext .png --quality 0-1 -- {} ';'

find ./temp/$1/ -name "*.png" -delete

# - Resize
echo "Resizing images..."

find ./temp/$1/ -size +500k -regextype emacs -regex ".*\.\($imagetypes\)" -exec\
     mogrify -format jpg -adaptive-resize 1024\^\> {} +
find ./temp/$1/ -size +200k -regextype emacs -regex ".*\.\($imagetypes\)" -exec\
     mogrify -format jpg -adaptive-resize 75% {} +

# - Delete ImageMagick temp files
echo "Deleting temporary files..."
find ./temp/$1/ \( -name "*.jpg~" -o -name "*.png~" \) -delete

# Create zip
rm $1.zip
7z a $1.zip -r ./temp/$1/*
