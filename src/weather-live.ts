import { createTestApplication } from 'dd-bot/testing';
import { createModule } from './app.js';
import { readConfig } from './config.js';
import { WeatherService } from './weather/service.js';

// Only the weather data source uses the real network. QQ is never connected by this command.
const harness = await createTestApplication(createModule(readConfig({})));
try {
  const result = await harness.app
    .get(WeatherService)
    .get(process.argv[2] ?? '北京', 'c', new AbortController().signal, true);
  console.log(JSON.stringify({ source: 'Open-Meteo', ...result }, null, 2));
} finally {
  await harness.app.close();
}
