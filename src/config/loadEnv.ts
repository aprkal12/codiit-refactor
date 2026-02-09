import { SSMClient, GetParametersByPathCommand } from '@aws-sdk/client-ssm';

export async function loadEnvFromSSM() {
  console.log('🔍 [DEBUG] NODE_ENV:', process.env.NODE_ENV);
  if (process.env.NODE_ENV !== 'production') {
    console.log('🌱 Local environment detected. Skipping SSM load.');
    return;
  }

  const client = new SSMClient({ region: process.env.AWS_REGION });

  try {
    const command = new GetParametersByPathCommand({
      Path: '/codiit/prod',
      Recursive: true,
      WithDecryption: true,
    });

    const res = await client.send(command);

    if (res.Parameters) {
      res.Parameters.forEach((p) => {
        const key = p.Name!.split('/').pop()!;
        process.env[key] = p.Value!;
      });
      console.log('✅ SSM Parameters successfully loaded.');
    }
  } catch (error) {
    console.error('❌ Failed to load env from SSM:', error);
    process.exit(1);
  }
}
