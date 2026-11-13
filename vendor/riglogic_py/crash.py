import sys
sys.path.insert(0, 'dbg')
import riglogic
import numpy as np

r = riglogic.Rig(r'E:\Viewer\DNA\0421_V33\head.dna', True, True, False, False, False, False, False)
z = np.zeros(r.raw_control_count(), np.float32)
r.set_raw_controls(z)
r.calculate()
print('NO CRASH')
