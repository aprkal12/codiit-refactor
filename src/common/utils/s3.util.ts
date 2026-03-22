import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import path from 'path';
import { env } from '@/config/constants.js';
import { logger } from '@/config/logger.js';
import { InternalServerError } from './errors.js';

let s3Client: S3Client;

const getS3Client = () => {
  if (!s3Client) {
    if (!env.AWS_S3_BUCKET || !env.AWS_REGION) {
      throw new InternalServerError('S3 설정에 필요한 환경 변수가 누락되었습니다.');
    }

    // 배포 환경일땐 ec2 iam role, 로컬에서는 iam user로 인증
    const credentials =
      env.NODE_ENV !== 'production' && env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: env.AWS_ACCESS_KEY_ID,
            secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
          }
        : undefined;

    s3Client = new S3Client({
      region: env.AWS_REGION,
      credentials,
    });
  }
  return s3Client;
};

interface FileUploadParams {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

export const uploadFile = async ({ buffer, originalname, mimetype }: FileUploadParams) => {
  const client = getS3Client();
  const ext = path.extname(originalname);
  const key = `uploads/${randomUUID()}${ext}`;

  const command = new PutObjectCommand({
    Bucket: env.AWS_S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mimetype,
  });

  try {
    await client.send(command);
    const url = `https://${env.AWS_S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${key}`;
    return { url, key };
  } catch (error) {
    // ✅ logger 사용 (AWS SDK 에러는 error 레벨)
    logger.error(
      {
        err: error,
        errorType: 'S3UploadError',
        bucket: env.AWS_S3_BUCKET,
        key,
        originalname,
        mimetype,
      },
      'S3 file upload failed',
    );
    throw new InternalServerError(
      `파일 업로드에 실패했습니다. (Bucket: ${env.AWS_S3_BUCKET}, Key: ${key})`,
    );
  }
};

export const deleteFile = async (fileKey: string) => {
  const client = getS3Client();
  const command = new DeleteObjectCommand({
    Bucket: env.AWS_S3_BUCKET,
    Key: fileKey,
  });

  try {
    await client.send(command);
    return { success: true, fileKey };
  } catch (error) {
    // ✅ logger 사용 (AWS SDK 에러는 error 레벨)
    logger.error(
      {
        err: error,
        errorType: 'S3DeleteError',
        bucket: env.AWS_S3_BUCKET,
        key: fileKey,
      },
      'S3 file deletion failed',
    );
    throw new InternalServerError(`파일 삭제에 실패했습니다. (Key: ${fileKey})`);
  }
};
