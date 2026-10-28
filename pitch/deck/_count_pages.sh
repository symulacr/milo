#!/bin/bash
set -e
cd /home/eya/milo/milo-main/pitch/deck
# Count pages via gs
gs -q -dNODISPLAY -dNOSAFER -c "(milo-d7-deck.pdf) (r) file runpdfbegin pdfpagecount = quit"
# Also try strings for page tree
python3 - <<'PY'
from pathlib import Path
b = Path('milo-d7-deck.pdf').read_bytes()
# compressed streams may hide names; count endobj occurrences as rough signal
print('endobj', b.count(b'endobj'))
print('startxref', b.count(b'startxref'))
# search for /Count
import re
for m in re.finditer(rb'/Count\s+(\d+)', b):
    print('Count', m.group(1))
PY
