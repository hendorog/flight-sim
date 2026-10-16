# apply-edit.py file old new [file old new]...: exact text replacements in src/render/clouds/<file>
# (used by try-edit.sh; fails if a text is not found).
import sys
args=sys.argv[1:]
for i in range(0,len(args),3):
    f,old,new=args[i:i+3]
    p='src/render/clouds/'+f
    s=open(p).read()
    assert old in s, (f,old)
    open(p,'w').write(s.replace(old,new))
