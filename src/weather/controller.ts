import {
  Command,
  Controller,
  Cooldown,
  Ctx,
  Inject,
  OnButton,
  Option,
  Rest,
  Slot,
  UseGuards,
} from 'dd-bot';
import type { ButtonContext, MessageContext, MessageInput } from 'dd-bot';
import { AUDIT } from '../config.js';
import type { Audit } from '../config.js';
import { City } from '../city.js';
import { WeatherGuard } from '../access.js';
import { WeatherButtons } from './buttons.js';
import type { WeatherQuery } from './buttons.js';
import { WeatherError } from './http.js';
import { WeatherService } from './service.js';
import type { Day, Unit } from './service.js';
import { REFRESH_BUTTON, weatherCard } from './view.js';

@Controller()
@UseGuards(WeatherGuard)
export class WeatherController {
  constructor(
    private readonly weather: WeatherService,
    private readonly buttons: WeatherButtons,
    @Inject(AUDIT) private readonly audit: Audit,
  ) {}
  @Command('查询', {
    aliases: ['查'],
    description: '查询真实天气，例如：查询 北京 天气 明天 --detail',
  })
  @Cooldown({ scope: 'user', durationMs: 30000 })
  async query(
    @City() city: string,
    @Slot('topic', { name: '查询类型', required: true, choices: ['天气'] }) topic: string,
    @Slot('day', { name: '日期', choices: ['今天', '明天', '后天'], default: '今天' }) day: Day,
    @Option('unit', { alias: 'u', name: '温度单位', choices: ['c', 'f'], default: 'c' }) unit: Unit,
    @Option('detail', { alias: 'd', name: '详细信息', type: 'boolean', default: false })
    detail: boolean,
    @Rest({ name: '备注' }) rest: string[],
    @Ctx() ctx: MessageContext,
  ): Promise<void> {
    void topic;
    const note = rest.join(' ');
    if (rest.length > 6 || note.length > 120) {
      await ctx.reply('备注最多 6 个词、120 个字符。');
      return;
    }
    const query: WeatherQuery = { city, day, unit, detail, note };
    const result = await this.makeCard(query, ctx, false);
    if (!result) return;
    const sent = await ctx.reply(result);
    this.audit({
      event: 'query-reply',
      scene: ctx.scene,
      status: sent.status,
      card: typeof result !== 'string' && result.kind === 'markdown',
    });
  }

  @OnButton(REFRESH_BUTTON)
  @Cooldown({ scope: 'user', durationMs: 10000 })
  async refresh(@Ctx() ctx: ButtonContext): Promise<void> {
    const query = this.buttons.resolve(ctx.data, ctx);
    if (!query) {
      await ctx.send('按钮已过期，或不是由你在此会话发起的查询，请重新查询。');
      return;
    }
    const result = await this.makeCard(query, ctx, true);
    if (!result) return;
    const sent = await ctx.send(result);
    this.audit({
      event: 'refresh-reply',
      scene: ctx.scene,
      status: sent.status,
      card: typeof result !== 'string' && result.kind === 'markdown',
    });
  }

  private async makeCard(
    query: WeatherQuery,
    ctx: MessageContext | ButtonContext,
    fresh: boolean,
  ): Promise<MessageInput | undefined> {
    try {
      const result = await this.weather.get(query.city, query.unit, ctx.signal, fresh);
      this.audit({
        event: 'weather-result',
        scene: ctx.scene,
        city: result.report.city,
        time: result.report.time,
        temperature: result.report.temperature,
        unit: result.report.unit,
        day: query.day,
        cached: result.cached,
        fresh,
      });
      return weatherCard(result, query, this.buttons.issue(ctx, query));
    } catch (error) {
      if (ctx.signal.aborted) return undefined;
      if (!(error instanceof WeatherError)) throw error;
      this.audit({ event: 'weather-error', scene: ctx.scene, code: error.code });
      return error.code === 'CITY_NOT_FOUND'
        ? '暂时无法定位该城市，请稍后重试。'
        : '天气服务暂时不可用，请稍后重试。';
    }
  }
}
