import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

// k6 + prometheus + grafana 테스트 + 모니터링툴 세팅함
// 각각 개념좀 더 공부하고 강점이 뭔지 내가 얘네를 써서 뭘해야하는지 더 공부하고 써보자
// 내가 뭐하고있는지를 모르겠음

// 1. k6, prometheus, grafana 개념 이해
// 2. 현재 연결된 세팅 보완 (gemini cli한테 물어보기)
// 3. 부하 테스트 실행 및 로그 수집 (노션 작성)
// 4. 환경별로 자동으로 전환되게 할 수 있는지? (a/b 테스트 어떻게 돌리지 다들?)

const BASE_URL = __ENV.BASE_URL || 'http://host.docker.internal:3000';
const productId = 'cmkb7xcw2000lv6nfpwshbgds';
const sizeId = parseInt(__ENV.SIZE_ID) || 2;
const initialStock = __ENV.STOCK || 10;
const testVus = __ENV.VUS || 20;

const successfulOrders = new Counter('successful_orders');
const stockErrorOrders = new Counter('stock_error_orders');
const otherErrorOrders = new Counter('other_error_orders');

export const options = {
  scenarios: {
    concurrentOrders: {
      executor: 'per-vu-iterations', // 더 명확함
      vus: testVus,
      iterations: 1, // VU 한 명 = 주문 1개
      maxDuration: '5m',
    },
  },
  thresholds: {
    successful_orders: [`count==${initialStock}`],
    stock_error_orders: [`count==${testVus - initialStock}`],
    other_error_orders: ['count==0'],
  },
};

export function setup() {
  // 1️⃣ 실험 환경 초기화 (예약중인 재고 전부 취소)
  http.del(`${BASE_URL}/api/test/orders`);

  // 2️⃣ 토큰 발급
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({
      email: 'buyer@codiit.com',
      password: 'test1234',
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );

  return { authToken: res.json('accessToken') };
}

export default function (data) {
  const res = http.post(
    `${BASE_URL}/api/orders`,
    JSON.stringify({
      name: `TestUser ${__VU}`,
      phone: '010-1234-5678',
      address: 'Test Address',
      usePoint: 0,
      orderItems: [{ productId, sizeId, quantity: 1 }],
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${data.authToken}`,
      },
      tags: { name: 'CreateOrder' }, // 모니터링용 태그
      // 태그 붙은 요청만 로깅
    },
  );

  const isSuccess = res.status === 201;
  const isStockError = res.status === 400 && res.body.includes('재고가 부족합니다');

  if (isSuccess) successfulOrders.add(1);
  else if (isStockError) stockErrorOrders.add(1);
  else otherErrorOrders.add(1);

  check(res, { 'valid business response': () => isSuccess || isStockError });
}

// # Ensure a clean state before starting
// docker-compose -f docker-compose.k6.yml down

// # Experiment 1 (Stock 10, Size 2)
// docker-compose -f docker-compose.k6.yml run --rm -e VUS=30 -e STOCK=10 -e SIZE_ID=2 k6 > k6/experiment-1-result.txt && docker-compose -f docker-compose.k6.yml stop prometheus && docker-compose -f docker-compose.k6.yml rm -f prometheus

// # Experiment 2 (Stock 10, Size 2)
// docker-compose -f docker-compose.k6.yml run --rm -e VUS=50 -e STOCK=10 -e SIZE_ID=2 k6 > k6/experiment-2-result.txt && docker-compose -f docker-compose.k6.yml stop prometheus && docker-compose -f docker-compose.k6.yml rm -f prometheus

// # Experiment 3 (Stock 50, Size 3)
// docker-compose -f docker-compose.k6.yml run --rm -e VUS=150 -e STOCK=50 -e SIZE_ID=3 k6 > k6/experiment-3-result.txt && docker-compose -f docker-compose.k6.yml stop prometheus && docker-compose -f docker-compose.k6.yml rm -f prometheus

// # Experiment 4 (Stock 100, Size 4)
// docker-compose -f docker-compose.k6.yml run --rm -e VUS=300 -e STOCK=100 -e SIZE_ID=4 k6 > k6/experiment-4-result.txt && docker-compose -f docker-compose.k6.yml stop prometheus && docker-compose -f docker-compose.k6.yml rm -f prometheus

// # Experiment 5 (Stock 100, Size 4)
// docker-compose -f docker-compose.k6.yml run --rm -e VUS=500 -e STOCK=100 -e SIZE_ID=4 k6 > k6/experiment-5-result.txt && docker-compose -f docker-compose.k6.yml stop prometheus && docker-compose -f docker-compose.k6.yml rm -f prometheus

// # Experiment 6 (re-run of Experiment 1)
// docker-compose -f docker-compose.k6.yml run --rm -e VUS=30 -e STOCK=10 -e SIZE_ID=2 k6 > k6/experiment-6-result.txt && docker-compose -f docker-compose.k6.yml stop prometheus && docker-compose -f docker-compose.k6.yml rm -f prometheus

// # Experiment 7 (re-run of Experiment 2)
// docker-compose -f docker-compose.k6.yml run --rm -e VUS=50 -e STOCK=10 -e SIZE_ID=2 k6 > k6/experiment-7-result.txt && docker-compose -f docker-compose.k6.yml stop prometheus && docker-compose -f docker-compose.k6.yml rm -f prometheus

// # Experiment 8 (re-run of Experiment 3)
// docker-compose -f docker-compose.k6.yml run --rm -e VUS=150 -e STOCK=50 -e SIZE_ID=3 k6 > k6/experiment-8-result.txt && docker-compose -f docker-compose.k6.yml stop prometheus && docker-compose -f docker-compose.k6.yml rm -f prometheus

// # Experiment 9 (re-run of Experiment 4)
// docker-compose -f docker-compose.k6.yml run --rm -e VUS=300 -e STOCK=100 -e SIZE_ID=4 k6 > k6/experiment-9-result.txt && docker-compose -f docker-compose.k6.yml stop prometheus && docker-compose -f docker-compose.k6.yml rm -f prometheus

// # Experiment 10 (re-run of Experiment 5)
// docker-compose -f docker-compose.k6.yml run --rm -e VUS=500 -e STOCK=100 -e SIZE_ID=4 k6 > k6/experiment-10-result.txt && docker-compose -f docker-compose.k6.yml stop prometheus && docker-compose -f docker-compose.k6.yml rm -f prometheus

// # Ensure all services are down after all experiments
// docker-compose -f docker-compose.k6.yml down
