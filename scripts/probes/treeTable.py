# Compact table of the drainage-tree measures (treeMetrics.ts text blocks) from one or more probe outputs.
#   python3 scripts/probes/treeTable.py out/tree/measure-1.txt out/tree/spike.txt ... > out/tree/table.md
import re, sys
rows = []
for path in sys.argv[1:]:
    block = None
    seed = ""
    for line in open(path):
        ms = re.match(r"^seed (\d+)", line)
        if ms: seed = f"s{ms.group(1)} "
        m = re.match(r"^\s*(.*?): land (\d+) km² \(mountain (\d+)", line)
        if m and "front" in line:
            lab = m.group(1).strip()
            block = {"label": lab if lab.startswith("seed") or lab.startswith("NZ") else seed + lab, "mtn%": round(100 * int(m.group(3)) / max(1, int(m.group(2))))}
            w = re.search(r"front p50/p90/p99/max [\d.]+/([\d.]+)/([\d.]+)/", line)
            if w: block["dist p90/p99"] = f"{float(w.group(1)):.0f}/{float(w.group(2)):.0f}"
            rows.append(block)
            continue
        if "drawn network" in line:
            block = {"label": seed + line.strip().rstrip(":")}
            rows.append(block)
            continue
        if line.startswith("seed ") and "world" in line:
            block = None
        if block is None:
            continue
        m = re.search(r"confluences both >= (\d+) km²: (\d+); .*plain \d+ \((\d+) %\).*inside the ranges (\d+) %", line)
        if m:
            block[f"conf{m.group(1)} n"] = m.group(2)
            block[f"conf{m.group(1)} plain%"] = m.group(3)
            block[f"conf{m.group(1)} inside%"] = m.group(4)
        m = re.search(r"exits >= (\d+) km²: (\d+)[ ;].*NN spacing p25/p50/p75 (\S+) km; area p25/p50/p75/max (\S+) km²", line)
        if m:
            block[f"exits{m.group(1)}"] = m.group(2)
            block[f"exits{m.group(1)} NN"] = m.group(3)
            a = m.group(4).split("/")
            block[f"exits{m.group(1)} A p50/max"] = f"{a[1]}/{a[3]}"
        m = re.search(r"top 1/3/5/10 carry (\d+)/(\d+)/(\d+)/(\d+) %", line)
        if m: block["top3%"] = m.group(2)
        m = re.search(r"largest exit / mouth(?: area)? p25/p50/p75 (\S+); exits >= 10 km² per river p50 (\d+)", line)
        if m:
            block["exit/mouth p25/p50/p75"] = m.group(1)
            block["exits/river"] = m.group(2)
        m = re.search(r"Hack h \(A >= 10 km², all land\) (\S+) .*Re p50 sea basins >= 100 km² (\S+) .*range-exit basins >= 100 km² (\S+)", line)
        if m:
            block["Hack h"] = m.group(1)
            block["Re sea"] = m.group(2)
            block["Re exit"] = m.group(3)
cols = ["label", "mtn%", "dist p90/p99", "conf45 inside%", "conf45 plain%", "conf200 n", "conf200 inside%", "conf200 plain%", "exits10", "exits10 NN", "exits45", "exits45 NN", "exits45 A p50/max", "exits200", "top3%", "exit/mouth p25/p50/p75", "exits/river", "Hack h", "Re sea", "Re exit"]
print("| " + " | ".join(cols) + " |")
print("|" + "---|" * len(cols))
for r in rows:
    print("| " + " | ".join(str(r.get(c, "")) for c in cols) + " |")
