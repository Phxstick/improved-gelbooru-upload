
# Improved Gelbooru/Danbooru upload

This extension reconstructs the Gelbooru image upload page with a bunch
of features that make posting images as convenient and fast as possible.

Starting from version 1.2, it can be used on Danbooru as well (if enabled
in the extension settings).

## Features

### Interface
- **Styled tags**: tags are nicely styled instead of just being plain text
- **Large image preview**: a large preview of the image is displayed on the
  right side of the screen
- **Wiki page viewer**: comfortably view wiki pages for tags without having
  to manually search for them in a separate browser tab (when entering tags,
  simply press F2 to view the wiki page for the currently selected completion)
- **Tabs**: multiple images can be simultaneously prepared for upload in
  different tabs, and tags can be quickly shared between similar images for
  easier bulk uploads (tabs can be enabled in the settings)

### Tagging
- **Tag warnings**: A warning is shown if an entered tag likely contains a typo,
  is deprecated, or belongs to a banned artist
- **No underscores**: Type multi-word tags more easily using spaces instead of
  underscores (press enter to finish a tag)
- **Quick artist search**: Quickly find artist tags given their URL
  (when uploading from Pixiv, a single click is enough to get the tag)
- **Tag groups**: You can split the input field for tags into multiple named
  fields in order to get a better overview over entered tags and facilitate a
  more systematic approach to tagging
- **Setting tag types**: Change the type of a tag (e.g. to artist/character)
  with just a few clicks using the context menu

### Image upload
- **Drag&drop**: easily upload images by dragging them from other webpages
- **Automatic sourcing**: The source URL is filled in automatically when uploading images directly from Pixiv
- **Automatic image checks**: multiple checks are conducted to find out if a picture has already been uploaded:
  1. Starts with a fast MD5 hash check to find posts with the exact same image 
  2. For images from Pixiv, it conducts a source check using the Pixiv ID
  3. If the searches above didn't find anything, it tries to find posts
     with similar images via reverse image search in the IQDB database

## Sample screenshot

![Example screenshot](https://dl.dropbox.com/s/hp0einqwkp5590p/improved-gelbooru-upload-sample-screenshot-medium-v2.jpg)
