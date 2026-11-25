@echo off
cd /d "%~dp0"
echo Lancement d'InvestPilot en mode reseau (accessible depuis les autres appareils du meme Wi-Fi)...
set HOST=0.0.0.0
python server.py || py server.py
pause
