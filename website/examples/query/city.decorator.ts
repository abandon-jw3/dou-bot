import { Slot } from 'dou-bot';
const cities = new Set(['北京', '上海', '深圳']);

// 这是装饰器工厂：调用 City()，得到 Slot 创建的参数装饰器。
// 匹配只识别本地字典中的单个分词，不进行网络查询或中文自动分词。
export function City(): ParameterDecorator {
  return Slot('city', { name: '城市', required: true, match: (word) => cities.has(word) });
}
