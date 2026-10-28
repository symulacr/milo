#!/bin/bash
python3 - <<'PY'
from pathlib import Path
p = Path('/home/eya/milo/milo-main/pitch/deck/milo-d7-deck.pdf')
b = p.read_bytes()
print('size', p.stat().st_size)
print('header', b[:5])
print('page_objects', b.count(b'/Type /Page'))
print('pages_nodes', b.count(b'/Type /Pages'))
PY
ls /home/eya/milo/milo-main/pitch/deck
