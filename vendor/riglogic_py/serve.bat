@echo off
REM RigLogic live server (FaceTool 3D viewer, port 8765)
cd /d "%~dp0"
"C:\Users\skpark\anaconda3\python.exe" serve.py %*
