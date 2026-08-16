/** Line-start index: line/column for a 0-based offset in O(log n). No pi imports. */

export function makePosIndex(
  raw: string,
): (index: number) => { line: number; column: number } {
  const starts: number[] = [0];
  for (let i = 0; i < raw.length; i++) {
    if (raw.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return (index: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: index - starts[lo] + 1 };
  };
}
