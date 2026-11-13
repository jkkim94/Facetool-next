from pathlib import Path

p = Path(r"e:\Viewer\FaceTool\views\CsvCompareView.js")
t = p.read_text(encoding="utf-8")

t = t.replace(
    'className="flex-1 min-h-0 grid grid-cols-2 gap-2"',
    'className="flex-1 min-h-0 grid grid-cols-2 gap-2 min-w-0"',
    1,
)
t = t.replace(
    'className="bg-black rounded-lg overflow-hidden relative flex flex-col min-h-0 border border-emerald-900/50"',
    'className="min-w-0 min-h-0 relative bg-black rounded-lg overflow-hidden border border-emerald-900/50"',
    1,
)
t = t.replace(
    'className="bg-black rounded-lg overflow-hidden relative flex flex-col min-h-0 border border-amber-900/50"',
    'className="min-w-0 min-h-0 relative bg-black rounded-lg overflow-hidden border border-amber-900/50"',
    1,
)
t = t.replace(
    "{blendA && dataA?.blendshapeNames ? (",
    "{blendA && dataA?.blendshapeNames?.length > 0 ? (",
    1,
)
t = t.replace(
    "{blendB && dataB?.blendshapeNames ? (",
    "{blendB && dataB?.blendshapeNames?.length > 0 ? (",
    1,
)

a_old = """          {blendA && dataA?.blendshapeNames?.length > 0 ? (
            <ModelViewer
              viewerId="csv-compare-a"
"""
a_new = """          {blendA && dataA?.blendshapeNames?.length > 0 ? (
            <motion className="absolute inset-0">
              <ModelViewer
                viewerId="csv-compare-a"
"""
a_new = a_new.replace("<motion", "<div").replace("</motion>", "</motion>")  # noqa
a_new = """          {blendA && dataA?.blendshapeNames?.length > 0 ? (
            <div className="absolute inset-0">
              <ModelViewer
                viewerId="csv-compare-a"
"""
if a_old not in t:
    raise SystemExit("A block not found")
t = t.replace(a_old, a_new, 1)

t = t.replace(
    """              rotation={rot}
            />
          ) : (
            <motion className="flex-1 flex items-center justify-center text-gray-500 text-sm">
              CSV A를 임포트하세요""",
    """              rotation={rot}
              />
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
              CSV A를 임포트하세요""",
    1,
)
t = t.replace(
    """            <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
              CSV A를 임포트하세요""",
    """            <motion className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
              CSV A를 임포트하세요""",
    1,
)
t = t.replace(
    '<motion className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">\n              CSV A',
    '<motion className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">\n              CSV A',
    1,
)

# simpler: fix A placeholder if still flex-1
t = t.replace(
    'className="flex-1 flex items-center justify-center text-gray-500 text-sm">\n              CSV A를',
    'className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">\n              CSV A를',
    1,
)

b_old = """          {blendB && dataB?.blendshapeNames?.length > 0 ? (
            <ModelViewer
              viewerId="csv-compare-b"
"""
b_new = """          {blendB && dataB?.blendshapeNames?.length > 0 ? (
            <div className="absolute inset-0">
              <ModelViewer
                viewerId="csv-compare-b"
"""
if b_old not in t:
    raise SystemExit("B block not found")
t = t.replace(b_old, b_new, 1)

# close B ModelViewer wrapper - find second occurrence of rotation closing for B
idx = t.find('viewerId="csv-compare-b"')
chunk = t[idx:idx+800]
if 'absolute inset-0' not in chunk.split('rotation={rot}')[1].split('CSV B')[0]:
    t = t.replace(
        """              viewerId="csv-compare-b"
              glbPath={GLB_PATH}
              cameraType="perspective"
              currentFrame={frameB}
              totalFrames={dataB.totalFrames}
              blendshapeData={blendB}
              blendshapeNames={dataB.blendshapeNames}
              position={pos}
              scale={modelTransform.scale}
              rotation={rot}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
              CSV B를 임포트하세요""",
        """              viewerId="csv-compare-b"
              glbPath={GLB_PATH}
              cameraType="perspective"
              currentFrame={frameB}
              totalFrames={dataB.totalFrames}
              blendshapeData={blendB}
              blendshapeNames={dataB.blendshapeNames}
              position={pos}
              scale={modelTransform.scale}
              rotation={rot}
              />
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
              CSV B를 임포트하세요""",
        1,
    )

t = t.replace('className="flex-1 flex items-center justify-center text-gray-500 text-sm">\n              CSV B', 
              'className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">\n              CSV B', 1)

p.write_text(t, encoding="utf-8")
print("patched")
