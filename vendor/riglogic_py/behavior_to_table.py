# -*- coding: utf-8 -*-
"""Flatten behavior.json into one unified CSV table (+ optional canvas source)."""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

HEADERS = [
    "section",
    "entry_index",
    "gui_control_index",
    "gui_control_name",
    "raw_control_index",
    "raw_control_name",
    "from_value",
    "to_value",
    "slope",
    "cut",
    "psd_index",
    "weight",
    "blend_shape_channel_name",
    "animated_map_name",
    "input_index",
    "output_index",
    "joint_group_index",
    "joint_count",
    "values_count",
    "joint_names",
    "input_indices",
    "output_indices",
    "lods",
]


def _join_ints(vals: list) -> str:
    return ";".join(str(v) for v in vals)


def _join_names(vals: list) -> str:
    return ";".join(str(v) for v in vals)


def flatten_behavior(data: dict) -> list[dict]:
    rows: list[dict] = []

    for e in data["gui_to_raw"]["entries"]:
        rows.append({
            "section": "gui_to_raw",
            "entry_index": e["entry_index"],
            "gui_control_index": e["gui_control_index"],
            "gui_control_name": e["gui_control_name"],
            "raw_control_index": e["raw_control_index"],
            "raw_control_name": e["raw_control_name"],
            "from_value": e["from_value"],
            "to_value": e["to_value"],
            "slope": e["slope"],
            "cut": e["cut"],
        })

    for e in data["psd"]["entries"]:
        rows.append({
            "section": "psd",
            "entry_index": e["entry_index"],
            "psd_index": e["psd_index"],
            "raw_control_index": e["raw_control_index"],
            "raw_control_name": e.get("raw_control_name", ""),
            "weight": e["weight"],
        })

    for e in data["blend_shape_channels"]["entries"]:
        rows.append({
            "section": "blend_shape_channel",
            "entry_index": e["entry_index"],
            "input_index": e["input_index"],
            "output_index": e["output_index"],
            "blend_shape_channel_name": e.get("blend_shape_channel_name", ""),
        })

    for e in data["animated_maps"]["entries"]:
        rows.append({
            "section": "animated_map",
            "entry_index": e["entry_index"],
            "input_index": e["input_index"],
            "output_index": e["output_index"],
            "animated_map_name": e.get("animated_map_name", ""),
            "from_value": e.get("from_value", ""),
            "to_value": e.get("to_value", ""),
            "slope": e.get("slope", ""),
            "cut": e.get("cut", ""),
        })

    for g in data["joint_groups"]:
        rows.append({
            "section": "joint_group",
            "entry_index": g["joint_group_index"],
            "joint_group_index": g["joint_group_index"],
            "joint_count": len(g.get("joint_indices", [])),
            "values_count": len(g.get("values", [])),
            "joint_names": _join_names(g.get("joint_names", [])),
            "input_indices": _join_ints(g.get("input_indices", [])),
            "output_indices": _join_ints(g.get("output_indices", [])),
            "lods": _join_ints(g.get("lods", [])),
        })

    return rows


def write_csv(rows: list[dict], out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=HEADERS, extrasaction="ignore")
        w.writeheader()
        for row in rows:
            w.writerow({h: row.get(h, "") for h in HEADERS})


def write_canvas(rows: list[dict], matrix: dict, out_path: Path, source: str) -> None:
    sections = sorted({r["section"] for r in rows})
    counts = {s: sum(1 for r in rows if r["section"] == s) for s in sections}

    def cell(v) -> str:
        if v is None or v == "":
            return '""'
        s = str(v).replace("\\", "\\\\").replace('"', '\\"')
        return f'"{s}"'

    row_literals = []
    for r in rows:
        cells = [cell(r.get(h, "")) for h in HEADERS]
        row_literals.append(f"[{', '.join(cells)}]")

    rows_js = ",\n    ".join(row_literals)

    content = f'''import {{ useMemo, useState }} from "react";
import {{
  H1,
  H2,
  Row,
  Select,
  Stack,
  Stat,
  Table,
  Text,
  TextInput,
  useHostTheme,
}} from "cursor/canvas";

const HEADERS = {json.dumps(HEADERS, ensure_ascii=False)};
const ROWS: string[][] = [
    {rows_js}
];

const SECTIONS = {json.dumps(["all"] + sections, ensure_ascii=False)};
const COUNTS: Record<string, number> = {json.dumps(counts, ensure_ascii=False)};
const MATRIX = {{ row_count: {matrix["row_count"]}, column_count: {matrix["column_count"]} }};
const SOURCE = {json.dumps(source, ensure_ascii=False)};

function displayColumns(section: string): number[] {{
  const base = [0, 1]; // section, entry_index
  const bySection: Record<string, number[]> = {{
    all: [0, 1, 3, 5, 12, 14, 17, 18, 19],
    gui_to_raw: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    psd: [0, 1, 10, 4, 5, 11],
    blend_shape_channel: [0, 1, 14, 15, 13],
    animated_map: [0, 1, 14, 15, 13, 6, 7, 8, 9],
    joint_group: [0, 1, 17, 18, 19, 20, 21, 22],
  }};
  return bySection[section] ?? bySection.all;
}}

export default function BehaviorTableCanvas() {{
  const theme = useHostTheme();
  const [section, setSection] = useState("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {{
    const q = query.trim().toLowerCase();
    return ROWS.filter((row) => {{
      if (section !== "all" && row[0] !== section) return false;
      if (!q) return true;
      return row.some((cell) => String(cell).toLowerCase().includes(q));
    }});
  }}, [section, query]);

  const cols = displayColumns(section);
  const headers = cols.map((i) => HEADERS[i]);
  const tableRows = filtered.map((row) => cols.map((i) => row[i] || "—"));

  const total = ROWS.length;

  return (
    <Stack gap={{20}} style={{{{ padding: 24, maxWidth: 1400, margin: "0 auto" }}}}>
      <Stack gap={{6}}>
        <H1>MetaHuman DNA Behavior Table</H1>
        <Text tone="secondary" size="small">
          Source: {{SOURCE}} · joint matrix {{MATRIX.row_count}} x {{MATRIX.column_count}} · {{total}} rows
        </Text>
      </Stack>

      <Row gap={16} style={{{{ flexWrap: "wrap" }}}}>
        <Stat label="Total rows" value={{String(total)}} />
        <Stat label="GUI to Raw" value={{String(COUNTS.gui_to_raw ?? 0)}} />
        <Stat label="PSD" value={{String(COUNTS.psd ?? 0)}} />
        <Stat label="Joint groups" value={{String(COUNTS.joint_group ?? 0)}} />
        <Stat label="Blend shapes" value={{String(COUNTS.blend_shape_channel ?? 0)}} />
        <Stat label="Animated maps" value={{String(COUNTS.animated_map ?? 0)}} />
      </Row>

      <Row gap={12} style={{{{ flexWrap: "wrap", alignItems: "flex-end" }}}}>
        <Stack gap={4} style={{{{ minWidth: 200 }}}}>
          <Text size="small" weight="medium">Section</Text>
          <Select
            value={{section}}
            onChange={{(v) => setSection(v)}}
            options={{SECTIONS.map((s) => ({{ value: s, label: s === "all" ? "All sections" : s }}))}}
          />
        </Stack>
        <Stack gap={4} style={{{{ flex: 1, minWidth: 240 }}}}>
          <Text size="small" weight="medium">Search</Text>
          <TextInput
            value={{query}}
            onChange={{(v) => setQuery(v)}}
            placeholder="Control name, joint, channel..."
          />
        </Stack>
        <Text tone="tertiary" size="small" style={{{{ paddingBottom: 8 }}}}>
          Showing {{filtered.length}} / {{total}}
        </Text>
      </Row>

      <Stack gap={8}>
        <H2>Behavior mappings</H2>
        <Table
          headers={{headers}}
          rows={{tableRows}}
          striped
          stickyHeader
          framed
          style={{{{ maxHeight: 640, overflow: "auto", borderColor: theme.stroke.tertiary }}}}
        />
      </Stack>
    </Stack>
  );
}}
'''
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(content, encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--behavior", required=True, help="Path to behavior.json")
    ap.add_argument("--out-csv", default=None)
    ap.add_argument("--out-canvas", default=None)
    args = ap.parse_args()

    behavior_path = Path(args.behavior).resolve()
    out_csv = Path(args.out_csv) if args.out_csv else behavior_path.with_name("behavior_table.csv")
    out_canvas = Path(args.out_canvas) if args.out_canvas else None

    data = json.loads(behavior_path.read_text(encoding="utf-8"))
    rows = flatten_behavior(data)
    write_csv(rows, out_csv)
    print(f"Wrote CSV: {out_csv} ({len(rows)} rows)")

    if out_canvas:
        write_canvas(rows, data["joint_matrix"], out_canvas, str(behavior_path))
        print(f"Wrote canvas: {out_canvas}")


if __name__ == "__main__":
    main()
