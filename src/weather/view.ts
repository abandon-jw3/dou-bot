import { button, keyboard, markdown } from 'dd-bot';
import type { MarkdownMessage } from 'dd-bot';
import type { WeatherQuery } from './buttons.js';
import { condition, days } from './service.js';
import type { WeatherResult } from './service.js';

export const REFRESH_BUTTON = 'weather:refresh';
function plain(value: string): string {
  return value.replace(/[\r\n]/gu, ' ').replace(/[\\`*_[\]()<>#]/gu, '\\$&');
}

export function weatherCard(
  result: WeatherResult,
  query: WeatherQuery,
  data: string,
): MarkdownMessage {
  const r = result.report;
  const day = r.days[days.indexOf(query.day)];
  if (!day) throw new Error('Forecast day unavailable');
  const lines = [`**${r.city} · ${query.day}天气**`, `日期：${day.date}（北京时间）`];
  if (query.day === '今天') lines.push(`当前估算：${condition(r.code)}，${r.temperature}${r.unit}`);
  lines.push(
    `日间预报：${condition(day.code)}，${day.low}～${day.high}${r.unit}`,
    `最高降水概率：${day.rainChance}%`,
  );
  if (query.detail) {
    if (query.day === '今天') lines.push(`相对湿度：${r.humidity}%；当前风速：${r.wind} m/s`);
    lines.push(`最大风速：${day.wind} m/s`);
  }
  if (query.note) lines.push(`备注：${plain(query.note)}`);
  lines.push(
    `数据时间：${r.time.replace('T', ' ')}（北京时间）`,
    `来源：Open-Meteo（天气模型估算与预报） / GeoNames（城市定位）`,
    result.cached ? '读取了 60 秒内的缓存；点击刷新可重新请求。' : '本次已请求天气服务。',
  );
  return markdown(lines.join('\n\n'), {
    keyboard: keyboard([[button.callback(REFRESH_BUTTON, '刷新天气', data)]]),
  });
}
