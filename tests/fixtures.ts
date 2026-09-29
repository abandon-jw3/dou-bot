import type { AppConfig } from '../src/config.js';

export const testConfig: AppConfig = {
  prefix: '',
  privateUsers: ['private-user'],
  groups: ['test-group'],
  liveEnrollment: false,
  requestTimeoutMs: 1000,
  cacheTtlMs: 60000,
};
export function forecast(unit = 'c') {
  const day = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const dates = [0, 1, 2].map((offset) =>
    new Date(Date.parse(day) + offset * 86400000).toISOString().slice(0, 10),
  );
  const suffix = unit === 'c' ? '°C' : '°F';
  return {
    utc_offset_seconds: 28800,
    current_units: { temperature_2m: suffix, wind_speed_10m: 'm/s', relative_humidity_2m: '%' },
    daily_units: {
      temperature_2m_max: suffix,
      temperature_2m_min: suffix,
      wind_speed_10m_max: 'm/s',
      precipitation_probability_max: '%',
    },
    current: {
      time: `${day}T12:00`,
      temperature_2m: 22,
      relative_humidity_2m: 60,
      weather_code: 2,
      wind_speed_10m: 3.5,
    },
    daily: {
      time: dates,
      weather_code: [2, 61, 0],
      temperature_2m_max: [25, 24, 26],
      temperature_2m_min: [18, 17, 19],
      precipitation_probability_max: [10, 80, 5],
      wind_speed_10m_max: [5, 6, 4],
    },
  };
}
export function requestUrl(input: Parameters<typeof fetch>[0]): URL {
  return new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
}
export function fixtureFetch(calls: URL[] = []): typeof fetch {
  return (input) => {
    const url = requestUrl(input);
    calls.push(url);
    return Promise.resolve(
      Response.json(
        url.hostname === 'geocoding-api.open-meteo.com'
          ? {
              results: [
                { country_code: 'CN', name: '北京', latitude: 39.9075, longitude: 116.39723 },
              ],
            }
          : forecast(url.searchParams.get('temperature_unit') === 'fahrenheit' ? 'f' : 'c'),
      ),
    );
  };
}
