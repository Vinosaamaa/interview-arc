const DISPLAY_SAFE_SOURCE_LABEL = /^[\p{L}\p{N}][\p{L}\p{N} .,'()&+_-]{0,119}$/u;

export function isDisplaySafeResumeSourceLabel(value: string) {
  return DISPLAY_SAFE_SOURCE_LABEL.test(value)
    && !/\b(?:gh[pousr]_|github_pat_|sk-(?:proj-)?|xox[baprs]-)[A-Za-z0-9_-]{8,}\b/i.test(value);
}
