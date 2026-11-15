"""Create detachable ArUco cup ID markers, with a printable labeled PNG sheet."""
import argparse
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

LABELS = {'RED': 10, 'GREEN': 20, 'BLUE': 30}

def make(output: Path):
    output.mkdir(parents=True, exist_ok=True)
    dictionary = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    sheet = Image.new('RGB', (1280, 560), 'white')
    draw = ImageDraw.Draw(sheet)
    for i, (label, mid) in enumerate(LABELS.items()):
        img = cv2.aruco.generateImageMarker(dictionary, mid, 310)
        file = output / f'{label.lower()}_id{mid}.png'
        # Surround with quiet-zone white margin for readability
        tile = Image.new('RGB', (350, 350), 'white')
        tile.paste(Image.fromarray(img).convert('RGB'), (20, 20))
        tile.save(file)
        x = 30 + i * 420
        sheet.paste(tile, (x, 62))
        draw.text((x+110, 430), f'{label}   ID {mid}', fill='black')
    draw.text((30, 15), 'Attach each marker to its CUP, not the table. Keep visible while pouring.', fill='black')
    sheet.save(output / 'printable_marker_sheet.png')
    return output

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--output', default='markers/')
    args = p.parse_args()
    print(make(Path(args.output)))
