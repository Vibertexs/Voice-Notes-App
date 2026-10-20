# The Ekho cloud API. Build from the repo root:
#
#   docker build -t voiceflow-api .
#   docker run --env-file .env -e ENVIRONMENT=production -p 8000:8000 voiceflow-api
#
# Only the cloud package is copied in. The desktop app, the frontend and the
# phone app are not part of this image, and neither is .env: configuration
# comes from the environment the platform provides.
FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Dependencies first, so editing code does not reinstall them.
COPY requirements-cloud.txt .
RUN pip install -r requirements-cloud.txt

COPY backend/__init__.py backend/mongo.py backend/mongo_setup.py backend/
COPY backend/cloud backend/cloud
COPY cloud_app.py .

RUN useradd --create-home --uid 10001 app
USER app

# Behind the platform's load balancer every request arrives from the proxy;
# trusting its X-Forwarded-For is what gives rate limits the real client IP.
# The container is only reachable through that proxy.
ENV PORT=8000 \
    FORWARDED_ALLOW_IPS="*"
EXPOSE 8000

CMD ["sh", "-c", "exec uvicorn cloud_app:app --host 0.0.0.0 --port \"$PORT\" --proxy-headers --no-server-header"]
