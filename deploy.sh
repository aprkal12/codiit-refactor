#!/bin/bash
set -euo pipefail

ECR_REGISTRY=$1
ECR_REPOSITORY=$2
IMAGE_TAG=$3
AWS_REGION=$4
AWS_S3_BUCKET=$5
SHOULD_SEED=${6:-false}

cd /home/ec2-user

mkdir -p nginx

echo "📥 Downloading Nginx config..."
aws s3 cp s3://$AWS_S3_BUCKET/prod/nginx/default.conf ./nginx/default.conf

echo "📦 Pulling compose file"
aws s3 cp s3://$AWS_S3_BUCKET/prod/docker-compose.yml .

echo "🔐 Logging into ECR"
aws ecr-public get-login-password --region "us-east-1" \
  | docker login --username AWS --password-stdin "$ECR_REGISTRY"

echo "🚀 Deploying containers"
export ECR_REGISTRY ECR_REPOSITORY IMAGE_TAG AWS_REGION
docker compose pull
docker compose up -d --remove-orphans --force-recreate

echo "🗄 Running DB migration"
DATABASE_URL="$(aws ssm get-parameter \
  --name "/codiit/prod/DATABASE_URL" \
  --with-decryption \
  --query "Parameter.Value" \
  --output text)"

docker compose run --rm -e DATABASE_URL="$DATABASE_URL" api-server \
  ./node_modules/.bin/prisma migrate deploy

if [ "$SHOULD_SEED" == "true" ]; then
  echo "🌱 Seeding database requested..."
  docker compose run --rm -e DATABASE_URL="$DATABASE_URL" api-server \
    node dist/config/seed.js
  echo "✅ Seeding completed!"
else
  echo "⏩ Skipping seed (SHOULD_SEED is not true)"
fi

HEALTH_CHECK_PASSED=false

echo "⏳ Waiting for server to start..."
# 5초 간격으로 최대 12번(60초) 헬스체크 재시도
for i in {1..12}; do
  echo "Trying health check... ($i/12)"
  if curl -sf http://localhost:3000/api/health; then
    echo "✅ Server is up and running!"
    HEALTH_CHECK_PASSED=true
    break
  fi
  sleep 5
done

if [ "$HEALTH_CHECK_PASSED" != "true" ]; then
  echo "⚠️ Health check failed after 60 seconds."
  echo "📋 Checking container logs:"
  docker logs api-server --tail 20
  exit 1
fi

echo "🧹 Cleaning up unused Docker images..."
docker image prune -af --filter "until=24h"
echo "✅ Cleanup completed"

echo "✅ Deploy complete"
