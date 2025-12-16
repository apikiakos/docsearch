FROM python:3.11-slim

WORKDIR /app

# System deps (keep minimal; add build-essential only if your requirements need it)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
  && rm -rf /var/lib/apt/lists/*

COPY workers/python/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Copy only the python worker code
COPY workers/python /app

ENV PYTHONUNBUFFERED=1
EXPOSE 8000

# Run the FastAPI app
CMD ["python", "fastapi_service.py"]
