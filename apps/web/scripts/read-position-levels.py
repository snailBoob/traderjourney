"""Read a snapshot from stdin and emit recognized position prices as JSON."""
import json
import os
import re
import sys
from decimal import Decimal

import cv2
import numpy as np
from PIL import Image, ImageOps
from tesserocr import PyTessBaseAPI, PSM


def boxes(mask):
    _, _, stats, _ = cv2.connectedComponentsWithStats(mask.astype('uint8'))
    return stats[1:]


def recognize(image, tessdata):
    rgb = image.convert('RGB')
    r, g, b = np.asarray(rgb, dtype='int16').transpose(2, 0, 1)
    masks = [r - np.maximum(g, b), g - np.maximum(r, b)]
    # Bridge thin chart lines that cut the translucent drawing in two.
    regions = [[(x, y, w, h) for x, y, w, h, area in boxes(cv2.morphologyEx(
                ((m > 10) & (m < 110)).astype('uint8'), cv2.MORPH_CLOSE, np.ones((3, 3), 'uint8')))
                if w >= 20 and h >= 8 and x+w < rgb.width*.95 and area > w*h*.5]
               # A translucent blue zone can tint the red stop purple. Keep
               # strict masks for the axis labels, but admit red-leaning pink
               # in the drawing when its geometry matches the green rectangle.
               for m in masks]
    pink = ((r > b) & (b > g+15) & (r-g > 20) & (r-g < 110)).astype('uint8')
    regions[0].extend((x,y,w,h) for x,y,w,h,area in boxes(cv2.morphologyEx(
        pink, cv2.MORPH_OPEN, np.ones((5, 5), 'uint8')))
        if w >= 20 and h >= 8 and x+w < rgb.width*.95 and area > w*h*.5)
    pairs = [(a, b) for a in regions[0] for b in regions[1]
             if abs((a[0]+a[2])-(b[0]+b[2])) <= 3 and min(a[2], b[2]) >= .8*max(a[2], b[2])
             and min(abs(a[1]+a[3]-b[1]), abs(b[1]+b[3]-a[1])) <= 5]
    result = dict(stopLoss=None, takeProfit=None)
    labels = [[(x,y,w,h) for x,y,w,h,_ in boxes(mask > 90)
               if x > rgb.width*.90 and w >= 18 and 7 <= h <= 50] for mask in masks]
    def matches(box, edge):
        return box[1] <= edge < box[1] + box[3]

    if len(pairs) > 1:
        pairs = [(r,g) for r,g in pairs if all(any(matches(box, edge) for box in group)
                 for group, edge in zip(labels, (r[1]+r[3]-1, g[1]) if r[1]>g[1]
                                        else (r[1], g[1]+g[3]-1)))]
    if len(pairs) != 1:
        return result
    red, green = pairs[0]
    long = red[1] > green[1]
    edges = [red[1]+red[3]-1, green[1]] if long else [red[1], green[1]+green[3]-1]
    with PyTessBaseAPI(path=tessdata, lang='eng', psm=PSM.SINGLE_LINE) as api:
        for key, group, edge in zip(result, labels, edges):
            candidates = [box for box in group if matches(box, edge)]
            if len(candidates) != 1:
                continue
            x,y,w,h = candidates[0]
            patch = rgb.crop((x+1,y+1,x+w-1,y+h-1))
            ink = Image.fromarray(np.asarray(patch).min(axis=2))
            if ink.getextrema()[1] - ink.getextrema()[0] < 60:
                continue
            ink = ImageOps.invert(ImageOps.autocontrast(ink)).resize((ink.width*4,ink.height*4), Image.Resampling.LANCZOS)
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
    sl, tp = result.values()
    if sl and tp and not (Decimal(sl) < Decimal(tp) if long else Decimal(sl) > Decimal(tp)):
        return dict(stopLoss=None, takeProfit=None)
    return result


if __name__ == '__main__':
    cv2.setNumThreads(1)
    with Image.open(sys.stdin.buffer) as snapshot:
        if snapshot.width * snapshot.height > 10_000_000:
            print('{}')
        else:
            print(json.dumps(recognize(snapshot, os.environ.get('TESSDATA_PREFIX', '/usr/share/tesseract-ocr/5/tessdata'))))
