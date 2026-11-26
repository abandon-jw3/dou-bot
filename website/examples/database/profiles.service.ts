import { Database, Injectable } from 'dou-bot';

@Injectable()
export class Profiles {
  constructor(private readonly database: Database) {}

  async server(
    appId: string,
    scene: 'group' | 'private',
    userId: string,
  ): Promise<string | undefined> {
    const result = await this.database.query<{ server: string }>(
      'SELECT server FROM bot_profiles WHERE app_id = $1 AND scene = $2 AND user_id = $3',
      [appId, scene, userId],
    );
    return result.rows[0]?.server;
  }
}
