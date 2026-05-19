// src/lib/s3.ts
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Конфигурация REG.RU S3
const s3Client = new S3Client({
  region: "ru-1",
  endpoint: "https://s3.regru.cloud",
  credentials: {
    accessKeyId: process.env.REG_RU_ACCESS_KEY_ID!,
    secretAccessKey: process.env.REG_RU_SECRET_ACCESS_KEY!,
  },
  forcePathStyle: true, // REG.RU требует path-style
});

const BUCKET_NAME = "smenuberu";

// Загрузка файла в S3
export async function uploadToS3(
  file: Buffer,
  key: string,
  contentType: string
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: file,
    ContentType: contentType,
  });

  await s3Client.send(command);
  
  // Возвращаем публичную ссылку (path-style)
  return `https://s3.regru.cloud/${BUCKET_NAME}/${key}`;
}

// Удаление файла из S3
export async function deleteFromS3(key: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });
  
  await s3Client.send(command);
}

// Получение всех файлов в папке
export async function listS3Files(prefix: string): Promise<string[]> {
  const command = new ListObjectsV2Command({
    Bucket: BUCKET_NAME,
    Prefix: prefix,
  });
  
  const response = await s3Client.send(command);
  return response.Contents?.map(item => item.Key || "") || [];
}

// Генерация уникального ключа для файла
export function generateFileKey(entityType: string, entityId: string, fileType: string, originalName: string): string {
  const ext = originalName.split('.').pop();
  const timestamp = Date.now();
  return `${entityType}/${entityId}/${fileType}/${timestamp}-${Math.random().toString(36).substring(7)}.${ext}`;
}