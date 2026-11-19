# cmp3.py: before | after R | after S composites (before: 6b13626 for the owner's views, the checker's b5f08fb renders
# for the rest - the same terrain; after R: R's final renders at 78e21c7; after S: work/s/render at S's HEAD), and
# sheets of two in list order for looking at them.
import os, sys
from PIL import Image, ImageDraw
W='/home/roger/github/fs-exp/round-w-rs'
B0=W+'/work/shots/before'; B1='/home/roger/github/fs-exp/round-v/out/fs/verifyA4p/pictures/A'
R=W+'/work/render/final'; S=W+'/work/s/render'; O=W+'/out/fs/W/S/pictures'
os.makedirs(O+'/cmp', exist_ok=True); os.makedirs(O+'/sheets', exist_ok=True)
names=[l.split()[0] for f in ('views-owner.txt','views-checker.txt') for l in open(W+'/work/'+f) if l.strip()]
PW=640
done=[]
for n in names:
    b = f'{B0}/{n}.png' if os.path.exists(f'{B0}/{n}.png') else f'{B1}/{n}.png'
    ims=[b, f'{R}/{n}.png', f'{S}/{n}.png']
    if not all(os.path.exists(x) for x in ims): continue
    out=f'{O}/cmp/{n}.png'
    if not os.path.exists(out):
        X=[Image.open(x).convert('RGB') for x in ims]; w,h=X[0].size; ph=int(PW*h/w)
        C=Image.new('RGB',(3*PW+16,ph),'white')
        d=ImageDraw.Draw(C)
        for i,(im,t) in enumerate(zip(X,('before 6b13626','after R 78e21c7','after S'))):
            C.paste(im.resize((PW,ph)),(i*(PW+8),0)); x=i*(PW+8)+6; tt=f'{t}  {n}'
            d.rectangle((x-3,4,x+6*len(tt)+6,18),fill=(0,0,0)); d.text((x,6),tt,fill=(255,255,0))
        C.save(out)
    done.append(n)
for k in range(0,len(done),2):
    g=done[k:k+2]
    f=f'{O}/sheets/s{k//2+1:03d}-'+'+'.join(g)+'.png'
    if os.path.exists(f) or (len(g)<2 and len(done)<len(names)): continue
    ims=[Image.open(f'{O}/cmp/{n}.png') for n in g]
    Sh=Image.new('RGB',(ims[0].width,sum(i.height for i in ims)+6*(len(ims)-1)),'white'); y=0
    for i in ims: Sh.paste(i,(0,y)); y+=i.height+6
    Sh.save(f)
print(len(done),'composites')
