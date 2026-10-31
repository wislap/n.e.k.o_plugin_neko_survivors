import { expect, it, vi } from 'vitest';
import { Graphics } from 'pixi.js';
import { WeatherDisplay } from '../../src/rendering/weather-display';
import type { WeatherView } from '../../src/game';
import type { GameAssets } from '../../src/rendering/assets';
it('reduces only decorative rain lines on mobile while preserving projected hazard objects', () => {
  const camera = { x: 0, y: 0, zoom: 1, width: 800, height: 600 };
  const weather: WeatherView = { id: 'rain', strength: 1, fogStrength: 0, elapsed: 2, flash: 0, meteors: [], burnZones: [], typhoons: [] };
  const assets = { requestFile: async () => {}, getFile: () => undefined } as unknown as GameAssets;
  const line = vi.spyOn(Graphics.prototype, 'lineTo');
  try {
    for (const [mobile, id, expected] of [[false, 'rain', 65], [true, 'rain', 32], [false, 'typhoon', 95], [true, 'typhoon', 47]] as const) {
      const display = new WeatherDisplay(assets, mobile); line.mockClear();
      display.sync({ ...weather, id }, camera);
      expect(line).toHaveBeenCalledTimes(expected); display.dispose();
    }
    expect(weather.typhoons).toEqual([]);
  } finally { line.mockRestore(); }
});
