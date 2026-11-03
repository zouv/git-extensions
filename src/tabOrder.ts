/** 页签拖拽排序的纯函数：插入位置只由其他页签的中心点决定，拖拽中的页签不参与计算。 */

export interface TabRect {
  left: number;
  width: number;
}

/** 指针在多少个其他页签中心点右侧；结果即移除拖拽页签后的插入下标。 */
export function insertionIndex(rects: readonly TabRect[], clientX: number): number {
  return rects.filter((rect) => clientX > rect.left + rect.width / 2).length;
}

/** 按插入下标重排路径；下标基于移除拖拽项之后的列表，并自动夹紧到有效范围。 */
export function movePath(paths: readonly string[], fromPath: string, index: number): string[] {
  const from = paths.indexOf(fromPath);
  if (from < 0) return [...paths];
  const rest = paths.filter((path) => path !== fromPath);
  const at = Math.max(0, Math.min(index, rest.length));
  rest.splice(at, 0, fromPath);
  return rest;
}
