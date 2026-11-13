# -*- coding: utf-8 -*-
"""Build lip/mouth vertex ID sets from control_vertex_summary.csv for debug coloring."""
import csv
import json
import os
import re

SUMMARY = os.path.join(os.path.dirname(__file__), "control_vertex_summary.csv")
OUT = os.path.join(os.path.dirname(__file__), "lip_vertices.json")

LIP_EXPR = re.compile(
    r"^mouth("
    r"Lips|UpperLip|LowerLip|Press|Funnel|Sticky|CornerPull"
    r")"
)

MOUTH_EXPR = re.compile(
    r"^mouth(?!Cheek)"
)


def load_sets():
    lip_ids = set()
    mouth_ids = set()
    lip_ctrl = []
    mouth_ctrl = []
    with open(SUMMARY, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            expr = row.get("expression_name", "")
            if not expr.startswith("mouth"):
                continue
            ids = [int(x) for x in row["vertex_ids_global"].split(";") if x]
            if MOUTH_EXPR.match(expr):
                mouth_ids.update(ids)
                mouth_ctrl.append(expr)
            if LIP_EXPR.match(expr):
                lip_ids.update(ids)
                lip_ctrl.append(expr)
    return lip_ids, mouth_ids, lip_ctrl, mouth_ctrl


def main():
    lip_ids, mouth_ids, lip_ctrl, mouth_ctrl = load_sets()
    # head mesh only (global 0 .. head_count-1); teeth/eyes start at 11977
    head_max = 11977
    lip_head = sorted(i for i in lip_ids if i < head_max)
    mouth_head = sorted(i for i in mouth_ids if i < head_max)
    payload = {
        "headVertexCount": head_max,
        "lip": lip_head,
        "mouth": mouth_head,
        "lipControls": sorted(set(lip_ctrl)),
        "mouthControls": sorted(set(mouth_ctrl)),
        "lipCount": len(lip_head),
        "mouthCount": len(mouth_head),
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f)
    print("wrote %s: lip=%d mouth=%d (head only)" % (OUT, len(lip_head), len(mouth_head)))


if __name__ == "__main__":
    main()
