import sys
import numpy as np
import riglogic


def log(*a):
    print(*a, flush=True)


DNA = r'E:\Viewer\DNA\0421_V33\head.dna'
COLS = r'E:\DatasetGen\AA_Learning_Dataset_test\metahuman\AI로_기후정책__0002.columns.txt'
NPY = r'E:\DatasetGen\AA_Learning_Dataset_test\metahuman\AI로_기후정책__0002.npy'

log('loading rig...')
r = riglogic.Rig(DNA)
log('loaded. raw=', r.raw_control_count(), 'joints=', r.joint_count(), 'bs=', r.blend_shape_channel_count())

raw_names = r.raw_control_names()
raw_idx = {n: i for i, n in enumerate(raw_names)}
cols = [l.strip() for l in open(COLS, encoding='utf-8') if l.strip()]


def col_to_raw(c):
    if c.startswith('CTRL_expressions_'):
        return 'CTRL_expressions.' + c[len('CTRL_expressions_'):]
    return c


mapping = [(ci, raw_idx[col_to_raw(c)]) for ci, c in enumerate(cols) if col_to_raw(c) in raw_idx]
log('mapped', len(mapping), 'of', len(cols))

nraw = r.raw_control_count()
z = np.zeros(nraw, np.float32)

log('set_raw_controls(zero)...')
r.set_raw_controls(z)
log('calculate()...')
r.calculate()
log('joint_outputs()...')
jo0 = np.array(r.joint_outputs())
log('jo0 len', jo0.shape)
log('blend_shape_outputs()...')
bs0 = np.array(r.blend_shape_outputs())
log('bs0 len', bs0.shape, 'nonzero', int((np.abs(bs0) > 1e-6).sum()))
log('neutral_joint_values()...')
nj = np.array(r.neutral_joint_values())
log('nj len', nj.shape, 'jointCount*9=', r.joint_count() * 9)
log('zeroctrl jointOut==neutral?', bool(np.allclose(jo0, nj, atol=1e-4)))

data = np.load(NPY)
f = 600
rv = np.zeros(nraw, np.float32)
for ci, ri in mapping:
    rv[ri] = data[f, ci]
log('frame', f, 'set+calc...')
r.set_raw_controls(rv)
r.calculate()
bs = np.array(r.blend_shape_outputs())
jo = np.array(r.joint_outputs())
log('bs nonzero', int((np.abs(bs) > 1e-4).sum()), 'max', float(np.abs(bs).max()))
log('joint delta max', float(np.abs(jo - nj).max()))
log('DONE')
