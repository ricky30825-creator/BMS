# The AI process is optional and intentionally contains no model artifacts.
# An approved external bundle and adapter are mounted by the Compose profile.
FROM python:3.12.8-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app
WORKDIR /app

COPY requirements.txt ./requirements.txt
RUN python -m pip install --no-cache-dir -r requirements.txt
COPY . ./ai

CMD ["python", "-m", "ai.runtime"]
