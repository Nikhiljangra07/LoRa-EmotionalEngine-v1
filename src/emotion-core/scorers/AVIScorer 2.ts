// src/emotion-core/scorers/AVIScorer.ts

import { AVI_PARAMS } from '../etv/constants';

/**
 * Appraisal Volatility Index — RMSSD of EIV successive differences,
 * linearly normalized to [0, 1].
 *
 * Grounded in Jahng et al. (2008) MSSD for affective instability,
 * validated by Houben et al. (2015) meta-analysis distinguishing
 * variability, instability, and inertia.
 */
export class AVIScorer {
  /**
   * Compute AVI from a buffer of recent EIV values.
   *
   * @param eivBuffer  Array of EIV values (bounded 0..1).
   * @param windowSize Max number of trailing values to consider (default 8).
   * @param saturation RMSSD value that maps to AVI = 1.0 (default 0.5).
   * @returns AVI in [0, 1]. Returns 0 when fewer than 2 values exist.
   */
  static computeAVI(
    eivBuffer: readonly number[],
    windowSize: number = AVI_PARAMS.windowSize,
    saturation: number = AVI_PARAMS.saturation,
  ): number {
    if (eivBuffer.length < AVI_PARAMS.minMessages) return 0;

    const start = Math.max(0, eivBuffer.length - windowSize);
    const window = eivBuffer.slice(start);

    if (window.length < AVI_PARAMS.minMessages) return 0;

    let sumSquaredDiffs = 0;
    for (let i = 1; i < window.length; i++) {
      const diff = window[i] - window[i - 1];
      sumSquaredDiffs += diff * diff;
    }

    const mssd = sumSquaredDiffs / (window.length - 1);
    const rmssd = Math.sqrt(mssd);

    return Math.min(Math.max(rmssd / saturation, 0), 1);
  }
}
