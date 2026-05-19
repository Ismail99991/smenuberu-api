"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadToS3 = uploadToS3;
exports.deleteFromS3 = deleteFromS3;
exports.listS3Files = listS3Files;
exports.generateFileKey = generateFileKey;
// src/lib/s3.ts
const client_s3_1 = require("@aws-sdk/client-s3");
// Конфигурация REG.RU S3
const s3Client = new client_s3_1.S3Client({
    region: "ru-1",
    endpoint: "https://s3.regru.cloud",
    credentials: {
        accessKeyId: process.env.REG_RU_ACCESS_KEY_ID,
        secretAccessKey: process.env.REG_RU_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true, // REG.RU требует path-style
});
const BUCKET_NAME = "smenuberu";
// Загрузка файла в S3
async function uploadToS3(file, key, contentType) {
    const command = new client_s3_1.PutObjectCommand({
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
async function deleteFromS3(key) {
    const command = new client_s3_1.DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
    });
    await s3Client.send(command);
}
// Получение всех файлов в папке
async function listS3Files(prefix) {
    const command = new client_s3_1.ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: prefix,
    });
    const response = await s3Client.send(command);
    return response.Contents?.map(item => item.Key || "") || [];
}
// Генерация уникального ключа для файла
function generateFileKey(entityType, entityId, fileType, originalName) {
    const ext = originalName.split('.').pop();
    const timestamp = Date.now();
    return `${entityType}/${entityId}/${fileType}/${timestamp}-${Math.random().toString(36).substring(7)}.${ext}`;
}
//# sourceMappingURL=s3.js.map