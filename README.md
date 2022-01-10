
# Improved Gelbooru upload

This extension reconstructs the Gelbooru image upload page with a bunch
of features that make posting images as convenient and fast as possible.

## Features

### Interface
- Uses nicely formatted tags instead of plain text
- Displays a large preview of the uploaded image on the side

### Tagging
- Shows warning if an entered tag likely contains a typo or is non-standard
- Type multi-word tags more easily using spaces instead of underscores
- Built-in artist search for quickly adding artist tags given their URL
- Option to split the tag input into custom groups to get a better overview
  over entered tags and facilitate a more systematic approach to tagging
- Change the type of a tag (e.g. to artist/character) with just two clicks

### Image upload
- Easily upload images by dragging them from other webpages
- Automatically fills in the source URL when uploading images from Pixiv
- Automatically checks if a picture is already uploaded on Gelbooru:
  1. Starts with a fast MD5 hash check to find posts with the same image 
  2. For images from Pixiv, it conducts a source check using the Pixiv ID
  3. If the searches above didn't find anything, it tries to find posts
     with similar images via reverse image search in the IQDB database

## Sample screenshot

![Example screenshot](https://www.dropbox.com/s/taahykk77vfkwj0/improved-gelbooru-upload-sample-screenshot-medium.jpg?dl=1)