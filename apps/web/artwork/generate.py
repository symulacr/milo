#!/usr/bin/env python3
"""Deterministic, original Milo editorial artwork; standard library only."""
from __future__ import annotations
import hashlib, math, os, struct, zlib
W, H, S = 600, 720, 2
SW, SH = W * S, H * S
def mix(a, b, t):
    t = max(0, min(1, t)); return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))
def chunk(kind, payload):
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xffffffff)
class Canvas:
    def __init__(self, top, bottom):
        self.p = [[mix(top, bottom, y / (SH - 1))] * SW for y in range(SH)]
    def rect(self, x0, y0, x1, y1, color):
        x0, y0, x1, y1 = [int(v * S) for v in (x0, y0, x1, y1)]
        for y in range(max(0, y0), min(SH, y1)): self.p[y][max(0, x0):min(SW, x1)] = [color] * max(0, min(SW, x1) - max(0, x0))
    def ellipse(self, cx, cy, rx, ry, color, blend=1):
        cx, cy, rx, ry = [v * S for v in (cx, cy, rx, ry)]
        for y in range(max(0, int(cy-ry-1)), min(SH, int(cy+ry+2))):
            yy = (y+.5-cy)/ry
            if abs(yy) > 1: continue
            dx = rx * math.sqrt(1-yy*yy)
            for x in range(max(0, int(cx-dx-1)), min(SW, int(cx+dx+2))):
                if ((x+.5-cx)/rx)**2 + yy*yy <= 1: self.p[y][x] = mix(self.p[y][x], color, blend)
    def polygon(self, points, color):
        pts = [(int(x*S), int(y*S)) for x, y in points]
        for y in range(max(0, min(y for _, y in pts)), min(SH, max(y for _, y in pts)+1)):
            xs = sorted(x1+(y-y1)*(x2-x1)/(y2-y1) for (x1,y1),(x2,y2) in zip(pts,pts[1:]+pts[:1]) if (y1<=y<y2) or (y2<=y<y1))
            for a,b in zip(xs[::2],xs[1::2]):
                for x in range(max(0,math.ceil(a)),min(SW,math.floor(b)+1)): self.p[y][x] = color
    def text(self, x, y, text, color, scale=2):
        glyphs={"A":["0110","1001","1001","1111","1001","1001"],"B":["1110","1001","1110","1001","1001","1110"],"C":["0111","1000","1000","1000","1000","0111"],"D":["1110","1001","1001","1001","1001","1110"],"E":["1111","1000","1110","1000","1000","1111"],"F":["1111","1000","1110","1000","1000","1000"],"G":["0111","1000","1011","1001","1001","0111"],"H":["1001","1001","1111","1001","1001","1001"],"I":["111","010","010","010","010","111"],"J":["0011","0001","0001","0001","1001","0110"],"K":["1001","1010","1100","1010","1001","1001"],"L":["100","100","100","100","100","111"],"M":["1001","1111","1111","1001","1001","1001"],"N":["1001","1101","1011","1001","1001","1001"],"O":["0110","1001","1001","1001","1001","0110"],"P":["1110","1001","1110","1000","1000","1000"],"Q":["0110","1001","1001","1011","0111","0001"],"R":["1110","1001","1110","1010","1001","1001"],"S":["0111","1000","0110","0001","0001","1110"],"T":["11111","00100","00100","00100","00100","00100"],"U":["1001","1001","1001","1001","1001","0110"],"V":["1001","1001","1001","1001","0110","0110"],"W":["1001","1001","1001","1111","1111","1001"],"X":["1001","1001","0110","0110","1001","1001"],"Y":["1001","1001","0110","0110","0110","0110"],"Z":["1111","0001","0010","0100","1000","1111"],".":["0","0","0","0","0","1"],"0":["0110","1001","1011","1101","1001","0110"],"1":["010","110","010","010","010","111"],"2":["0110","1001","0010","0100","1000","1111"],"/":["0001","0010","0010","0100","0100","1000"]}; text=text.upper()
        for ch in text:
            if ch == " ": x += 3*scale; continue
            assert ch in glyphs, f"missing glyph for {ch!r}"
            glyph = glyphs[ch]
            for row,pixels in enumerate(glyph):
                for col,pixel in enumerate(pixels):
                    if pixel=="1": self.rect(x+col*scale,y+row*scale,x+(col+1)*scale,y+(row+1)*scale,color)
            x += (len(glyph[0])+2)*scale
    def leaf(self,x,y,size,color):
        self.polygon([(x,y),(x+size*.15,y-size*.7),(x+size*.5,y-size),(x+size*.7,y-size*.25),(x+size*.55,y+size*.2),(x+size*.18,y+size*.34)],color)
        self.polygon([(x+size*.18,y+size*.25),(x+size*.3,y-size*.42),(x+size*.52,y-size*.72),(x+size*.38,y-size*.12)],mix(color,(239,225,200),.25))
    def bottle(self,cx,base,scale=1,label="No.01"):
        olive,light,edge=(55,67,45),(91,103,67),(39,48,34)
        self.ellipse(cx,base+11*scale,108*scale,20*scale,(174,133,103),.25); self.ellipse(cx,base,96*scale,17*scale,(113,89,65)); self.rect(cx-94*scale,base-15*scale,cx+94*scale,base,(101,78,59)); self.ellipse(cx,base-15*scale,94*scale,17*scale,(207,175,143))
        n=base-252*scale; self.rect(cx-42*scale,n,cx+42*scale,n+48*scale,edge); self.ellipse(cx,n,42*scale,8*scale,(35,42,31)); self.rect(cx-56*scale,n+48*scale,cx+56*scale,n+59*scale,(134,126,84))
        for x in range(int(cx-82*scale),int(cx+83*scale)):
            self.rect(x/S,n+59*scale,(x+1)/S,base-15*scale,mix(olive,light,math.sin((x-(cx-82*scale))/(164*scale)*math.pi)*.75+.08))
        self.ellipse(cx,n+59*scale,82*scale,18*scale,light); self.ellipse(cx,base-15*scale,82*scale,18*scale,edge); ly=base-137*scale; self.rect(cx-57*scale,ly,cx+57*scale,ly+75*scale,(239,224,195)); self.rect(cx-57*scale,ly,cx+57*scale,ly+2*scale,(178,115,80)); self.text(cx-40*scale,ly+14*scale,"STILL",(57,65,44),2*scale); self.text(cx-27*scale,ly+43*scale,label,(106,74,52),2*scale)
    def save(self,path):
        rows=[]
        for y in range(0,SH,S):
            row=bytearray([0])
            for x in range(0,SW,S): row.extend(self.p[y][x])
            rows.append(bytes(row))
        with open(path,"wb") as f: f.write(b"\x89PNG\r\n\x1a\n"+chunk(b"IHDR",struct.pack(">IIBBBBB",W,H,8,2,0,0,0))+chunk(b"IDAT",zlib.compress(b"".join(rows),9))+chunk(b"IEND",b""))
def render(name):
    backgrounds={"hero":((250,237,222),(226,180,151)),"detail":((246,239,219),(238,205,169)),"collection":((251,241,225),(220,176,144))}; c=Canvas(*backgrounds[name]); c.ellipse(300,653,265,75,(113,80,55),.12)
    if name=="hero":
        c.polygon([(65,585),(65,151),(138,151),(138,488),(238,488),(238,585)],(239,208,176)); c.bottle(329,579,1.25); c.leaf(76,449,97,(104,119,76)); c.leaf(122,374,76,(128,139,88)); c.text(58,64,"STILL",(65,73,47),5); c.text(61,108,"BOTANICAL STUDIO",(116,83,61),2)
    elif name=="detail":
        c.polygon([(420,627),(420,171),(538,171),(538,627)],(229,191,151)); c.bottle(255,608,1.45); c.leaf(442,355,100,(76,95,62)); c.leaf(390,440,68,(122,130,78)); c.text(55,71,"STILL",(65,73,47),4); c.text(57,112,"FORM / No.01",(116,83,61),2)
    else:
        c.polygon([(82,601),(82,250),(170,250),(170,518),(432,518),(432,601)],(242,214,184)); c.bottle(210,604,.82); c.bottle(395,604,.82,"No.02"); c.leaf(94,492,69,(104,119,76)); c.leaf(454,490,66,(91,107,68)); c.text(57,73,"STILL",(65,73,47),4); c.text(59,113,"THE QUIET COLLECTION",(116,83,61),2)
    c.save(os.path.join(os.path.dirname(__file__),"..","public","images",name+".png"))
# --- Service-context sample packs (SC-02…SC-07); SC-01 reuses the Still set ---
def boxes(c,cx,base,s,acc,dark):
    c.ellipse(cx,base+10*s,120*s,18*s,dark,.18)
    for dx,h in ((-70,150),(20,210)):
        x0=cx+dx*s; c.polygon([(x0,base),(x0,base-h*s),(x0+30*s,base-h*s-22*s),(x0+30*s,base-22*s)],mix(acc,(255,255,255),.35)); c.rect(x0,base-h*s,x0+60*s,base,acc); c.polygon([(x0+60*s,base),(x0+60*s,base-h*s),(x0+30*s,base-h*s-22*s),(x0+30*s,base-22*s)],dark)
def launch(c,cx,base,s,acc,dark):
    c.ellipse(cx,base-170*s,95*s,95*s,acc)
    for i in range(8):
        a=math.pi*(i+.5)/8; x1=cx+130*s*math.cos(a); y1=base-170*s-130*s*math.sin(a); x2=cx+185*s*math.cos(a); y2=base-170*s-185*s*math.sin(a)
        c.polygon([(x1-6*s,y1),(x1+6*s,y1),(x2+3*s,y2),(x2-3*s,y2)],dark)
    c.rect(0,base-40*s,600,base,mix(acc,(0,0,0),.35))
def archway(c,cx,base,s,acc,dark):
    c.ellipse(cx,base+10*s,140*s,20*s,dark,.2); c.rect(cx-110*s,base-230*s,cx-70*s,base,acc); c.rect(cx+70*s,base-230*s,cx+110*s,base,acc)
    c.ellipse(cx,base-230*s,110*s,95*s,acc); c.ellipse(cx,base-230*s,70*s,60*s,mix(acc,(246,243,238),.85))
    c.rect(cx-55*s,base-150*s,cx+55*s,base,dark)
def books(c,cx,base,s,acc,dark):
    c.ellipse(cx,base+10*s,150*s,18*s,dark,.18)
    for dx,w,h,t in ((-110,64,220,0),(-30,74,260,.25),(60,60,190,.5)):
        x0=cx+dx*s; c.rect(x0,base-h*s,x0+w*s,base,mix(acc,(255,255,255),t)); c.rect(x0,base-h*s,x0+12*s,base,dark); c.rect(x0+12*s,base-h*s+18*s,x0+w*s,base-h*s+24*s,dark)
def badge(c,cx,cy,s,acc,dark):
    c.polygon([(cx-40*s,cy+110*s),(cx-15*s,cy+150*s),(cx,cy+118*s),(cx+15*s,cy+150*s),(cx+40*s,cy+110*s)],dark)
    c.ellipse(cx,cy,120*s,120*s,acc); c.ellipse(cx,cy,92*s,92*s,mix(acc,(246,243,238),.85)); c.ellipse(cx,cy,66*s,66*s,acc)
def chartbars(c,cx,base,s,acc,dark):
    c.rect(cx-160*s,base,cx+170*s,base+3*s,dark)
    for i,h in enumerate((60,110,90,170,230)):
        x0=cx-150*s+i*66*s; c.rect(x0,base-h*s,x0+44*s,base,acc if i%2 else mix(acc,(255,255,255),.3))
CONTEXT_SCENES={
    "sc-02":("UNISON","RENDER STUDY",((232,238,244),(196,208,222)),(96,116,148),(42,54,72),boxes),
    "sc-03":("BASIL","LAUNCH NOTES",((250,240,214),(238,196,140)),(206,120,60),(110,58,30),launch),
    "sc-04":("HOTEL ARIA","ARRIVAL SET",((238,232,222),(190,176,158)),(120,96,70),(66,52,38),archway),
    "sc-05":("CHRONICLE","COVER PROOFS",((240,236,228),(206,198,184)),(70,74,92),(34,36,48),books),
    "sc-06":("LOCALE","MARKET EDITION",((236,240,230),(196,214,196)),(72,120,88),(36,66,48),None),
    "sc-07":("QUOTIENT","DECK FIGURES",((234,236,242),(192,200,216)),(84,52,215),(44,40,80),chartbars),
}
def render_context(ctx,view):
    word,sub,(top,bottom),acc,dark,motif=CONTEXT_SCENES[ctx]; c=Canvas(top,bottom)
    if view=="01":
        if ctx=="sc-06": badge(c,300,330,1.15,acc,dark)
        else: motif(c,300,560,1.0,acc,dark)
        c.text(56,64,word,dark,5); c.text(59,108,sub,mix(dark,(255,255,255),.25),2)
    elif view=="02":
        if ctx=="sc-06": badge(c,330,400,1.8,acc,dark)
        else: motif(c,270,640,1.45,acc,dark)
        c.text(54,68,word,dark,4); c.text(56,110,"No.02 / DETAIL",mix(dark,(255,255,255),.25),2)
    else:
        for i in range(3):
            if ctx=="sc-06": badge(c,150+i*150,360,.55,acc,dark)
            else: motif(c,150+i*150,470,.42,acc,dark)
        c.text(54,68,word,dark,4); c.text(56,110,"SET OF THREE",mix(dark,(255,255,255),.25),2)
    c.save(os.path.join(os.path.dirname(__file__),"..","public","images",f"{ctx}-{view}.png"))
if __name__=="__main__":
    out=os.path.join(os.path.dirname(__file__),"..","public","images"); os.makedirs(out,exist_ok=True)
    names=[("hero","detail","collection")[i] for i in range(3)]+[f"{ctx}-{view}" for ctx in CONTEXT_SCENES for view in ("01","02","03")]
    for name in ("hero","detail","collection"):
        render(name)
    for ctx in CONTEXT_SCENES:
        for view in ("01","02","03"):
            render_context(ctx,view)
    for name in names:
        path=os.path.join(out,name+".png"); print(f"{name}.png  {os.path.getsize(path)} bytes  {hashlib.sha256(open(path,'rb').read()).hexdigest()}")
