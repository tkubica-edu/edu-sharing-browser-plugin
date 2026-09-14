import { afterEach, beforeEach } from 'vitest';

import { APP_CONFIG, FeatureKey } from '../app/config';

/**
 * Stands the deployment's feature blacklist at `initial` for every test of the surrounding suite and
 * puts the shipped value back afterwards; the returned function moves it again within one test. A spec
 * states the deployment it is about rather than inheriting whatever `APP_CONFIG.featureBlacklist`
 * happens to ship with, so changing that array is not a change to the suite.
 */
export function useFeatureBlacklist(
  ...initial: FeatureKey[]
): (...features: FeatureKey[]) => void {
  const shipped = APP_CONFIG.featureBlacklist;

  function set(...features: FeatureKey[]): void {
    (APP_CONFIG as unknown as { featureBlacklist: FeatureKey[] }).featureBlacklist = features;
  }

  beforeEach(() => set(...initial));
  afterEach(() => set(...shipped));

  return set;
}
