# syntax=docker/dockerfile:1
# Local development and future Render deployment image for the API.

FROM python:3.11-slim

WORKDIR /app

# Install the package with runtime dependencies first for layer caching.
COPY pyproject.toml ./
COPY app ./app
RUN pip install --no-cache-dir .

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
