@echo off
cd /d "%~dp0"
echo Lancement d'InvestPilot...
python server.py || py server.py
pause
