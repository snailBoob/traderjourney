"""Read a snapshot from stdin and emit recognized position prices as JSON."""
import json
import os
import re
import sys

import cv2
import numpy as np
from PIL import Image, ImageOps
from tesserocr import PyTessBaseAPI, PSM


def boxes(mask):
    _, _, stats, _ = cv2.connectedComponentsWithStats(mask.astype('uint8'))
    return stats[1:]


def recognize(image, tessdata):
    # Position labels live in the right-hand price scale, regardless of trade direction.
    rgb = image.crop((int(image.width*.90), 0, image.width, image.height)).convert('RGB')
    r, g, b = np.asarray(rgb, dtype='int16').transpose(2, 0, 1)
    masks = [r - np.maximum(g, b), g - np.maximum(r, b)]
    empty = dict(stopLoss=None, takeProfit=None)
    result = {}
    with PyTessBaseAPI(path=tessdata, lang='eng', psm=PSM.SINGLE_LINE) as api:
        for key, mask in zip(empty, masks):
            candidates = [(x,y,w,h) for x,y,w,h,area in boxes(mask > 90)
                          if x > 0 and w >= 18 and 7 <= h <= 50 and area > w*h*.5]
            if len(candidates) != 1:
                return empty
            x,y,w,h = candidates[0]
            patch = rgb.crop((x+1,y+1,x+w-1,y+h-1))
            ink = Image.fromarray(np.asarray(patch).min(axis=2))
            if ink.getextrema()[1] - ink.getextrema()[0] < 60:
                continue
            # Avoid over-enlarging labels from high-resolution snapshots.
            scale = min(4, max(1, 64 // ink.height))
            ink = ImageOps.invert(ImageOps.autocontrast(ink)).resize((ink.width*scale,ink.height*scale), Image.Resampling.LANCZOS)
            api.SetImage(ImageOps.expand(ink, 15, fill=255))
            text = api.GetUTF8Text().strip()
            if not re.fullmatch(r'\d+\.\d+', text) or api.MeanTextConf() < 80:
                scaled = rgb.crop((x,y,x+w,y+h)).resize((w*5,h*5), Image.Resampling.LANCZOS)
                binary = Image.fromarray(np.uint8(np.asarray(scaled).min(axis=2) > 170)*255)
                bounds = binary.getbbox()
                if bounds is None:
                    continue
                api.SetImage(ImageOps.expand(ImageOps.invert(binary.crop(bounds)), 12, fill=255))
                text = api.GetUTF8Text().strip()
            if re.fullmatch(r'\d+\.\d+', text) and api.MeanTextConf() >= 80:
                result[key] = text
    return result if len(result) == 2 else empty


if __name__ == '__main__':
    cv2.setNumThreads(1)
    with Image.open(sys.stdin.buffer) as snapshot:
        if snapshot.width * snapshot.height > 10_000_000:
            print('{}')
        else:
            print(json.dumps(recognize(snapshot, os.environ.get('TESSDATA_PREFIX', '/usr/share/tesseract-ocr/5/tessdata'))))
