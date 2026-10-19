FROM python:3.12-slim
WORKDIR /app
COPY server.py ./
COPY static ./static
ENV OPENVAS_UI_HOST=0.0.0.0 OPENVAS_UI_PORT=8080 OPENVAS_UI_DATA=/data
VOLUME /data
EXPOSE 8080
CMD ["python3", "server.py"]
