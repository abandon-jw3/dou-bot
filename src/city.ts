import { Slot } from 'dd-bot';

export const cities = [
  { key: 'beijing', name: '北京', search: 'Beijing', aliases: ['北京', '北京市'] },
  { key: 'shanghai', name: '上海', search: 'Shanghai', aliases: ['上海', '上海市'] },
  { key: 'shenzhen', name: '深圳', search: 'Shenzhen', aliases: ['深圳', '深圳市'] },
  { key: 'guangzhou', name: '广州', search: 'Guangzhou', aliases: ['广州', '广州市'] },
  { key: 'hangzhou', name: '杭州', search: 'Hangzhou', aliases: ['杭州', '杭州市'] },
  { key: 'chengdu', name: '成都', search: 'Chengdu', aliases: ['成都', '成都市'] },
  { key: 'wuhan', name: '武汉', search: 'Wuhan', aliases: ['武汉', '武汉市'] },
  { key: 'xian', name: '西安', search: "Xi'an", aliases: ['西安', '西安市'] },
] as const;
export type CityInfo = (typeof cities)[number];
export function findCity(value: string): CityInfo | undefined {
  return cities.find(
    (city) => city.key === value || (city.aliases as readonly string[]).includes(value),
  );
}
export function City(): ParameterDecorator {
  return Slot('city', {
    name: '城市',
    required: true,
    choices: cities.flatMap((city) => [...city.aliases]),
  });
}
