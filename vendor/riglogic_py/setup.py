import glob
import os
import sys

import pybind11
from setuptools import Extension, setup

RIGLOGIC_LIB = r"E:\Viewer\RigLogic\Source\RigLogicLib"
PUBLIC = os.path.join(RIGLOGIC_LIB, "Public")
PRIVATE = os.path.join(RIGLOGIC_LIB, "Private")

# All implementation .cpp files except the UE module wrapper.
lib_sources = []
for path in glob.glob(os.path.join(PRIVATE, "**", "*.cpp"), recursive=True):
    base = os.path.basename(path)
    if base == "RigLogicLib.cpp":  # UE module entry point, needs UE headers
        continue
    lib_sources.append(path)

sources = [os.path.join("src", "wrapper.cpp")] + lib_sources

include_dirs = [
    PUBLIC,
    PRIVATE,
    pybind11.get_include(),
]

DEBUG = bool(os.environ.get("RIGLOGIC_DEBUG"))

define_macros = [
    ("RL_BUILD_WITH_ZYX_ROTATION_ORDER", "1"),
    ("RL_AUTODETECT_SSE", "1"),
    ("RL_AUTODETECT_HALF_FLOATS", "1"),
    ("TRIO_WINDOWS_FILE_MAPPING_AVAILABLE", "1"),
    ("WIN32_LEAN_AND_MEAN", "1"),
    ("NOMINMAX", "1"),
]
if not DEBUG:
    define_macros.append(("NDEBUG", "1"))

extra_compile_args = [
    "/std:c++17",
    "/EHsc",
    "/bigobj",
    "/MP",
    "/wd4100", "/wd4127", "/wd4244", "/wd4267", "/wd4324",
    "/wd4365", "/wd4456", "/wd4514", "/wd4625", "/wd4626",
    "/wd4710", "/wd4711", "/wd4820", "/wd4987", "/wd5045",
]
if DEBUG:
    extra_compile_args += ["/Od", "/Zi"]
else:
    extra_compile_args += ["/O2", "/GL-"]

extra_link_args = []
if DEBUG:
    extra_link_args += ["/DEBUG"]

ext = Extension(
    "riglogic",
    sources=sources,
    include_dirs=include_dirs,
    define_macros=define_macros,
    language="c++",
    extra_compile_args=extra_compile_args,
    extra_link_args=extra_link_args,
)

setup(
    name="riglogic",
    version="0.1.0",
    description="Standalone RigLogic/DNA 2.5 Python bindings",
    ext_modules=[ext],
)
