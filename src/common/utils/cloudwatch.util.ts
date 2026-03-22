import { CloudWatchClient, PutMetricDataCommand, MetricDatum } from '@aws-sdk/client-cloudwatch';
import { env } from '@/config/constants.js';
import { logger } from '@/config/logger.js';

const cwClient = new CloudWatchClient({ region: env.AWS_REGION });

// 버퍼에 네임스페이스 정보도 함께 저장하기 위한 확장 타입
interface BufferedMetric extends MetricDatum {
  Namespace: string;
}

let metricBuffer: BufferedMetric[] = [];

/**
 * 메트릭을 버퍼에 저장하고 1분마다 일괄 전송
 */
export const putMetric = (
  namespace: string,
  metricName: string,
  value: number,
  unit: 'Count' | 'Milliseconds' = 'Count',
  dimensions?: { Name: string; Value: string }[],
) => {
  metricBuffer.push({
    Namespace: namespace,
    MetricName: metricName,
    Value: value,
    Unit: unit,
    Timestamp: new Date(),
    Dimensions: dimensions,
  });
};

// 1분(60000ms) 주기 배치 전송 워커
setInterval(async () => {
  if (metricBuffer.length === 0) return;

  const metricsToSend = [...metricBuffer];
  metricBuffer = [];

  // 1. 네임스페이스별로 메트릭 그룹화
  const groupedMetrics = metricsToSend.reduce(
    (acc, curr) => {
      if (!acc[curr.Namespace]) acc[curr.Namespace] = [];

      // AWS SDK의 MetricDatum에는 Namespace 속성이 없으므로 전송용 데이터에서 제거
      const { Namespace: _Namespace, ...metricData } = curr;
      acc[curr.Namespace].push(metricData);

      return acc;
    },
    {} as Record<string, MetricDatum[]>,
  );

  try {
    let totalSent = 0;
    // 2. 그룹화된 네임스페이스 단위로 순회하며 전송
    for (const [namespace, metrics] of Object.entries(groupedMetrics)) {
      // 3. 1000개 초과 시 분할 전송 방어 로직
      for (let i = 0; i < metrics.length; i += 1000) {
        const chunk = metrics.slice(i, i + 1000);
        const command = new PutMetricDataCommand({
          Namespace: namespace,
          MetricData: chunk,
        });
        await cwClient.send(command);
        totalSent += chunk.length;
      }
    }
    logger.info(`☁️ [CloudWatch] ${totalSent}개의 메트릭 데이터 일괄 전송 완료.`);
  } catch (error) {
    logger.error(`❌ CloudWatch 메트릭 일괄 전송 실패: ${error}`);
  }
}, 60000);
