/**
 * Automatic Model Downloader for ONNX Phi-4
 *
 * Downloads Phi-4 ONNX model from HuggingFace on first use
 */

import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { pipeline } from 'stream/promises';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { homedir } from 'os';

/**
 * Where ONNX models live on disk.
 *
 * These paths were previously relative ('./models/...'), so they resolved
 * against process.cwd() and a ~4.6GB download landed in whatever directory the
 * command happened to run from — re-downloaded once per working directory, and
 * left untracked inside any repository it was invoked in.
 *
 * Exported so the reader (router/providers/onnx-local.ts) can resolve the same
 * path the writer uses; the two previously disagreed (phi-4 vs phi-4-mini).
 */
export const MODEL_ROOT = process.env.AGENTIC_FLOW_MODEL_DIR
  || join(homedir(), '.agentic-flow', 'models');

export const PHI4_MODEL_PATH = join(
  MODEL_ROOT, 'phi-4-mini', 'cpu_and_mobile', 'cpu-int4-rtn-block-32-acc-level-4', 'model.onnx'
);

export const PHI4_MODEL_DATA_PATH = `${PHI4_MODEL_PATH}.data`;

export interface DownloadProgress {
  downloaded: number;
  total: number;
  percentage: number;
}

export interface ModelInfo {
  repo: string;
  filename: string;
  localPath: string;
  sha256?: string;
}

export class ModelDownloader {
  private baseUrl = 'https://huggingface.co';

  /**
   * Phi-4 Mini ONNX INT4 quantized model (CPU optimized)
   * Size: ~52MB model + ~4.86GB data = ~4.9GB total
   * Note: Requires TWO files - model.onnx and model.onnx.data
   */
  private phi4Model: ModelInfo = {
    repo: 'microsoft/Phi-4-mini-instruct-onnx',
    filename: 'cpu_and_mobile/cpu-int4-rtn-block-32-acc-level-4/model.onnx',
    localPath: PHI4_MODEL_PATH
  };

  private phi4ModelData: ModelInfo = {
    repo: 'microsoft/Phi-4-mini-instruct-onnx',
    filename: 'cpu_and_mobile/cpu-int4-rtn-block-32-acc-level-4/model.onnx.data',
    localPath: PHI4_MODEL_DATA_PATH
  };

  /**
   * Check if model exists locally
   */
  isModelDownloaded(modelPath?: string): boolean {
    const path = modelPath || this.phi4Model.localPath;
    return existsSync(path);
  }

  /**
   * Get model download URL
   */
  private getDownloadUrl(model: ModelInfo): string {
    return `${this.baseUrl}/${model.repo}/resolve/main/${model.filename}`;
  }

  /**
   * Download model with progress tracking
   */
  async downloadModel(
    modelInfo?: ModelInfo,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<string> {
    const model = modelInfo || this.phi4Model;

    // Check if already downloaded
    if (this.isModelDownloaded(model.localPath)) {
      console.log(`✅ Model already exists at ${model.localPath}`);
      return model.localPath;
    }

    // Create directory
    const dir = dirname(model.localPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const url = this.getDownloadUrl(model);
    console.log(`📦 Downloading Phi-4 ONNX model from HuggingFace...`);
    console.log(`   URL: ${url}`);
    console.log(`   Destination: ${model.localPath}`);

    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Download failed: ${response.statusText}`);
      }

      const totalSize = parseInt(response.headers.get('content-length') || '0', 10);
      let downloadedSize = 0;

      if (!response.body) {
        throw new Error('Response body is null');
      }

      const fileStream = createWriteStream(model.localPath);

      // Track progress
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        if (value) {
          chunks.push(value);
          downloadedSize += value.length;

          if (onProgress && totalSize > 0) {
            onProgress({
              downloaded: downloadedSize,
              total: totalSize,
              percentage: (downloadedSize / totalSize) * 100
            });
          }

          // Write chunk
          fileStream.write(value);
        }
      }

      fileStream.end();

      // Wait for file stream to finish
      await new Promise<void>((resolve, reject) => {
        fileStream.on('finish', () => resolve());
        fileStream.on('error', reject);
      });

      console.log(`✅ Model downloaded successfully`);
      console.log(`   Size: ${(downloadedSize / (1024 * 1024)).toFixed(2)} MB`);
      console.log(`   Path: ${model.localPath}`);

      return model.localPath;

    } catch (error) {
      console.error(`❌ Model download failed:`, error);
      throw new Error(`Failed to download model: ${error}`);
    }
  }

  /**
   * Download Phi-4 ONNX model if needed (downloads BOTH .onnx and .onnx.data files)
   */
  async ensurePhi4Model(onProgress?: (progress: DownloadProgress) => void): Promise<string> {
    const mainFileExists = this.isModelDownloaded(this.phi4Model.localPath);
    const dataFileExists = this.isModelDownloaded(this.phi4ModelData.localPath);

    if (mainFileExists && dataFileExists) {
      return this.phi4Model.localPath;
    }

    console.log(`🔍 Phi-4-mini ONNX model not found locally`);
    console.log(`📥 Starting automatic download...`);
    console.log(`   This is a one-time download (~4.9GB total)`);
    console.log(`   Model: microsoft/Phi-4-mini-instruct-onnx (INT4 quantized)`);
    console.log(`   Files: model.onnx (~52MB) + model.onnx.data (~4.86GB)`);
    console.log(``);

    // Download main model file if missing
    if (!mainFileExists) {
      console.log(`📦 Downloading model.onnx...`);
      await this.downloadModel(this.phi4Model, onProgress);
      console.log(``);
    }

    // Download data file if missing
    if (!dataFileExists) {
      console.log(`📦 Downloading model.onnx.data (this is the large 4.86GB file)...`);
      await this.downloadModel(this.phi4ModelData, onProgress);
    }

    return this.phi4Model.localPath;
  }

  /**
   * Verify model file integrity (optional)
   */
  async verifyModel(modelPath: string, expectedSha256?: string): Promise<boolean> {
    if (!expectedSha256) {
      return true; // Skip verification if no hash provided
    }

    try {
      const fileBuffer = readFileSync(modelPath);
      const hash = createHash('sha256').update(fileBuffer).digest('hex');

      if (hash !== expectedSha256) {
        console.error(`❌ Model verification failed`);
        console.error(`   Expected: ${expectedSha256}`);
        console.error(`   Got:      ${hash}`);
        return false;
      }

      console.log(`✅ Model verification passed`);
      return true;

    } catch (error) {
      console.error(`❌ Model verification error:`, error);
      return false;
    }
  }

  /**
   * Get model info
   */
  getModelInfo(): ModelInfo {
    return this.phi4Model;
  }

  /**
   * Format download progress for display
   */
  static formatProgress(progress: DownloadProgress): string {
    const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(2);
    return `${progress.percentage.toFixed(1)}% (${mb(progress.downloaded)}/${mb(progress.total)} MB)`;
  }
}

/**
 * Global singleton instance
 */
export const modelDownloader = new ModelDownloader();

/**
 * Convenience function for downloading Phi-4 model
 */
export async function ensurePhi4Model(
  onProgress?: (progress: DownloadProgress) => void
): Promise<string> {
  return modelDownloader.ensurePhi4Model(onProgress);
}
