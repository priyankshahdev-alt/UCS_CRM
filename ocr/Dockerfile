# Indra OCR service (FastAPI) for Render or any Docker host.
#
# The OCR weights are baked into the image, so a cold start never downloads from
# Hugging Face and the container does not need outbound network access.
#
# Build:  docker build -t ucs-ocr .
# Run:    docker run -p 8010:8010 -e OCR_API_KEY=change-me ucs-ocr

FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    MALLOC_ARENA_MAX=2 \
    OMP_NUM_THREADS=1 \
    HOST=0.0.0.0 \
    PORT=8010 \
    INDRA_MATH=0 \
    INDRA_THREADS=1 \
    INDRA_OCR_MODEL_DIR=/opt/indra-models \
    OCR_PRELOAD=1 \
    OCR_MAX_IMAGE_SIDE=2000

# onnxruntime needs libgomp; OpenCV still links glib even in the headless wheel.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY scripts/download_models.py ./scripts/download_models.py
RUN python scripts/download_models.py \
    && python -c "from indra_ocr.models import model_dir; print('models:', model_dir())"

COPY server.py documents.py aadhaar.py ./
COPY static ./static

EXPOSE 8010

CMD ["python", "server.py"]
