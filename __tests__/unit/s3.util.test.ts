import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { InternalServerError } from '../../src/common/utils/errors.js';
import { createFileMock, createTestEnvMock } from '../mocks/s3.mock.js';

interface MockCommand {
  Bucket: string;
  Key: string;
  Body?: Buffer;
  ContentType?: string;
  constructor: { name: string };
}

type MockSendFn = jest.MockedFunction<(command: MockCommand) => Promise<unknown>>;

const mockEnv = createTestEnvMock();

// env 객체 모킹
jest.unstable_mockModule('@/config/constants.js', () => ({
  env: mockEnv,
}));

// UUID를 고정값으로 모킹하여 테스트 예측 가능하게 함
jest.unstable_mockModule('crypto', () => ({
  randomUUID: jest.fn(() => 'mock-random-uuid'),
}));

const mockSend = jest.fn() as MockSendFn;

// S3 Client 모킹
jest.unstable_mockModule('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: mockSend,
  })),
  PutObjectCommand: jest.fn().mockImplementation((input: unknown) => ({
    ...(input as object),
    constructor: { name: 'PutObjectCommand' },
  })),
  DeleteObjectCommand: jest.fn().mockImplementation((input: unknown) => ({
    ...(input as object),
    constructor: { name: 'DeleteObjectCommand' },
  })),
}));

// Mock 설정 후 동적 import
const { uploadFile, deleteFile } = await import('../../src/common/utils/s3.util.js');

describe('S3 Util 유닛 테스트', () => {
  // 각 테스트가 실행되기 전에 매번 실행
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // uploadFile 함수 테스트
  describe('uploadFile', () => {
    it('파일 업로드 성공 시 URL과 key를 반환해야 합니다.', async () => {
      // --- 준비 (Arrange) ---
      const file = createFileMock();
      mockSend.mockResolvedValueOnce({});
      const expectedKey = 'uploads/mock-random-uuid.png';
      const expectedUrl = `https://mock-bucket.s3.mock-region.amazonaws.com/${expectedKey}`;

      // --- 실행 (Act) ---
      const result = await uploadFile(file);

      // --- 검증 (Assert) ---
      expect(mockSend).toHaveBeenCalledTimes(1);
      const sentCommand = mockSend.mock.calls[0][0] as MockCommand;
      expect(sentCommand.constructor.name).toBe('PutObjectCommand');
      expect(sentCommand.Bucket).toBe('mock-bucket');
      expect(sentCommand.Key).toBe(expectedKey);
      expect(sentCommand.Body).toEqual(file.buffer);
      expect(sentCommand.ContentType).toBe(file.mimetype);
      expect(result).toEqual({ url: expectedUrl, key: expectedKey });
    });

    it('S3 client.send 실패 시 InternalServerError를 던져야 합니다.', async () => {
      // --- 준비 (Arrange) ---
      const file = createFileMock();
      mockSend.mockRejectedValue(new Error('S3 is down'));

      // --- 실행 및 검증 (Act & Assert) ---
      await expect(uploadFile(file)).rejects.toThrow(InternalServerError);
      await expect(uploadFile(file)).rejects.toThrow(/파일 업로드에 실패했습니다/);
    });

    it('파일 확장자가 없는 경우에도 동작해야 합니다.', async () => {
      // --- 준비 (Arrange) ---
      const fileWithoutExt = createFileMock({
        originalname: 'noextension',
        mimetype: 'application/octet-stream',
      });
      mockSend.mockResolvedValueOnce({});

      // --- 실행 (Act) ---
      const result = await uploadFile(fileWithoutExt);

      // --- 검증 (Assert) ---
      expect(result.key).toBe('uploads/mock-random-uuid');
      expect(result.url).toBe(
        'https://mock-bucket.s3.mock-region.amazonaws.com/uploads/mock-random-uuid',
      );
    });

    it('특수문자가 포함된 파일명도 처리해야 합니다.', async () => {
      // --- 준비 (Arrange) ---
      const fileWithSpecialChars = createFileMock({
        originalname: '한글 파일명 !@#$%.png',
      });
      mockSend.mockResolvedValueOnce({});

      // --- 실행 (Act) ---
      const result = await uploadFile(fileWithSpecialChars);

      // --- 검증 (Assert) ---
      expect(result.key).toBe('uploads/mock-random-uuid.png');
    });
  });

  // deleteFile 함수 테스트
  describe('deleteFile', () => {
    const fileKey = 'mock-random-uuid.png';

    it('파일 삭제 성공 시 success: true와 fileKey를 반환해야 합니다.', async () => {
      // --- 준비 (Arrange) ---
      mockSend.mockResolvedValueOnce({});

      // --- 실행 (Act) ---
      const result = await deleteFile(fileKey);

      // --- 검증 (Assert) ---
      expect(mockSend).toHaveBeenCalledTimes(1);
      const sentCommand = mockSend.mock.calls[0][0] as MockCommand;
      expect(sentCommand.constructor.name).toBe('DeleteObjectCommand');
      expect(sentCommand.Bucket).toBe('mock-bucket');
      expect(sentCommand.Key).toBe(fileKey);
      expect(result).toEqual({ success: true, fileKey });
    });

    it('S3 client.send 실패 시 InternalServerError를 던져야 합니다.', async () => {
      // --- 준비 (Arrange) ---
      mockSend.mockRejectedValue(new Error('S3 is down'));

      // --- 실행 및 검증 (Act & Assert) ---
      await expect(deleteFile(fileKey)).rejects.toThrow(InternalServerError);
      await expect(deleteFile(fileKey)).rejects.toThrow(/파일 삭제에 실패했습니다/);
    });

    it('존재하지 않는 파일 삭제 시도해도 성공해야 합니다.', async () => {
      // --- 준비 (Arrange) ---
      mockSend.mockResolvedValueOnce({});

      // --- 실행 (Act) ---
      const result = await deleteFile('non-existent-file.png');

      // --- 검증 (Assert) ---
      expect(result.success).toBe(true);
      expect(result.fileKey).toBe('non-existent-file.png');
    });
  });
});
