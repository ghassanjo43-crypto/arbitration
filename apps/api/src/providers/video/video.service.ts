import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

export interface VideoRoom {
  provider: string;
  externalRoomId: string;
  joinUrl: string;
}

/**
 * Video-hearing provider abstraction. The "placeholder" adapter returns a
 * deterministic mock room so the hearing module is fully testable without a
 * real provider. Swap VIDEO_DRIVER=zoom|teams|meet to integrate later.
 */
@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name);
  private readonly driver: string;

  constructor(config: ConfigService) {
    this.driver = config.get<string>('video.driver') ?? 'placeholder';
  }

  async createRoom(label: string): Promise<VideoRoom> {
    const externalRoomId = randomUUID();
    if (this.driver === 'placeholder') {
      return {
        provider: 'placeholder',
        externalRoomId,
        joinUrl: `https://hearings.local/placeholder/${externalRoomId}?room=${encodeURIComponent(label)}`,
      };
    }
    this.logger.warn(`Video driver "${this.driver}" not implemented; returning placeholder.`);
    return { provider: this.driver, externalRoomId, joinUrl: `https://hearings.local/${externalRoomId}` };
  }
}
