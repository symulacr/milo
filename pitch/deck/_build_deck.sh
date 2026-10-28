#!/bin/bash
set -euo pipefail
cd /home/eya/milo/milo-main/pitch/deck
for i in 01 02 03 04 05 06 07 08 09 10; do
  rsvg-convert -f pdf -o "slide-$i.pdf" "slide-$i.svg"
done
if command -v pdfunite >/dev/null 2>&1; then
  pdfunite slide-01.pdf slide-02.pdf slide-03.pdf slide-04.pdf slide-05.pdf slide-06.pdf slide-07.pdf slide-08.pdf slide-09.pdf slide-10.pdf milo-d7-deck.pdf
else
  gs -dBATCH -dNOPAUSE -sDEVICE=pdfwrite -sOutputFile=milo-d7-deck.pdf \
    slide-01.pdf slide-02.pdf slide-03.pdf slide-04.pdf slide-05.pdf \
    slide-06.pdf slide-07.pdf slide-08.pdf slide-09.pdf slide-10.pdf
fi
ls -la milo-d7-deck.pdf
if command -v pdfinfo >/dev/null 2>&1; then
  pdfinfo milo-d7-deck.pdf
fi
echo DECK_OK
