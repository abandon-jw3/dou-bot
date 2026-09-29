import { Inject, Injectable } from 'dd-bot';
import { AUDIT, CLOCK, CONFIG } from '../config.js';
import type { AppConfig, Audit } from '../config.js';
import { findCity } from '../city.js';
import { record, WeatherError, WeatherHttp } from './http.js';

export type Unit = 'c' | 'f';
export type Day = '今天' | '明天' | '后天';
export const days: readonly Day[] = ['今天', '明天', '后天'];
interface Position {
  latitude: number;
  longitude: number;
}
interface ForecastDay {
  readonly date: string;
  readonly code: number;
  readonly low: number;
  readonly high: number;
  readonly rainChance: number;
  readonly wind: number;
}
export interface WeatherReport {
  readonly city: string;
  readonly cityKey: string;
  readonly unit: '°C' | '°F';
  readonly time: string;
  readonly temperature: number;
  readonly humidity: number;
  readonly wind: number;
  readonly code: number;
  readonly days: readonly ForecastDay[];
}
export interface WeatherResult {
  readonly report: WeatherReport;
  readonly cached: boolean;
}
function numeric(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new WeatherError('INVALID_DATA');
  return value;
}
function weatherCode(value: unknown): number {
  const code = numeric(value, 0, 99);
  if (!Number.isInteger(code)) throw new WeatherError('INVALID_DATA');
  return code;
}
function stamp(value: unknown, dateOnly = false): string {
  if (
    typeof value !== 'string' ||
    !(dateOnly ? /^\d{4}-\d{2}-\d{2}$/u : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u).test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new WeatherError('INVALID_DATA');
  return value;
}

@Injectable()
export class WeatherService {
  private readonly positions = new Map<string, Position>();
  private readonly cache = new Map<string, { until: number; report: WeatherReport }>();
  constructor(
    private readonly http: WeatherHttp,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly now: () => number,
    @Inject(AUDIT) private readonly audit: Audit,
  ) {}

  async get(
    cityName: string,
    unit: Unit,
    signal: AbortSignal,
    fresh = false,
  ): Promise<WeatherResult> {
    signal.throwIfAborted();
    const city = findCity(cityName);
    if (!city || !['c', 'f'].includes(unit)) throw new WeatherError('CITY_NOT_FOUND');
    const key = `${city.key}:${unit}`;
    const cached = this.cache.get(key);
    const localDate = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    if (!fresh && cached && cached.until > this.now() && cached.report.days[0]?.date === localDate)
      return { report: cached.report, cached: true };
    let position = this.positions.get(city.key);
    if (!position) {
      const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
      url.search = new URLSearchParams({
        name: city.search,
        count: '1',
        language: 'zh',
        countryCode: 'CN',
      }).toString();
      const body = await this.http.json(url, signal);
      const result: unknown =
        record(body) && Array.isArray(body.results) ? body.results[0] : undefined;
      if (!record(result) || result.country_code !== 'CN') throw new WeatherError('CITY_NOT_FOUND');
      position = {
        latitude: numeric(result.latitude, -90, 90),
        longitude: numeric(result.longitude, -180, 180),
      };
      signal.throwIfAborted();
      this.positions.set(city.key, position);
    }
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.search = new URLSearchParams({
      latitude: String(position.latitude),
      longitude: String(position.longitude),
      current: 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m',
      daily:
        'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max',
      timezone: 'Asia/Shanghai',
      forecast_days: '3',
      wind_speed_unit: 'ms',
      temperature_unit: unit === 'c' ? 'celsius' : 'fahrenheit',
    }).toString();
    const body = await this.http.json(url, signal);
    if (
      !record(body) ||
      !record(body.current) ||
      !record(body.daily) ||
      !record(body.current_units) ||
      !record(body.daily_units) ||
      body.utc_offset_seconds !== 28800
    )
      throw new WeatherError('INVALID_DATA');
    const suffix = unit === 'c' ? '°C' : '°F';
    if (
      body.current_units.temperature_2m !== suffix ||
      body.current_units.wind_speed_10m !== 'm/s' ||
      body.current_units.relative_humidity_2m !== '%' ||
      body.daily_units.temperature_2m_max !== suffix ||
      body.daily_units.temperature_2m_min !== suffix ||
      body.daily_units.wind_speed_10m_max !== 'm/s' ||
      body.daily_units.precipitation_probability_max !== '%'
    )
      throw new WeatherError('INVALID_DATA');
    const current = body.current;
    const daily = body.daily;
    const at = (name: string, index: number): unknown => {
      const values: unknown = daily[name];
      if (!Array.isArray(values) || values.length !== 3) throw new WeatherError('INVALID_DATA');
      return values[index] as unknown;
    };
    const forecast: ForecastDay[] = [0, 1, 2].map((index) =>
      Object.freeze({
        date: stamp(at('time', index), true),
        code: weatherCode(at('weather_code', index)),
        low: numeric(at('temperature_2m_min', index), -150, 180),
        high: numeric(at('temperature_2m_max', index), -150, 180),
        rainChance: numeric(at('precipitation_probability_max', index), 0, 100),
        wind: numeric(at('wind_speed_10m_max', index), 0, 200),
      }),
    );
    if (forecast.some((day) => day.low > day.high)) throw new WeatherError('INVALID_DATA');
    const report: WeatherReport = Object.freeze({
      city: city.name,
      cityKey: city.key,
      unit: suffix,
      time: stamp(current.time),
      temperature: numeric(current.temperature_2m, -150, 180),
      humidity: numeric(current.relative_humidity_2m, 0, 100),
      wind: numeric(current.wind_speed_10m, 0, 200),
      code: weatherCode(current.weather_code),
      days: Object.freeze(forecast),
    });
    signal.throwIfAborted();
    this.cache.set(key, { until: this.now() + this.config.cacheTtlMs, report });
    this.audit({ event: 'weather-fetched', city: city.name, time: report.time, unit });
    return { report, cached: false };
  }
  onModuleDestroy(): void {
    this.positions.clear();
    this.cache.clear();
  }
}

export function condition(code: number): string {
  if (code === 0) return '晴';
  if (code === 1) return '大部晴朗';
  if (code === 2) return '多云';
  if (code === 3) return '阴';
  if ([45, 48].includes(code)) return '雾';
  if ([51, 53, 55].includes(code)) return '毛毛雨';
  if ([56, 57, 66, 67].includes(code)) return '冻雨';
  if ([61, 63, 65].includes(code)) return '雨';
  if ([71, 73, 75, 77].includes(code)) return '雪';
  if ([80, 81, 82].includes(code)) return '阵雨';
  if ([85, 86].includes(code)) return '阵雪';
  if ([95, 96, 99].includes(code)) return '雷暴';
  return `天气代码 ${code}`;
}
