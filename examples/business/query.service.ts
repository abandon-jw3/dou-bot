import { Injectable } from '../../src/index.js';

export type Topic = '天气' | '空气质量';
// Deliberately synthetic fixtures. Replace the data source when connecting a real business API.
const fixtures = new Map<string, Record<Topic, string>>([
  ['北京', { 天气: '晴，20°C', 空气质量: '良' }],
  ['上海', { 天气: '多云，23°C', 空气质量: '优' }],
  ['深圳', { 天气: '阵雨，26°C', 空气质量: '良' }],
]);

@Injectable()
export class QueryService {
  query(city: string, topic: Topic, remaining: readonly string[], detail: boolean): string {
    const data = fixtures.get(city);
    if (!data) return '城市不在示例数据中。';
    return [
      `【演示数据，非实时】${city} ${topic}：${data[topic]}`,
      ...(remaining.length ? [`补充内容：${remaining.join('、')}`] : []),
      ...(detail ? ['来源：本地合成数据，用于演示业务模块。'] : []),
    ].join('\n');
  }
}
