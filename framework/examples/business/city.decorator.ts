import { Slot } from '../../src/index.js';

export const cities = ['北京', '上海', '深圳'] as const;

/** A reusable business decorator built entirely on the public Slot API. */
export function City(): ParameterDecorator {
  return Slot('city', { name: '城市', required: true, choices: cities });
}
