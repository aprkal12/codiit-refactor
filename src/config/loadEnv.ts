import {
  SSMClient,
  GetParametersByPathCommand,
  GetParametersByPathCommandInput,
  GetParametersByPathCommandOutput,
} from '@aws-sdk/client-ssm';

export async function loadEnvFromSSM() {
  console.log('🔍 [DEBUG] NODE_ENV:', process.env.NODE_ENV);
  if (process.env.NODE_ENV !== 'production') {
    console.log('🌱 Local environment detected. Skipping SSM load.');
    return;
  }

  const client = new SSMClient({ region: process.env.AWS_REGION });
  let nextToken: string | undefined;

  try {
    // 반복문을 통해 모든 페이지의 파라미터를 가져옴
    do {
      const input: GetParametersByPathCommandInput = {
        Path: '/codiit/prod',
        Recursive: true,
        WithDecryption: true,
        NextToken: nextToken, // 이전 요청에서 받은 토큰 사용
      };

      const command = new GetParametersByPathCommand(input);

      const res: GetParametersByPathCommandOutput = await client.send(command);

      if (res.Parameters) {
        res.Parameters.forEach((p) => {
          if (p.Name && p.Value) {
            // p.Name과 p.Value가 존재하는지 체크
            const key = p.Name.split('/').pop();
            if (key) {
              process.env[key] = p.Value;
            }
          }
        });
      }

      nextToken = res.NextToken; // 다음 페이지가 있으면 토큰이 갱신됨
    } while (nextToken); // 토큰이 없을 때까지 반복

    console.log('✅ SSM Parameters successfully loaded (All pages).');
  } catch (error) {
    console.error('❌ Failed to load env from SSM:', error);
    process.exit(1);
  }
}
