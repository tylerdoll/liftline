import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import type { Archive } from "../domain/migration";
export class S3Archive implements Archive {
  readonly client: S3Client;
  constructor(
    readonly bucket: string,
    endpoint?: string,
  ) {
    if (endpoint && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(endpoint))
      throw new Error("Emulator must be localhost");
    this.client = new S3Client({
      region: "us-east-2",
      ...(endpoint
        ? {
            endpoint,
            forcePathStyle: true,
            credentials: { accessKeyId: "testing", secretAccessKey: "testing" },
          }
        : {}),
    });
  }
  async put(key: string, body: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ServerSideEncryption: "AES256",
        ContentType: "application/json",
      }),
    );
  }
  async get(key: string) {
    const r = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return r.Body!.transformToString();
  }
}
