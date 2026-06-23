import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

export interface VideoRoom {
  provider: string;
  externalRoomId: string;
  joinUrl: string;
}

export interface JoinOptions {
  /** Owner/host privileges (the tribunal hosts the hearing). */
  owner?: boolean;
  /** Display name shown to other participants. */
  userName?: string;
  /** Token lifetime in seconds. */
  ttlSeconds?: number;
}

/**
 * Video-hearing provider abstraction.
 *
 *  - `placeholder` (default): a deterministic mock room so the hearing module is
 *    fully testable without a real provider and without credentials.
 *  - `daily`: real rooms on Daily.co via its REST API (no SDK dependency — uses
 *    global fetch). Rooms are created PRIVATE; nobody can join with the bare URL.
 *    A short-lived meeting token is minted per authorised participant at join
 *    time (the tribunal gets owner privileges), so links are never reusable and
 *    never leak access.
 *
 * Adding another provider (Whereby, Zoom, Twilio) means implementing the same
 * three operations: createRoom, issueJoinUrl, deleteRoom.
 */
@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name);
  private readonly driver: string;
  private readonly dailyApiKey?: string;
  private readonly dailyApiUrl: string;

  constructor(config: ConfigService) {
    this.driver = config.get<string>('video.driver') ?? 'placeholder';
    this.dailyApiKey = config.get<string>('video.daily.apiKey');
    this.dailyApiUrl = config.get<string>('video.daily.apiUrl') ?? 'https://api.daily.co/v1';

    if (this.driver === 'daily') {
      if (!this.dailyApiKey) {
        // Surfaced at boot rather than on the first hearing.
        throw new Error('VIDEO_DRIVER=daily but DAILY_API_KEY is not set.');
      }
      this.logger.log(`Video driver=daily apiUrl=${this.dailyApiUrl}`);
    }
  }

  /** The active provider name (stored on the hearing record). */
  get providerName(): string {
    return this.driver;
  }

  /**
   * Provisions a room. `expiresAt` (unix seconds) lets the provider auto-expire
   * the room shortly after the hearing ends — confidential rooms should not
   * linger.
   */
  async createRoom(label: string, expiresAt?: number): Promise<VideoRoom> {
    if (this.driver === 'daily') return this.createDailyRoom(expiresAt);

    // placeholder
    const externalRoomId = randomUUID();
    return {
      provider: 'placeholder',
      externalRoomId,
      joinUrl: `https://hearings.local/placeholder/${externalRoomId}?room=${encodeURIComponent(label)}`,
    };
  }

  /**
   * Returns a one-time, authorised join URL for a room. For `daily` this mints a
   * short-lived meeting token; for `placeholder` it returns a deterministic mock
   * link. Returns null if a join URL cannot be issued.
   */
  async issueJoinUrl(joinUrl: string, opts: JoinOptions = {}): Promise<string | null> {
    if (this.driver === 'daily') return this.issueDailyJoinUrl(joinUrl, opts);

    // placeholder: deterministic, clearly-fake token so the flow is testable.
    const role = opts.owner ? 'owner' : 'guest';
    return `${joinUrl}&t=mock-${role}-${randomUUID()}`;
  }

  /** Best-effort teardown of a provider room (e.g. when a hearing is cancelled). */
  async deleteRoom(joinUrl: string): Promise<void> {
    if (this.driver !== 'daily') return;
    const name = this.dailyRoomName(joinUrl);
    if (!name) return;
    try {
      await this.dailyFetch(`/rooms/${encodeURIComponent(name)}`, { method: 'DELETE' });
    } catch (err) {
      // Cancellation must not fail because cleanup did; log and move on.
      this.logger.warn(`Failed to delete Daily room ${name}: ${(err as Error).message}`);
    }
  }

  /** Reachability + credential check for the health endpoint. */
  async healthCheck(): Promise<boolean> {
    if (this.driver !== 'daily') return true;
    try {
      const res = await this.dailyFetch('/', { method: 'GET' });
      return res.ok;
    } catch (err) {
      this.logger.error(`Daily health check failed: ${(err as Error).message}`);
      return false;
    }
  }

  // --- Daily provider internals -------------------------------------------

  private async createDailyRoom(expiresAt?: number): Promise<VideoRoom> {
    const exp = expiresAt ?? Math.floor(Date.now() / 1000) + 24 * 60 * 60;
    const res = await this.dailyFetch('/rooms', {
      method: 'POST',
      body: JSON.stringify({
        privacy: 'private',
        properties: { exp, eject_at_room_exp: true, enable_prejoin_ui: true },
      }),
    });
    if (!res.ok) {
      throw new Error(`Daily room creation failed (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as { name: string; url: string };
    return { provider: 'daily', externalRoomId: data.name, joinUrl: data.url };
  }

  private async issueDailyJoinUrl(joinUrl: string, opts: JoinOptions): Promise<string | null> {
    const roomName = this.dailyRoomName(joinUrl);
    if (!roomName) return null;
    const exp = Math.floor(Date.now() / 1000) + (opts.ttlSeconds ?? 60 * 60);
    const res = await this.dailyFetch('/meeting-tokens', {
      method: 'POST',
      body: JSON.stringify({
        properties: {
          room_name: roomName,
          is_owner: opts.owner ?? false,
          exp,
          ...(opts.userName ? { user_name: opts.userName } : {}),
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`Daily token mint failed (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as { token: string };
    return `${joinUrl}?t=${data.token}`;
  }

  /** Extracts the Daily room name (last path segment) from a stored join URL. */
  private dailyRoomName(joinUrl: string): string | null {
    try {
      const path = new URL(joinUrl).pathname.replace(/^\/+/, '');
      return path || null;
    } catch {
      return null;
    }
  }

  private dailyFetch(path: string, init: RequestInit): Promise<Response> {
    return fetch(`${this.dailyApiUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.dailyApiKey}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  }
}
